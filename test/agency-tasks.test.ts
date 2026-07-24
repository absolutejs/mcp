import { describe, expect, test } from "bun:test";
import {
  allowAllPolicy,
  createAgency,
  createMemoryAgencyStore,
  type PolicyDecisionPoint,
} from "@absolutejs/agency";
import { dispatchMcp } from "../src/dispatch";
import { createMemoryMcpTaskStore } from "../src/tasks";
import type { McpServerConfig } from "../src/types";

type Caller = { id: string };

const rpc = (method: string, params: unknown, id = 1) => ({
  id,
  jsonrpc: "2.0",
  method,
  params,
});

const body = async (response: Response) =>
  JSON.parse(await response.text()) as Record<string, unknown>;

const taskCapability = {
  _meta: {
    "io.modelcontextprotocol/clientCapabilities": {
      extensions: { "io.modelcontextprotocol/tasks": {} },
    },
  },
};

const config = (
  policy: PolicyDecisionPoint,
  over: Partial<McpServerConfig<Caller>> = {},
) => {
  const store = createMemoryAgencyStore();
  const agency = createAgency({ policy, store });
  const server: McpServerConfig<Caller> = {
    agency: {
      enforcement: agency,
      resolveActor: ({ caller, scopes }) => ({
        agentId: "agent-1",
        scopes,
        userId: caller.id,
      }),
    },
    authorize: async () => ({ caller: { id: "user-1" }, ok: true }),
    issuer: "https://example.test",
    path: "/mcp",
    serverInfo: { name: "test", version: "1.0.0" },
    tools: () => ({
      send: {
        authorization: {
          approval: "policy",
          effects: ["send", "external-network"],
          idempotency: { field: "idempotencyKey", mode: "field" },
          requiredScopes: ["messages:send"],
          spend: {
            amountMinorField: "amountMinor",
            currencyField: "currency",
            maximumAmountMinor: 1_000,
          },
        },
        description: "send",
        handler: () => "sent",
        inputSchema: { type: "object" },
        taskSupport: "optional",
      },
    }),
    ...over,
  };

  return { agency, server };
};

describe("agency tool enforcement", () => {
  test("executes guarded calls through a single-use lease and receipt", async () => {
    const { agency, server } = config(allowAllPolicy());
    const response = await dispatchMcp(
      server,
      { id: "user-1" },
      ["messages:send"],
      rpc("tools/call", {
        arguments: {
          amountMinor: 250,
          body: "hello",
          currency: "USD",
          idempotencyKey: "send-1",
        },
        name: "send",
      }),
    );
    const payload = await body(response);
    expect((payload.result as Record<string, unknown>).isError).toBe(false);
    const ledger = await agency.inspect("agent-1");
    expect(ledger.actions).toHaveLength(1);
    expect(ledger.actions[0]).toMatchObject({
      idempotencyKey: "send-1",
      spend: { amountMinor: 250, currency: "USD" },
    });
    expect(ledger.receipts[0]?.status).toBe("succeeded");
  });

  test("returns a resumable action id instead of running a requestable denial", async () => {
    const policy: PolicyDecisionPoint = {
      evaluate: ({ now }) => ({
        decisionId: "decision-1",
        evaluatedAt: now,
        kind: "deny",
        prerequisites: [
          {
            kind: "approval",
            prerequisiteId: "owner",
            title: "Owner approval",
          },
        ],
        reason: "approval_required",
        requestable: true,
      }),
    };
    const { server } = config(policy);
    const payload = await body(
      await dispatchMcp(
        server,
        { id: "user-1" },
        ["messages:send"],
        rpc("tools/call", { name: "send" }),
      ),
    );
    const result = payload.result as Record<string, unknown>;
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      type: "absolute.action_decision",
    });
  });

  test("hides guarded tools when required scopes or agency are missing", async () => {
    const { server } = config(allowAllPolicy());
    const withoutScope = await body(
      await dispatchMcp(server, { id: "user-1" }, [], rpc("tools/list", {})),
    );
    expect((withoutScope.result as { tools: unknown[] }).tools).toHaveLength(0);
    const withoutAgency = await body(
      await dispatchMcp(
        { ...server, agency: undefined },
        { id: "user-1" },
        ["messages:send"],
        rpc("tools/list", {}),
      ),
    );
    expect((withoutAgency.result as { tools: unknown[] }).tools).toHaveLength(
      0,
    );
  });
});

describe("SEP-2663 task extension", () => {
  test("advertises the extension through stateless server discovery", async () => {
    const { server } = config(allowAllPolicy(), {
      tasks: {
        authorizationKey: (caller) => caller.id,
        shouldCreate: () => false,
        store: createMemoryMcpTaskStore(),
      },
    });
    const discovered = await body(
      await dispatchMcp(
        server,
        { id: "user-1" },
        [],
        rpc("server/discover", {}),
      ),
    );
    expect(discovered.result).toMatchObject({
      capabilities: {
        extensions: { "io.modelcontextprotocol/tasks": {} },
      },
    });
  });

  test("creates a durable task and returns its completed result", async () => {
    const taskStore = createMemoryMcpTaskStore();
    const { server } = config(allowAllPolicy(), {
      tasks: {
        authorizationKey: (caller) => caller.id,
        pollIntervalMs: 1,
        shouldCreate: () => true,
        store: taskStore,
        ttlMs: 60_000,
      },
    });
    const created = await body(
      await dispatchMcp(
        server,
        { id: "user-1" },
        ["messages:send"],
        rpc("tools/call", { ...taskCapability, name: "send" }),
      ),
    );
    const task = created.result as { taskId: string; resultType: string };
    expect(task.resultType).toBe("task");
    await Bun.sleep(10);
    const completed = await body(
      await dispatchMcp(
        server,
        { id: "user-1" },
        ["messages:send"],
        rpc("tasks/get", { taskId: task.taskId }),
      ),
    );
    expect(completed.result).toMatchObject({
      resultType: "complete",
      status: "completed",
    });
  });

  test("binds task handles to the authenticated caller", async () => {
    const taskStore = createMemoryMcpTaskStore();
    const { server } = config(allowAllPolicy(), {
      tasks: {
        authorizationKey: (caller) => caller.id,
        shouldCreate: () => true,
        store: taskStore,
      },
    });
    const created = await body(
      await dispatchMcp(
        server,
        { id: "user-1" },
        ["messages:send"],
        rpc("tools/call", { ...taskCapability, name: "send" }),
      ),
    );
    const taskId = (created.result as { taskId: string }).taskId;
    const denied = await body(
      await dispatchMcp(
        server,
        { id: "user-2" },
        ["messages:send"],
        rpc("tasks/get", { taskId }),
      ),
    );
    expect((denied.error as Record<string, unknown>).message).toBe(
      "Unknown task",
    );
  });

  test("requires the negotiated extension capability", async () => {
    const { server } = config(allowAllPolicy(), {
      tasks: {
        authorizationKey: (caller) => caller.id,
        shouldCreate: () => true,
        store: createMemoryMcpTaskStore(),
      },
    });
    const response = await body(
      await dispatchMcp(
        server,
        { id: "user-1" },
        ["messages:send"],
        rpc("tools/call", { name: "send" }),
      ),
    );
    expect((response.error as Record<string, unknown>).code).toBe(-32003);
  });
});

describe("MCP 2025-11-25 native tasks", () => {
  const native = { protocolVersion: "2025-11-25" };

  test("advertises native capabilities and tool-level execution support", async () => {
    const { server } = config(allowAllPolicy(), {
      tasks: {
        authorizationKey: (caller) => caller.id,
        shouldCreate: () => false,
        store: createMemoryMcpTaskStore(),
      },
    });
    const initialized = await body(
      await dispatchMcp(
        server,
        { id: "user-1" },
        ["messages:send"],
        rpc("initialize", { capabilities: {}, protocolVersion: "2025-11-25" }),
        native,
      ),
    );
    expect(initialized.result).toMatchObject({
      capabilities: {
        tasks: { cancel: {}, list: {}, requests: { tools: { call: {} } } },
      },
      protocolVersion: "2025-11-25",
    });
    const listed = await body(
      await dispatchMcp(
        server,
        { id: "user-1" },
        ["messages:send"],
        rpc("tools/list", {}),
        native,
      ),
    );
    expect(listed.result).toMatchObject({
      tools: [{ execution: { taskSupport: "optional" }, name: "send" }],
    });
  });

  test("creates, lists, polls, and retrieves an authorization-bound result", async () => {
    const store = createMemoryMcpTaskStore();
    const { server } = config(allowAllPolicy(), {
      tasks: {
        authorizationKey: (caller) => caller.id,
        pollIntervalMs: 1,
        shouldCreate: () => false,
        store,
      },
    });
    const created = await body(
      await dispatchMcp(
        server,
        { id: "user-1" },
        ["messages:send"],
        rpc("tools/call", { name: "send", task: { ttl: 60_000 } }),
        native,
      ),
    );
    const taskId = (created.result as { task: { taskId: string } }).task.taskId;
    expect(created.result).toMatchObject({
      task: { status: "working", taskId, ttl: 60_000 },
    });
    const listed = await body(
      await dispatchMcp(
        server,
        { id: "user-1" },
        [],
        rpc("tasks/list", {}),
        native,
      ),
    );
    expect(listed.result).toMatchObject({ tasks: [{ taskId }] });
    expect(JSON.stringify(listed.result)).not.toContain("authorizationKey");
    expect(JSON.stringify(listed.result)).not.toContain('"result"');

    const result = await body(
      await dispatchMcp(
        server,
        { id: "user-1" },
        [],
        rpc("tasks/result", { taskId }),
        native,
      ),
    );
    expect(result.result).toMatchObject({
      _meta: {
        "io.modelcontextprotocol/related-task": { taskId },
      },
      content: [{ text: "sent", type: "text" }],
      isError: false,
    });
    const hidden = await body(
      await dispatchMcp(
        server,
        { id: "user-2" },
        [],
        rpc("tasks/list", {}),
        native,
      ),
    );
    expect(hidden.result).toMatchObject({ tasks: [] });
  });
});
