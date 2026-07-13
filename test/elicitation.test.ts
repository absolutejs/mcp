import { describe, expect, test } from "bun:test";
import { createMcpClient } from "../src/client";
import { feedbackTools, FEEDBACK_INSTRUCTIONS } from "../src/feedback";
import { createMcpHandler } from "../src/handler";
import type {
  McpElicitResult,
  McpServerConfig,
  McpToolRegistry,
} from "../src/types";

type Caller = { id: string };
const caller: Caller = { id: "u1" };

/** A tool that cannot finish without asking the user something — the whole
 *  reason elicitation exists. */
const bookingTools = (): McpToolRegistry => ({
  book_table: {
    description: "Book a table; asks the user for the party size.",
    handler: async (_args, context) => {
      if (!context.canElicit) {
        return "This client can't ask you anything — tell me the party size.";
      }
      const answer = await context.elicit({
        message: "How many people?",
        requestedSchema: {
          properties: { people: { minimum: 1, type: "integer" } },
          required: ["people"],
          type: "object",
        },
      });
      if (answer.action === "decline") return "No problem — cancelled.";
      if (answer.action !== "accept") return "Dropped it.";

      return `Booked for ${String(answer.content.people)}.`;
    },
    inputSchema: { type: "object" },
    mayElicit: true,
  },
  plain: {
    description: "A tool that never asks anything.",
    handler: () => "fine",
    inputSchema: { type: "object" },
  },
});

const serverConfig = (): McpServerConfig<Caller> => ({
  authorize: async () => ({ caller, ok: true }),
  elicitation: { enabled: true },
  instructions: `Book tables. ${FEEDBACK_INSTRUCTIONS}`,
  issuer: "https://example.test",
  path: "/mcp",
  serverInfo: { name: "diner", version: "1.0.0" },
  tools: ({ caller: who }) => ({
    ...bookingTools(),
    ...feedbackTools({ caller: who, store: feedbackStore }),
  }),
});

const filed: unknown[] = [];
const feedbackStore = {
  reportProblem: (input: unknown) => {
    filed.push(input);

    return "Filed as ticket 42.";
  },
  submitFeedback: (input: unknown) => {
    filed.push(input);
  },
};

/** Wire the client straight into the handler — one process, real HTTP
 *  semantics, no network. The client's answer to an elicitation arrives as its
 *  own POST, exactly as it would over the wire. */
const connect = (
  onElicit?: (req: {
    message: string;
  }) => McpElicitResult | Promise<McpElicitResult>,
) => {
  const config = serverConfig();
  const handler = createMcpHandler(config);
  const request = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const req = input instanceof Request ? input : new Request(input, init);

    return (await handler(req)) ?? new Response("nf", { status: 404 });
  }) as typeof fetch;

  return createMcpClient({
    request,
    url: "https://example.test/mcp",
    ...(onElicit === undefined ? {} : { onElicit }),
  });
};

describe("elicitation", () => {
  test("the server asks, the user answers, the tool finishes", async () => {
    const client = connect(() => ({
      action: "accept",
      content: { people: 4 },
    }));
    await client.initialize();
    const result = await client.callTool("book_table");
    expect(result.content[0]?.type).toBe("text");
    expect(JSON.stringify(result.content)).toContain("Booked for 4.");
  });

  test("a declined question is a decline, not a fabricated answer", async () => {
    const client = connect(() => ({ action: "decline" }));
    await client.initialize();
    const result = await client.callTool("book_table");
    expect(JSON.stringify(result.content)).toContain("cancelled");
  });

  test("a client with no elicit handler is told so, and never asked", async () => {
    // No onElicit → the capability is not declared → canElicit is false, and
    // the tool takes its fallback path instead of hanging.
    const client = connect();
    await client.initialize();
    const result = await client.callTool("book_table");
    expect(JSON.stringify(result.content)).toContain("can't ask you anything");
  });

  test("tools that never elicit still answer with plain JSON", async () => {
    const client = connect(() => ({ action: "accept", content: {} }));
    await client.initialize();
    const result = await client.callTool("plain");
    expect(JSON.stringify(result.content)).toContain("fine");
  });
});

describe("feedbackTools", () => {
  test("the tools are exposed and carry the user's own words", async () => {
    const client = connect();
    await client.initialize();
    const names = (await client.listTools()).map((tool) => tool.name);
    expect(names).toContain("report_problem");
    expect(names).toContain("submit_feedback");

    const reported = await client.callTool("report_problem", {
      problem: "the booking never confirms",
    });
    expect(JSON.stringify(reported.content)).toContain("ticket 42");

    await client.callTool("submit_feedback", {
      rating: "bad",
      reason: "it kept asking me the same thing",
      tool: "book_table",
    });
    expect(filed.length).toBeGreaterThanOrEqual(2);
  });

  test("the instructions tell the model to report, not apologise", () => {
    expect(FEEDBACK_INSTRUCTIONS).toContain("INSTEAD of only apologising");
  });
});
