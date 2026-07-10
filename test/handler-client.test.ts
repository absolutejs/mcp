import { describe, expect, test } from "bun:test";
import { createMcpClient, McpClientError } from "../src/client";
import { createMcpHandler } from "../src/handler";
import type { McpServerConfig } from "../src/types";

type Caller = { id: string };

// A server whose authorize honours a fixed bearer, so we can drive it as a
// black box through the raw handler — and then point the CLIENT at that handler
// to prove the two halves interoperate.
const serverConfig: McpServerConfig<Caller> = {
  authorize: async (request) => {
    const auth = request.headers.get("authorization");
    if (auth !== "Bearer good") return { ok: false, reason: "bad token" };

    return { caller: { id: "u1" }, ok: true, scopes: ["mcp"] };
  },
  instructions: "test server",
  issuer: "https://example.test",
  path: "/mcp",
  scopesSupported: ["openid", "mcp"],
  serveRootMetadata: true,
  serverInfo: { name: "harness", version: "1.0.0" },
  tools: () => ({
    add: {
      description: "add two numbers",
      handler: (args) => {
        const { a, b } = args as { a: number; b: number };

        return String(a + b);
      },
      inputSchema: { type: "object" },
    },
  }),
};

const handler = createMcpHandler(serverConfig);
const url = "https://example.test/mcp";
const post = (headers: Record<string, string>, message: unknown) =>
  new Request(url, {
    body: JSON.stringify(message),
    headers: { "content-type": "application/json", ...headers },
    method: "POST",
  });

describe("createMcpHandler (framework-agnostic)", () => {
  test("GET the endpoint is 405; GET metadata is the RFC 9728 doc", async () => {
    const get = await handler(new Request(url, { method: "GET" }));
    expect(get?.status).toBe(405);

    const meta = await handler(
      new Request(
        "https://example.test/.well-known/oauth-protected-resource/mcp",
      ),
    );
    const metaBody = (await meta?.json()) as Record<string, unknown>;
    expect(metaBody.resource).toBe("https://example.test/mcp");
    expect(metaBody.authorization_servers).toEqual(["https://example.test"]);

    const root = await handler(
      new Request("https://example.test/.well-known/oauth-protected-resource"),
    );
    expect(root?.status).toBe(200);
  });

  test("a non-MCP path returns null so the host can fall through", async () => {
    const other = await handler(new Request("https://example.test/health"));
    expect(other).toBeNull();
  });

  test("unauthorized POST → 401 with the WWW-Authenticate challenge", async () => {
    const res = await handler(
      post({}, { id: 1, jsonrpc: "2.0", method: "initialize" }),
    );
    expect(res?.status).toBe(401);
    expect(res?.headers.get("www-authenticate")).toContain(
      "resource_metadata=",
    );
  });

  test("authorized POST dispatches and returns a JSON-RPC result", async () => {
    const res = await handler(
      post(
        { authorization: "Bearer good" },
        {
          id: 1,
          jsonrpc: "2.0",
          method: "tools/call",
          params: { arguments: { a: 2, b: 3 }, name: "add" },
        },
      ),
    );
    const payload = (await res?.json()) as Record<string, unknown>;
    const result = payload.result as Record<string, unknown>;
    expect((result.content as { text: string }[])[0]?.text).toBe("5");
  });
});

describe("createMcpClient against the handler (interop)", () => {
  // Route the client's fetch straight into the raw handler.
  const clientFetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const response = await handler(request);

    return response ?? new Response("not found", { status: 404 });
  }) as typeof fetch;

  test("initialize + tools/list + callTool round-trip with a bearer header", async () => {
    const client = createMcpClient({
      headers: { authorization: "Bearer good" },
      request: clientFetch,
      url,
    });

    const init = await client.initialize();
    expect(init.serverInfo?.name).toBe("harness");
    expect(init.protocolVersion).toBe("2025-06-18");

    const tools = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["add"]);

    const result = await client.callTool("add", { a: 10, b: 5 });
    expect((result.content[0] as { text: string }).text).toBe("15");
  });

  test("a bad bearer surfaces as McpClientError(401)", async () => {
    const client = createMcpClient({
      headers: { authorization: "Bearer nope" },
      request: clientFetch,
      url,
    });
    expect(client.initialize()).rejects.toThrow(McpClientError);
  });

  test("a JSON-RPC error from the server surfaces as an McpClientError", async () => {
    const client = createMcpClient({
      headers: { authorization: "Bearer good" },
      request: clientFetch,
      url,
    });
    // This server exposes no resources → resources/read is method-not-found.
    await expect(client.readResource("nope://missing")).rejects.toBeInstanceOf(
      McpClientError,
    );
    // An unknown tool name is a JSON-RPC error, so callTool rejects too.
    await expect(client.callTool("does_not_exist")).rejects.toBeInstanceOf(
      McpClientError,
    );
  });

  test("the client parses an SSE (text/event-stream) response body", async () => {
    const sseFetch = (async () =>
      new Response(
        `event: message\ndata: ${JSON.stringify({ id: 1, jsonrpc: "2.0", result: { tools: [{ name: "sse_tool" }] } })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      )) as typeof fetch;
    const client = createMcpClient({ request: sseFetch, url });
    const tools = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["sse_tool"]);
  });

  test("a slow server trips the timeout", async () => {
    const hangFetch = (async (_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      })) as typeof fetch;
    const client = createMcpClient({ request: hangFetch, timeoutMs: 20, url });
    expect(client.ping()).rejects.toThrow();
  });
});
