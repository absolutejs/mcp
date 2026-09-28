import { currentMcpCall, withMcpCall } from "../src/callContext";
import { expect, test } from "bun:test";
import { dispatchMcp, type McpServerConfig } from "../src/index";

type Audit = Parameters<NonNullable<McpServerConfig<string>["onCall"]>>[0];
const config = (records: Audit[]): McpServerConfig<string> => ({
  withCallContext: withMcpCall,
  issuer: "https://example.test",
  path: "/mcp",
  serverInfo: { name: "test", version: "1" },
  authorize: async () => ({ caller: "test", ok: true, scopes: [] }),
  onCall: (record) => {
    expect(currentMcpCall()?.traceId).toBe(record.traceId);
    records.push(record);
  },
  tools: () => ({
    echo: {
      description: "Echo",
      inputSchema: { type: "object" },
      handler: async (args) => JSON.stringify(args),
    },
  }),
});
const call = (server: McpServerConfig<string>, name = "echo") =>
  dispatchMcp(
    server,
    "test",
    [],
    {
      id: 1,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { arguments: { query: "partners" }, name },
    },
    { sessionId: "session-test" },
  );

test("audit captures success, complete output and correlation exactly once", async () => {
  const records: Audit[] = [];
  const response = await call(config(records));
  expect(response.status).toBe(200);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    args: { query: "partners" },
    ok: true,
    outcome: "completed",
    requestId: 1,
    sessionId: "session-test",
  });
  expect(records[0]?.result).toMatchObject({
    content: [{ text: '{"query":"partners"}', type: "text" }],
  });
  expect(records[0]?.traceId).toBeTruthy();
});
test("blocked and unknown tools are audited without invoking their handler", async () => {
  const records: Audit[] = [];
  const server = config(records);
  server.beforeCall = () => ({ block: "Burst limit reached" });
  await call(server);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ ok: false, outcome: "rejected" });
  expect(JSON.stringify(records[0]?.result)).toContain("Burst limit");
  delete server.beforeCall;
  await call(server, "missing");
  expect(records).toHaveLength(2);
  expect(records[1]?.outcome).toBe("rejected");
});
test("thrown dispatch and tool errors have traceable failure results", async () => {
  const records: Audit[] = [];
  const server = config(records);
  server.beforeCall = () => {
    throw Error("Cannot check capacity");
  };
  await call(server);
  expect(JSON.stringify(records[0]?.result)).toContain("Cannot check capacity");
  delete server.beforeCall;
  server.tools = () => ({
    echo: {
      description: "Fail",
      inputSchema: {},
      handler: async () => {
        throw Error("Search unavailable");
      },
    },
  });
  await call(server);
  expect(records[1]).toMatchObject({ ok: false, outcome: "failed" });
  expect(JSON.stringify(records[1]?.result)).toContain("Search unavailable");
});
test("deferred tool execution audits once at completion instead of misreporting task admission", async () => {
  const { createMemoryMcpTaskStore } = await import("../src/index");
  const records: Audit[] = [];
  const server = config(records);
  let complete: (() => void) | undefined;
  // eslint-disable-next-line promise/avoid-new -- Wait for the deferred protocol callback, not a timer.
  const audited = new Promise<void>((resolve) => {
    complete = resolve;
  });
  server.onCall = (record) => {
    expect(currentMcpCall()?.traceId).toBe(record.traceId);
    records.push(record);
    complete?.();
  };
  server.tasks = {
    store: createMemoryMcpTaskStore(),
    authorizationKey: () => "owner",
    shouldCreate: () => true,
  };
  server.tools = () => ({
    echo: {
      description: "Deferred",
      inputSchema: {},
      taskSupport: "optional",
      handler: async () => "Saved result",
    },
  });
  const response = await dispatchMcp(
    server,
    "test",
    [],
    {
      id: 2,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { arguments: {}, name: "echo", task: {} },
    },
    { protocolVersion: "2025-11-25" },
  );
  expect(JSON.stringify(await response.json())).toContain("taskId");
  await audited;
  expect(records).toHaveLength(1);
  expect(records[0]?.outcome).toBe("completed");
  expect(JSON.stringify(records[0]?.result)).toContain("Saved result");
});

test("streaming elicitation emits one final audit record", async () => {
  const { createMcpHandler, createMcpClient } = await import("../src/index");
  const records: Audit[] = [];
  const server = config(records);
  server.elicitation = { enabled: true };
  server.tools = () => ({
    echo: {
      description: "Ask",
      inputSchema: { type: "object" },
      mayElicit: true,
      handler: async (_args, context) => {
        const answer = await context.elicit({
          message: "Confirm",
          requestedSchema: {
            properties: { confirm: { type: "boolean" } },
            type: "object",
          },
        });

        return JSON.stringify(answer);
      },
    },
  });
  const handler = createMcpHandler(server);
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Fetch-compatible in-memory transport for the real MCP client.
  const request = (async (input: string | URL | Request, init?: RequestInit) =>
    (await handler(
      input instanceof Request ? input : new Request(input, init),
    )) ?? new Response("Not found", { status: 404 })) as typeof fetch;
  const client = createMcpClient({
    request,
    url: "https://example.test/mcp",
    onElicit: () => ({ action: "accept", content: { confirm: true } }),
  });
  await client.initialize();
  expect(JSON.stringify(await client.callTool("echo", {}))).toContain("accept");
  expect(records).toHaveLength(1);
  expect(records[0]?.outcome).toBe("completed");
});

test("malformed requests and audit-hook failures preserve protocol results", async () => {
  const records: Audit[] = [];
  const server = config(records);
  await dispatchMcp(server, "test", [], {
    id: 9,
    jsonrpc: "2.0",
    method: "tools/call",
    params: {},
  });
  expect(records[0]).toMatchObject({
    name: "(invalid)",
    outcome: "rejected",
    requestId: 9,
  });
  server.onCall = () => {
    throw new Error("Audit store offline");
  };
  const response = await call(server);
  expect((await response.json()).result).toMatchObject({
    content: [{ type: "text", text: '{"query":"partners"}' }],
  });
});
