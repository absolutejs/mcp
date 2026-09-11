import { expect, test } from "bun:test";
import { createMcpHandler } from "../src/handler";
import { createMcpClient, McpClientError } from "../src/client";
import { MCP_APP_MIME, withMcpApp } from "../src/apps";
import type { McpServerConfig, McpSessionStore } from "../src/types";
const url = "https://sessions.test/mcp";
const uri = "ui://session/report.html";
const fixture = () => {
  const rows = new Map<string, Parameters<McpSessionStore["create"]>[0]>();
  const store: McpSessionStore = {
    create: (value) => {
      const id = crypto.randomUUID();
      rows.set(id, value);
      return id;
    },
    get: (id) => rows.get(id) ?? null,
    drop: (id) => {
      rows.delete(id);
    },
  };
  const calls: string[] = [];
  const config: McpServerConfig<string> = {
    issuer: "https://sessions.test",
    path: "/mcp",
    serverInfo: { name: "lifecycle", version: "1" },
    authorize: async (request) => {
      const token = request.headers.get("authorization");
      return token === "Bearer alice" || token === "Bearer bob"
        ? { ok: true, caller: token.slice(7), scopes: ["read"] }
        : { ok: false, reason: "Invalid credential" };
    },
    apps: {
      store,
      resources: {
        [uri]: {
          name: "Report",
          html: "<!doctype html><html><body>Shared template</body></html>",
        },
      },
    },
    tools: ({ caller }) => ({
      report: withMcpApp(
        {
          scope: "read",
          description: "Account report",
          inputSchema: { type: "object" },
          handler: () => {
            calls.push(caller);
            return caller;
          },
        },
        uri,
      ),
    }),
  };
  const first = createMcpHandler(config);
  const second = createMcpHandler({
    ...config,
    apps: { ...config.apps!, store },
  });
  const request = (
    method: string,
    params: unknown = {},
    session?: string,
    token = "alice",
  ) =>
    new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
        authorization: `Bearer ${token}`,
        ...(session ? { "mcp-session-id": session } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  const initialize = async () => {
    const res = await first(
      request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {
          extensions: {
            "io.modelcontextprotocol/ui": { mimeTypes: [MCP_APP_MIME] },
          },
        },
      }),
    );
    const session = res?.headers.get("mcp-session-id");
    if (!session) throw Error("Missing session");
    return session;
  };
  return { rows, store, calls, first, second, request, initialize };
};
test("DELETE rejects missing/invalid credentials before touching a live session", async () => {
  const f = fixture();
  const session = await f.initialize();
  for (const authorization of [undefined, "Bearer invalid"]) {
    const response = await f.second(
      new Request(url, {
        method: "DELETE",
        headers: {
          "mcp-session-id": session,
          ...(authorization ? { authorization } : {}),
        },
      }),
    );
    expect(response?.status).toBe(401);
    expect(response?.headers.get("www-authenticate")).toContain(
      "resource_metadata=",
    );
    expect(await f.store.get(session)).not.toBeNull();
  }
  const deleted = await f.second(
    new Request(url, {
      method: "DELETE",
      headers: { "mcp-session-id": session, authorization: "Bearer alice" },
    }),
  );
  expect(deleted?.status).toBe(204);
  expect(await f.store.get(session)).toBeNull();
});
test("session identifiers never substitute for authentication or select the account", async () => {
  const f = fixture();
  const session = await f.initialize();
  for (const method of [
    "tools/list",
    "tools/call",
    "resources/list",
    "resources/read",
  ]) {
    const response = await f.second(
      f.request(
        method,
        { name: "report", arguments: {}, uri },
        session,
        "invalid",
      ),
    );
    expect(response?.status).toBe(401);
  }
  for (const account of ["alice", "bob"]) {
    const response = await f.second(
      f.request(
        "tools/call",
        { name: "report", arguments: {} },
        session,
        account,
      ),
    );
    expect((await response!.json()).result.content[0].text).toBe(account);
  }
  expect(f.calls).toEqual(["alice", "bob"]);
});
test("a terminated session produces typed 404 and explicit reinitialization uses a fresh session without replaying the tool", async () => {
  const f = fixture();
  const initializeHeaders: (string | null)[] = [];
  const client = createMcpClient({
    url,
    apps: true,
    headers: { authorization: "Bearer alice" },
    request: async (input, init) => {
      const req = new Request(input, init);
      const body = await req.clone().json();
      if (body.method === "initialize")
        initializeHeaders.push(req.headers.get("mcp-session-id"));
      return (await f.second(req)) ?? new Response(null, { status: 404 });
    },
  });
  await client.initialize();
  f.rows.clear();
  const failure = await client.callTool("report").catch((e) => e);
  expect(failure).toBeInstanceOf(McpClientError);
  expect(failure.status).toBe(404);
  expect(f.calls).toEqual([]);
  await client.initialize();
  expect(initializeHeaders).toEqual([null, null]);
  expect((await client.listTools())[0]?._meta).toBeDefined();
  expect((await client.callTool("report")).content[0]).toEqual({
    type: "text",
    text: "alice",
  });
});

test("explicit initialization discards an existing session before reconnecting", async () => {
  const f = fixture();
  const client = createMcpClient({
    url,
    apps: true,
    headers: { authorization: "Bearer alice" },
    request: async (input, init) => (await f.second(new Request(input, init)))!,
  });
  await client.initialize();
  f.rows.clear();
  await client.initialize();
  expect(f.rows.size).toBe(1);
  expect((await client.callTool("report")).content[0]).toEqual({
    type: "text",
    text: "alice",
  });
});
test("missing protocol header uses the compatibility fallback; explicit unsupported versions fail", async () => {
  const f = fixture();
  const session = await f.initialize();
  for (const method of [
    "notifications/initialized",
    "tools/list",
    "resources/list",
  ]) {
    const original = f.request(method, {}, session);
    const body = await original.json();
    if (method.startsWith("notifications/")) delete body.id;
    const request = new Request(original, { body: JSON.stringify(body) });
    request.headers.delete("mcp-protocol-version");
    expect((await f.second(request))?.status).toBe(
      method === "notifications/initialized" ? 202 : 200,
    );
  }
  const request = f.request("tools/list", {}, session);
  request.headers.set("mcp-protocol-version", "2099-01-01");
  expect((await f.second(request))?.status).toBe(400);
});

test("HTTP failures retain their status and JSON-RPC error code without requiring JSON", async () => {
  for (const body of [
    "Unavailable",
    JSON.stringify({ error: { code: -32000, message: "Try later" } }),
  ]) {
    const client = createMcpClient({
      url,
      request: async () => new Response(body, { status: 503 }),
    });
    const failure = await client.listTools().catch((error) => error);
    expect(failure).toBeInstanceOf(McpClientError);
    expect(failure.status).toBe(503);
    expect(failure.code).toBe(body === "Unavailable" ? undefined : -32000);
  }
});
