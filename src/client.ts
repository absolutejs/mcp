// A minimal MCP CLIENT for talking to a remote server over streamable HTTP.
// Stateless-friendly but also carries a session id + protocol-version header if
// the server is stateful. Auth is the caller's job — pass a bearer (or any)
// header. This is the half you need to CONSUME other MCP servers (e.g. exposing
// a member's own connected tools to your agent). Safety wrapping — namespacing,
// injection defense, approval gating — is the host's responsibility around it.

import { isRecord } from "./guards";
import type { McpToolAnnotations, McpToolResult } from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_PROTOCOL = "2025-06-18";

export class McpClientError extends Error {
  public readonly code: number | undefined;
  public readonly status: number | undefined;

  public constructor(
    message: string,
    options: { code?: number; status?: number } = {},
  ) {
    super(message);
    this.name = "McpClientError";
    this.code = options.code;
    this.status = options.status;
  }
}

export type McpClientOptions = {
  clientInfo?: { name: string; version: string };
  /** Sent on every request (e.g. `{ authorization: "Bearer …" }`). */
  headers?: Record<string, string>;
  /** Reject responses whose body exceeds this many bytes (0 = no cap). */
  maxResponseBytes?: number;
  protocolVersion?: string;
  /** Inject a custom fetch (tests, proxies). Defaults to global fetch. */
  request?: typeof fetch;
  timeoutMs?: number;
  url: string;
};

export type McpRemoteTool = {
  annotations?: McpToolAnnotations;
  description?: string;
  inputSchema?: Record<string, unknown>;
  name: string;
  outputSchema?: Record<string, unknown>;
};

export type McpInitializeResult = {
  capabilities?: Record<string, unknown>;
  instructions?: string;
  protocolVersion: string;
  serverInfo?: { name?: string; title?: string; version?: string };
};

export type McpClient = {
  callTool: (name: string, args?: unknown) => Promise<McpToolResult>;
  initialize: () => Promise<McpInitializeResult>;
  listResources: () => Promise<unknown[]>;
  listTools: () => Promise<McpRemoteTool[]>;
  ping: () => Promise<void>;
  readResource: (uri: string) => Promise<unknown>;
};

/** Streamable-HTTP servers may answer a POST with a single JSON object OR an SSE
 *  stream carrying `data:` lines. Pull the JSON-RPC response out of either. */
const parseBody = async (response: Response, maxBytes: number) => {
  const text = await response.text();
  if (maxBytes > 0 && text.length > maxBytes) {
    throw new McpClientError("Response exceeded the size cap", {
      status: response.status,
    });
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    return JSON.parse(text) as unknown;
  }
  // Take the last `data:` payload that parses as a JSON-RPC response.
  const messages = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((chunk) => chunk.length > 0);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    try {
      const parsed: unknown = JSON.parse(messages[index] ?? "");
      if (isRecord(parsed) && ("result" in parsed || "error" in parsed)) {
        return parsed;
      }
    } catch {
      // keep scanning earlier frames
    }
  }
  throw new McpClientError("No JSON-RPC response in the event stream");
};

export const createMcpClient = (options: McpClientOptions): McpClient => {
  const doFetch = options.request ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxResponseBytes ?? 0;
  let protocolVersion = options.protocolVersion ?? DEFAULT_PROTOCOL;
  let sessionId: string | null = null;
  let nextId = 1;

  const rpc = async (method: string, params?: unknown) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const headers: Record<string, string> = {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": protocolVersion,
        ...options.headers,
      };
      if (sessionId !== null) headers["mcp-session-id"] = sessionId;
      const response = await doFetch(options.url, {
        body: JSON.stringify({
          id: nextId++,
          jsonrpc: "2.0",
          method,
          ...(params === undefined ? {} : { params }),
        }),
        headers,
        method: "POST",
        signal: controller.signal,
      });
      const captured = response.headers.get("mcp-session-id");
      if (captured) sessionId = captured;
      if (response.status === 401) {
        throw new McpClientError("The MCP server rejected the credentials", {
          status: 401,
        });
      }
      const payload = await parseBody(response, maxBytes);
      if (!isRecord(payload)) {
        throw new McpClientError("Malformed JSON-RPC response");
      }
      if (isRecord(payload.error)) {
        const message =
          typeof payload.error.message === "string"
            ? payload.error.message
            : "MCP error";
        const code =
          typeof payload.error.code === "number"
            ? payload.error.code
            : undefined;
        throw new McpClientError(message, { code });
      }

      return payload.result;
    } finally {
      clearTimeout(timer);
    }
  };

  // Notifications get a 202 with no body — fire and forget.
  const notify = async (method: string) => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "mcp-protocol-version": protocolVersion,
      ...options.headers,
    };
    if (sessionId !== null) headers["mcp-session-id"] = sessionId;
    await doFetch(options.url, {
      body: JSON.stringify({ jsonrpc: "2.0", method }),
      headers,
      method: "POST",
    }).catch(() => undefined);
  };

  const initialize = async () => {
    const result = await rpc("initialize", {
      capabilities: {},
      clientInfo: options.clientInfo ?? {
        name: "@absolutejs/mcp",
        version: "0",
      },
      protocolVersion,
    });
    if (isRecord(result) && typeof result.protocolVersion === "string") {
      protocolVersion = result.protocolVersion;
    }
    await notify("notifications/initialized");

    return (isRecord(result) ? result : {}) as McpInitializeResult;
  };

  // Paginated servers return nextCursor; follow it so callers always get the
  // complete list. Page cap guards against a server that loops its cursors.
  const MAX_LIST_PAGES = 40;

  const listTools = async () => {
    const collected: McpRemoteTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const result = await rpc(
        "tools/list",
        cursor === undefined ? undefined : { cursor },
      );
      const tools =
        isRecord(result) && Array.isArray(result.tools) ? result.tools : [];
      collected.push(
        ...tools.filter(isRecord).map(
          (tool): McpRemoteTool => ({
            annotations: isRecord(tool.annotations)
              ? (tool.annotations as McpToolAnnotations)
              : undefined,
            description:
              typeof tool.description === "string"
                ? tool.description
                : undefined,
            inputSchema: isRecord(tool.inputSchema)
              ? tool.inputSchema
              : undefined,
            name: typeof tool.name === "string" ? tool.name : "",
            outputSchema: isRecord(tool.outputSchema)
              ? tool.outputSchema
              : undefined,
          }),
        ),
      );
      const next =
        isRecord(result) && typeof result.nextCursor === "string"
          ? result.nextCursor
          : undefined;
      if (next === undefined) break;
      cursor = next;
    }

    return collected;
  };

  const callTool = async (name: string, args?: unknown) => {
    const result = await rpc("tools/call", { arguments: args ?? {}, name });
    if (isRecord(result) && Array.isArray(result.content)) {
      return result as McpToolResult;
    }

    return { content: [], isError: false };
  };

  const listResources = async () => {
    const collected: unknown[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const result = await rpc(
        "resources/list",
        cursor === undefined ? undefined : { cursor },
      );
      if (isRecord(result) && Array.isArray(result.resources)) {
        collected.push(...result.resources);
      }
      const next =
        isRecord(result) && typeof result.nextCursor === "string"
          ? result.nextCursor
          : undefined;
      if (next === undefined) break;
      cursor = next;
    }

    return collected;
  };

  const readResource = async (uri: string) => rpc("resources/read", { uri });

  const ping = async () => {
    await rpc("ping");
  };

  return { callTool, initialize, listResources, listTools, ping, readResource };
};
