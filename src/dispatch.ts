// The MCP method dispatcher. Pure and framework-free: given the server config,
// a resolved caller, its scopes, and one decoded JSON-RPC message, it produces
// the Response. Capabilities advertised on `initialize` are derived from what
// the config actually provides (prompts/resources are optional).

import { isRecord } from "./guards";
import {
  JSONRPC_INTERNAL_ERROR,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_METHOD_NOT_FOUND,
  notificationAck,
  rpcError,
  rpcResult,
  type JsonRpcId,
} from "./jsonrpc";
import type { SessionRegistry } from "./sessions";
import type {
  McpCallMeta,
  McpElicitResult,
  McpServerConfig,
  McpTool,
  McpToolCallContext,
  McpToolResult,
  McpToolReturn,
} from "./types";

/** Everything a dispatch needs to know about the HTTP request it came in on.
 *  Only elicitation uses it; without it the dispatcher is exactly as stateless
 *  as it was. */
export type McpDispatchContext = {
  sessionId?: string | null;
  sessions?: SessionRegistry;
};

const DEFAULT_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_RESOURCE_MIME = "text/markdown";
const DEFAULT_LIST_PAGE_SIZE = 50;

/** Opaque list cursor (base64 offset). A malformed/foreign cursor reads as
 *  page zero rather than erroring — the spec treats cursors as opaque. */
const decodeCursor = (params: unknown) => {
  if (!isRecord(params) || typeof params.cursor !== "string") return 0;
  try {
    const parsed = Number.parseInt(atob(params.cursor), 10);

    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
};

const encodeCursor = (offset: number) => btoa(String(offset));

/** One page of a list + the nextCursor when more remain. */
const paginate = <Item>(items: Item[], offset: number, pageSize: number) => {
  const page = items.slice(offset, offset + pageSize);
  const nextOffset = offset + pageSize;

  return {
    items: page,
    ...(nextOffset < items.length
      ? { nextCursor: encodeCursor(nextOffset) }
      : {}),
  };
};

const idOf = (message: Record<string, unknown>): JsonRpcId =>
  typeof message.id === "string" || typeof message.id === "number"
    ? message.id
    : null;

const negotiateProtocol = (supported: string[], params: unknown) => {
  const preferred = supported[0] ?? DEFAULT_PROTOCOLS[0] ?? "";
  const requested =
    isRecord(params) && typeof params.protocolVersion === "string"
      ? params.protocolVersion
      : preferred;

  return supported.includes(requested) ? requested : preferred;
};

/** A tool with no `scope` is always available; a scoped tool needs the caller
 *  to hold that scope. Fails closed — unknown scopes hide a scoped tool. */
const scopeAllows = (tool: McpTool, scopes: string[]) =>
  tool.scope === undefined || scopes.includes(tool.scope);

/** A handler may return a bare string, a content array, or a full result.
 *  Normalise to the wire shape so every path produces valid `tools/call` output. */
const normalizeResult = (value: McpToolReturn): McpToolResult => {
  if (typeof value === "string") {
    return { content: [{ text: value, type: "text" }], isError: false };
  }
  if (Array.isArray(value)) return { content: value, isError: false };

  return { isError: false, ...value };
};

/** Did the client declare `capabilities.elicitation`? Only then may we ask its
 *  user anything. */
const clientCanElicit = (params: unknown) => {
  if (!isRecord(params) || !isRecord(params.capabilities)) return false;

  return isRecord(params.capabilities.elicitation);
};

const initialize = <Caller>(
  config: McpServerConfig<Caller>,
  id: JsonRpcId,
  params: unknown,
  context: McpDispatchContext,
) => {
  const supported = config.supportedProtocols ?? DEFAULT_PROTOCOLS;
  const capabilities: Record<string, unknown> = {
    tools: { listChanged: false },
  };
  if (config.prompts) capabilities.prompts = { listChanged: false };
  if (config.resources) {
    capabilities.resources = { listChanged: false, subscribe: false };
  }

  const response = rpcResult(id, {
    capabilities,
    ...(config.instructions === undefined
      ? {}
      : { instructions: config.instructions }),
    protocolVersion: negotiateProtocol(supported, params),
    serverInfo: config.serverInfo,
  });

  // A session exists for ONE reason: to let the client's answer to an
  // elicitation find the call that is waiting for it. No elicitation, no
  // session, no state.
  if (!config.elicitation?.enabled || !context.sessions) return response;
  const sessionId = context.sessions.create(clientCanElicit(params));
  response.headers.set("Mcp-Session-Id", sessionId);

  return response;
};

const toolsList = async <Caller>(
  config: McpServerConfig<Caller>,
  caller: Caller,
  scopes: string[],
  id: JsonRpcId,
  params: unknown,
) => {
  const tools = await config.tools({ caller, meta: {} });
  const visible = Object.entries(tools)
    .filter(([, tool]) => scopeAllows(tool, scopes))
    .map(([name, tool]) => ({
      annotations: tool.annotations,
      description: tool.description,
      inputSchema: tool.inputSchema,
      name,
      ...(tool.outputSchema === undefined
        ? {}
        : { outputSchema: tool.outputSchema }),
    }));
  const { items, nextCursor } = paginate(
    visible,
    decodeCursor(params),
    config.listPageSize ?? DEFAULT_LIST_PAGE_SIZE,
  );

  return rpcResult(id, {
    tools: items,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  });
};

const errorResult = (id: JsonRpcId, text: string) =>
  rpcResult(id, { content: [{ text, type: "text" }], isError: true });

/** The context every handler gets. When the tool can't (or the client won't)
 *  elicit, `elicit()` answers "unsupported" straight away — a tool never has to
 *  branch on transport. */
const noElicit: McpToolCallContext = {
  canElicit: false,
  elicit: () => Promise.resolve<McpElicitResult>({ action: "unsupported" }),
};

const SSE_HEADERS: Record<string, string> = {
  "cache-control": "no-cache",
  connection: "keep-alive",
  "content-type": "text/event-stream",
  "x-accel-buffering": "no",
};

const sseFrame = (message: unknown) => `data: ${JSON.stringify(message)}\n\n`;

/** Run the handler and produce the tools/call Response. */
const runTool = async <Caller>(
  config: McpServerConfig<Caller>,
  caller: Caller,
  id: JsonRpcId,
  name: string,
  args: unknown,
  meta: McpCallMeta,
  tool: McpTool,
  context: McpToolCallContext,
) => {
  let ok = false;
  let payload: unknown;
  try {
    const result = normalizeResult(await tool.handler(args, context));
    ok = result.isError !== true;
    payload = { id, jsonrpc: "2.0", result };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    payload = {
      id,
      jsonrpc: "2.0",
      result: {
        content: [{ text: `Tool failed: ${detail}`, type: "text" }],
        isError: true,
      },
    };
  }
  if (config.onCall) await config.onCall({ args, caller, meta, name, ok });

  return payload;
};

/** A tool that may ask the user something has to answer over SSE: the question
 *  travels down this stream while the call is still open, and the client's
 *  answer arrives on a SEPARATE POST that resolves the promise. The stream
 *  closes as soon as the tool result is sent. */
const toolsCallStreaming = <Caller>(
  config: McpServerConfig<Caller>,
  caller: Caller,
  id: JsonRpcId,
  name: string,
  args: unknown,
  meta: McpCallMeta,
  tool: McpTool,
  sessions: SessionRegistry,
  sessionId: string,
  canElicit: boolean,
) => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (message: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(sseFrame(message)));
        } catch {
          open = false;
        }
      };
      const context: McpToolCallContext = {
        canElicit,
        elicit: async (request) => {
          if (!canElicit) return { action: "unsupported" };
          const pending = sessions.startElicit(sessionId, request);
          if (!pending.id) return { action: "cancel" };
          send({
            id: pending.id,
            jsonrpc: "2.0",
            method: "elicitation/create",
            params: request,
          });

          return await pending.answer;
        },
      };
      const payload = await runTool(
        config,
        caller,
        id,
        name,
        args,
        meta,
        tool,
        context,
      );
      send(payload);
      if (open) {
        try {
          controller.close();
        } catch {
          open = false;
        }
      }
    },
  });

  return new Response(body, { headers: SSE_HEADERS });
};

const toolsCall = async <Caller>(
  config: McpServerConfig<Caller>,
  caller: Caller,
  scopes: string[],
  id: JsonRpcId,
  params: unknown,
  context: McpDispatchContext,
) => {
  if (!isRecord(params) || typeof params.name !== "string") {
    return rpcError(id, JSONRPC_INVALID_PARAMS, "tools/call needs a name");
  }
  const name = params.name;
  const args = params.arguments ?? {};
  const meta: McpCallMeta = {};
  if (config.beforeCall) {
    const gate = await config.beforeCall({ args, caller, meta, name });
    if (gate) return errorResult(id, gate.block);
  }
  const tools = await config.tools({ caller, meta });
  const tool = tools[name];
  // Scope-gated tools that the caller can't see are reported as unknown, so a
  // hidden tool is indistinguishable from one that doesn't exist.
  if (!tool || !scopeAllows(tool, scopes)) {
    return rpcError(id, JSONRPC_INVALID_PARAMS, `Unknown tool: ${name}`);
  }

  const session = context.sessions?.get(context.sessionId ?? null);
  const streaming =
    tool.mayElicit === true &&
    config.elicitation?.enabled === true &&
    context.sessions !== undefined &&
    session !== null &&
    session !== undefined &&
    typeof context.sessionId === "string";
  if (streaming && context.sessions && typeof context.sessionId === "string") {
    return toolsCallStreaming(
      config,
      caller,
      id,
      name,
      args,
      meta,
      tool,
      context.sessions,
      context.sessionId,
      session?.canElicit === true,
    );
  }

  const payload = await runTool(
    config,
    caller,
    id,
    name,
    args,
    meta,
    tool,
    noElicit,
  );

  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
  });
};

const promptsList = <Caller>(
  config: McpServerConfig<Caller>,
  id: JsonRpcId,
  params: unknown,
) => {
  const definitions = config.prompts?.definitions ?? {};
  const all = Object.entries(definitions).map(([name, def]) => ({
    arguments: def.arguments ?? [],
    description: def.description,
    name,
    title: def.title,
  }));
  const { items, nextCursor } = paginate(
    all,
    decodeCursor(params),
    config.listPageSize ?? DEFAULT_LIST_PAGE_SIZE,
  );

  return rpcResult(id, {
    prompts: items,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  });
};

const promptsGet = async <Caller>(
  config: McpServerConfig<Caller>,
  caller: Caller,
  id: JsonRpcId,
  params: unknown,
) => {
  const prompts = config.prompts;
  if (!prompts) return rpcError(id, JSONRPC_METHOD_NOT_FOUND, "No prompts");
  if (!isRecord(params) || typeof params.name !== "string") {
    return rpcError(id, JSONRPC_INVALID_PARAMS, "prompts/get needs a name");
  }
  const def = prompts.definitions[params.name];
  if (!def) {
    return rpcError(
      id,
      JSONRPC_INVALID_PARAMS,
      `Unknown prompt: ${params.name}`,
    );
  }
  const args = isRecord(params.arguments) ? params.arguments : {};
  const text = await prompts.get({ args, caller, name: params.name });
  if (text === null) {
    return rpcError(id, JSONRPC_INTERNAL_ERROR, "Prompt failed to build");
  }

  return rpcResult(id, {
    description: def.description,
    messages: [{ content: { text, type: "text" }, role: "user" }],
  });
};

const resourcesList = async <Caller>(
  config: McpServerConfig<Caller>,
  caller: Caller,
  id: JsonRpcId,
  params: unknown,
) => {
  const resources = config.resources;
  if (!resources) return rpcResult(id, { resources: [] });
  const { items, nextCursor } = paginate(
    await resources.list({ caller }),
    decodeCursor(params),
    config.listPageSize ?? DEFAULT_LIST_PAGE_SIZE,
  );

  return rpcResult(id, {
    resources: items,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  });
};

const resourcesRead = async <Caller>(
  config: McpServerConfig<Caller>,
  caller: Caller,
  id: JsonRpcId,
  params: unknown,
) => {
  const resources = config.resources;
  if (!resources) return rpcError(id, JSONRPC_METHOD_NOT_FOUND, "No resources");
  if (!isRecord(params) || typeof params.uri !== "string") {
    return rpcError(id, JSONRPC_INVALID_PARAMS, "resources/read needs a uri");
  }
  const uri = params.uri;
  const text = await resources.read({ caller, uri });
  if (text === null) {
    return rpcError(id, JSONRPC_INVALID_PARAMS, `Unknown resource: ${uri}`);
  }

  return rpcResult(id, {
    contents: [
      { mimeType: resources.mimeType ?? DEFAULT_RESOURCE_MIME, text, uri },
    ],
  });
};

/** Route one decoded JSON-RPC message to its handler. `scopes` are the caller's
 *  granted scopes (from `authorize`); they gate scope-restricted tools.
 *  Notifications (no `id`) get a bare 202; unknown methods get method-not-found. */
/** The client's answer to an `elicitation/create` we sent. It arrives as its
 *  own POST whose body is a JSON-RPC RESPONSE (an id, a result, no method) —
 *  hand it to the tool call that is blocked waiting for it. The transport says
 *  a response body gets 202 with no content, whether or not we recognised it. */
const elicitAnswer = (
  message: Record<string, unknown>,
  context: McpDispatchContext,
) => {
  const requestId = typeof message.id === "string" ? message.id : null;
  if (!requestId || !context.sessions) return notificationAck();
  const result = isRecord(message.result) ? message.result : null;
  const action = result?.action;
  const answer: McpElicitResult =
    action === "accept" && isRecord(result?.content)
      ? { action: "accept", content: result.content }
      : action === "decline"
        ? { action: "decline" }
        : { action: "cancel" };
  context.sessions.resolveElicit(context.sessionId ?? null, requestId, answer);

  return notificationAck();
};

export const dispatchMcp = async <Caller>(
  config: McpServerConfig<Caller>,
  caller: Caller,
  scopes: string[],
  message: unknown,
  context: McpDispatchContext = {},
): Promise<Response> => {
  if (!isRecord(message) || message.jsonrpc !== "2.0") {
    return rpcError(
      null,
      JSONRPC_INVALID_REQUEST,
      "Not a JSON-RPC 2.0 message",
    );
  }
  if (!("id" in message)) return notificationAck();
  // A body with an id but NO method is a RESPONSE to something we asked.
  if (!("method" in message)) return elicitAnswer(message, context);
  const id = idOf(message);
  const method = typeof message.method === "string" ? message.method : "";
  const { params } = message;
  if (method === "initialize") {
    return initialize(config, id, params, context);
  }
  if (method === "ping") return rpcResult(id, {});
  if (method === "tools/list") {
    return toolsList(config, caller, scopes, id, params);
  }
  if (method === "tools/call") {
    return toolsCall(config, caller, scopes, id, params, context);
  }
  if (method === "prompts/list") return promptsList(config, id, params);
  if (method === "prompts/get") return promptsGet(config, caller, id, params);
  if (method === "resources/list") {
    return resourcesList(config, caller, id, params);
  }
  if (method === "resources/read") {
    return resourcesRead(config, caller, id, params);
  }

  return rpcError(id, JSONRPC_METHOD_NOT_FOUND, `Unknown method: ${method}`);
};
