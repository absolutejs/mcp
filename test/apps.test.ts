import { createMcpClient } from "../src/client";
import { expect, test } from "bun:test";
import { createMcpHandler } from "../src/handler";
import { createBillingApps } from "../src/billingApps";
import { withMcpApp, MCP_APP_MIME } from "../src/apps";
import type { McpServerConfig, McpSessionStore } from "../src/types";
const uri = "ui://test/report.html";
const rpc = (
  method: string,
  params: unknown = {},
  session?: string,
  token = "good",
) =>
  new Request("https://service.test/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "mcp-protocol-version": "2025-11-25",
      authorization: `Bearer ${token}`,
      ...(session ? { "mcp-session-id": session } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
const initialize = (mimeTypes: string[] = []) => ({
  capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes } } },
  protocolVersion: "2025-11-25",
});
const config = (): McpServerConfig<string> => ({
  issuer: "https://service.test",
  path: "/mcp",
  serverInfo: { name: "apps-test", version: "1" },
  authorize: async (request) =>
    request.headers.get("authorization") === "Bearer good"
      ? { ok: true, caller: "alice", scopes: ["read"] }
      : { ok: false, reason: "Bad token" },
  apps: {
    resources: {
      [uri]: {
        name: "Report",
        html: "<!doctype html><html><body>Offline report</body></html>",
      },
    },
  },
  tools: () => ({
    report: withMcpApp(
      {
        scope: "read",
        description: "Report",
        annotations: { readOnlyHint: true },
        inputSchema: { type: "object" },
        handler: () => ({
          content: [{ type: "text", text: "3 credits" }],
          structuredContent: { remaining: 3 },
        }),
      },
      uri,
    ),
  }),
});
test("Apps negotiation decorates discovery and serves strict-CSP HTML without changing text results", async () => {
  const handler = createMcpHandler(config());
  const initialized = await handler(
    rpc("initialize", initialize([MCP_APP_MIME])),
  );
  const session = initialized!.headers.get("mcp-session-id")!;
  expect(
    (await initialized!.json()).result.capabilities.extensions[
      "io.modelcontextprotocol/ui"
    ],
  ).toEqual({});
  const tools = await (await handler(rpc("tools/list", {}, session)))!.json();
  expect(tools.result.tools[0]._meta.ui).toEqual({
    resourceUri: uri,
    visibility: ["model", "app"],
  });
  const resources = await (await handler(
    rpc("resources/list", {}, session),
  ))!.json();
  expect(resources.result.resources[0].mimeType).toBe(MCP_APP_MIME);
  const resource = await (await handler(
    rpc("resources/read", { uri }, session),
  ))!.json();
  expect(resource.result.contents[0].text).toContain("<!doctype html>");
  expect(resource.result.contents[0]._meta.ui.csp.connectDomains).toEqual([]);
  expect(resource.result.contents[0]._meta.ui.permissions).toEqual({});
  const result = await (await handler(
    rpc("tools/call", { name: "report", arguments: {} }, session),
  ))!.json();
  expect(result.result.content[0].text).toBe("3 credits");
  expect(
    (await handler(rpc("resources/read", { uri }, session, "bad")))!.status,
  ).toBe(401);
});
test("text-only, missing and spoofed capabilities never advertise or read Apps", async () => {
  const handler = createMcpHandler(config());
  for (const mimeTypes of [[], ["text/html"]]) {
    const session = (await handler(
      rpc("initialize", initialize(mimeTypes)),
    ))!.headers.get("mcp-session-id")!;
    const tools = await (await handler(
      rpc("tools/list", initialize([MCP_APP_MIME]), session),
    ))!.json();
    expect(tools.result.tools[0]._meta).toBeUndefined();
    expect(
      (await (await handler(rpc("resources/list", {}, session)))!.json()).result
        .resources,
    ).toEqual([]);
    expect(
      (await (await handler(rpc("resources/read", { uri }, session)))!.json())
        .error,
    ).toBeDefined();
  }
  expect(
    (await (await handler(rpc("tools/list")))!.json()).result.tools[0]._meta,
  ).toBeUndefined();
});
test("UI resource reads recheck scope and commerce after discovery", async () => {
  const settings = config();
  let blocked = false;
  settings.tools = () => ({
    report: withMcpApp(
      {
        description: "Report",
        scope: blocked ? "admin" : "read",
        commerce: {
          action: "external_checkout",
          categories: ["usage_credits"],
        },
        inputSchema: { type: "object" },
        handler: () => "never",
      },
      uri,
    ),
  });
  // Unknown commerce profile must hide the resource as well as its tool.
  const handler = createMcpHandler(settings);
  const session = (await handler(
    rpc("initialize", initialize([MCP_APP_MIME])),
  ))!.headers.get("mcp-session-id")!;
  expect(
    (await (await handler(rpc("resources/list", {}, session)))!.json()).result
      .resources,
  ).toEqual([]);
  settings.tools = () => ({
    report: withMcpApp(
      {
        description: "Report",
        scope: blocked ? "admin" : "read",
        inputSchema: { type: "object" },
        handler: () => "ok",
      },
      uri,
    ),
  });
  expect(
    (await (await handler(rpc("resources/list", {}, session)))!.json()).result
      .resources,
  ).toHaveLength(1);
  blocked = true;
  expect(
    (await (await handler(rpc("resources/read", { uri }, session)))!.json())
      .error,
  ).toBeDefined();
});
test("Apps capability survives instance changes through the supplied session store", async () => {
  const rows = new Map<string, Parameters<McpSessionStore["create"]>[0]>();
  const store: McpSessionStore = {
    create: (session) => {
      const id = crypto.randomUUID();
      rows.set(id, session);
      return id;
    },
    get: (id) => rows.get(id) ?? null,
    drop: (id) => {
      rows.delete(id);
    },
  };
  const settings = config();
  settings.apps!.store = store;
  const first = createMcpHandler(settings);
  const second = createMcpHandler({ ...settings });
  const session = (await first(
    rpc("initialize", initialize([MCP_APP_MIME])),
  ))!.headers.get("mcp-session-id")!;
  expect(
    (await (await second(rpc("tools/list", {}, session)))!.json()).result
      .tools[0]._meta.ui.resourceUri,
  ).toBe(uri);
  await store.drop(session);
  expect((await second(rpc("tools/list", {}, session)))!.status).toBe(404);
});
test("billing templates are reusable offline resources and decorators retain tool guards", () => {
  const apps = createBillingApps();
  expect(Object.keys(apps.resources)).toHaveLength(3);
  for (const resource of Object.values(apps.resources)) {
    expect(resource.html).toStartWith("<!doctype html>");
    expect(resource.html).not.toContain("<script src=");
    expect(resource.html).not.toContain("<iframe");
  }
  const tool = {
    description: "Status",
    scope: "read",
    commerce: {
      action: "entitlement_status" as const,
      categories: ["usage_credits" as const],
    },
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object" },
    handler: () => "ok",
  };
  const decorated = apps.decorateTools({ get_billing_status: tool });
  expect(decorated.get_billing_status!.handler).toBe(tool.handler);
  expect(decorated.get_billing_status!.commerce).toBe(tool.commerce);
  expect(decorated.get_billing_status!.scope).toBe("read");
  expect(() =>
    apps.decorateTools({
      get_billing_status: { ...tool, annotations: { readOnlyHint: false } },
    }),
  ).toThrow();
});

test("package client advertises Apps only when enabled and preserves remote UI metadata", async () => {
  const handler = createMcpHandler(config());
  const client = createMcpClient({
    apps: true,
    url: "https://service.test/mcp",
    headers: { authorization: "Bearer good" },
    request: async (input, init) =>
      (await handler(new Request(input, init))) ??
      new Response("Not found", { status: 404 }),
  });
  await client.initialize();
  expect((await client.listTools())[0]?._meta).toEqual({
    ui: { resourceUri: uri, visibility: ["model", "app"] },
  });
});
