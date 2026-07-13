import { describe, expect, test } from "bun:test";
import { createMcpHandler } from "../src/handler";
import type {
  McpElicitAnswer,
  McpElicitBus,
  McpServerConfig,
  McpSessionStore,
} from "../src/types";

type Caller = { id: string };
const caller: Caller = { id: "u1" };

/** TWO instances behind a load balancer with NO sticky routing. Instance A runs
 *  the tool call and asks the question; the client's answer lands on instance
 *  B. Without a shared store B wouldn't even recognise the session; without a
 *  bus the answer would die on B while A waits forever. */

// A "database" both instances read — the session state is an id and a flag.
const sharedStore = (): McpSessionStore => {
  const rows = new Map<string, { canElicit: boolean }>();

  return {
    create: (session) => {
      const id = crypto.randomUUID();
      rows.set(id, { canElicit: session.canElicit });

      return id;
    },
    drop: (id) => {
      rows.delete(id);
    },
    get: (id) => rows.get(id) ?? null,
  };
};

// A "Postgres LISTEN/NOTIFY" — publish reaches every OTHER instance.
const sharedBus = () => {
  const handlers: ((answer: McpElicitAnswer) => void)[] = [];

  return {
    busFor: (): McpElicitBus => ({
      publish: (answer) => {
        // Fan out to everyone; each instance ignores what isn't theirs.
        handlers.forEach((handler) => {
          handler(answer);
        });
      },
      subscribe: (handler) => {
        handlers.push(handler);
      },
    }),
    delivered: handlers,
  };
};

const instance = (store: McpSessionStore, bus: McpElicitBus) => {
  const config: McpServerConfig<Caller> = {
    authorize: async () => ({ caller, ok: true }),
    elicitation: { bus, enabled: true, store },
    issuer: "https://example.test",
    path: "/mcp",
    serverInfo: { name: "diner", version: "1.0.0" },
    tools: () => ({
      book_table: {
        description: "Book a table.",
        handler: async (_args, context) => {
          const answer = await context.elicit({
            message: "How many people?",
            requestedSchema: {
              properties: { people: { type: "integer" } },
              type: "object",
            },
          });

          return answer.action === "accept"
            ? `Booked for ${String(answer.content.people)}.`
            : `No booking (${answer.action}).`;
        },
        inputSchema: { type: "object" },
        mayElicit: true,
      },
    }),
  };

  return createMcpHandler(config);
};

const post = (
  handler: ReturnType<typeof createMcpHandler>,
  body: unknown,
  sessionId?: string,
) =>
  handler(
    new Request("https://example.test/mcp", {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        ...(sessionId === undefined ? {} : { "mcp-session-id": sessionId }),
      },
      method: "POST",
    }),
  );

describe("elicitation across instances", () => {
  test("A asks, the answer lands on B, and A's tool call still finishes", async () => {
    const store = sharedStore();
    const bus = sharedBus();
    const instanceA = instance(store, bus.busFor());
    const instanceB = instance(store, bus.busFor());
    expect(bus.delivered.length).toBe(2); // both subscribed

    // The client initializes against A and gets a session.
    const init = await post(instanceA, {
      id: 1,
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        capabilities: { elicitation: {} },
        protocolVersion: "2025-06-18",
      },
    });
    const sessionId = init?.headers.get("mcp-session-id") ?? "";
    expect(sessionId).not.toBe("");

    // The tool call runs on A. It will block on the question.
    const callPromise = post(
      instanceA,
      {
        id: 2,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "book_table" },
      },
      sessionId,
    );
    const streamed = await callPromise;
    const reader = streamed?.body?.getReader();
    const decoder = new TextDecoder();

    // Read the question off A's stream.
    const first = await reader?.read();
    const question = decoder.decode(first?.value);
    expect(question).toContain("elicitation/create");
    const askedId = String(
      JSON.parse(question.slice(question.indexOf("{"))).id,
    );

    // The user answers — and their POST hits INSTANCE B, which knows the
    // session (shared store) but is not the one waiting.
    const ack = await post(
      instanceB,
      {
        id: askedId,
        jsonrpc: "2.0",
        result: { action: "accept", content: { people: 4 } },
      },
      sessionId,
    );
    expect(ack?.status).toBe(202);

    // A was waiting, the bus carried the answer to it, and the call completes.
    const second = await reader?.read();
    const result = decoder.decode(second?.value);
    expect(result).toContain("Booked for 4.");
  });

  test("without a bus, an answer on the wrong instance is not silently lost — it just isn't ours", async () => {
    // The store is shared but nothing routes answers. B accepts the POST (202,
    // as the transport demands) and simply cannot place it. This is the failure
    // mode the bus exists to prevent, pinned so it can't regress into a crash.
    const store = sharedStore();
    const instanceA = instance(store, {
      publish: () => {},
      subscribe: () => {},
    });
    const instanceB = instance(store, {
      publish: () => {},
      subscribe: () => {},
    });
    const init = await post(instanceA, {
      id: 1,
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        capabilities: { elicitation: {} },
        protocolVersion: "2025-06-18",
      },
    });
    const sessionId = init?.headers.get("mcp-session-id") ?? "";
    const ack = await post(
      instanceB,
      {
        id: "elicit_nobody-is-waiting",
        jsonrpc: "2.0",
        result: { action: "accept", content: {} },
      },
      sessionId,
    );
    expect(ack?.status).toBe(202);
  });
});
