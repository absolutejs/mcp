import { expect, test } from "bun:test";
import { budgetedMcpTool } from "../src/budgetedTool";
import type { McpTool, McpToolCallContext } from "../src/types";
const context: McpToolCallContext = {
  canElicit: false,
  canElicitUrl: false,
  elicit: async () => ({ action: "unsupported" }),
};
test("credit wrapper validates budget before execution and forwards only nested tool input", async () => {
  let calls = 0;
  const tool: McpTool = {
    description: "Read",
    inputSchema: { type: "object" },
    handler: (input) => {
      calls++;
      return JSON.stringify(input);
    },
  };
  const wrapped = budgetedMcpTool({
    tool,
    execute: async (request, run) => {
      expect(request.maxCredits).toBe(10);
      return run();
    },
  });
  expect(wrapped.commerce?.action).toBe("paid_access");
  await expect(
    wrapped.handler({ requestId: "id", maxCredits: -1, input: {} }, context),
  ).rejects.toThrow("positive credit budget");
  expect(calls).toBe(0);
  expect(
    await wrapped.handler(
      { requestId: "id", maxCredits: 10, input: { query: "x" } },
      context,
    ),
  ).toBe('{"query":"x"}');
  expect(calls).toBe(1);
});
test("wrapping cannot silently alter existing commerce and required-task contracts", () => {
  const tool: McpTool = {
    description: "Read",
    inputSchema: {},
    handler: () => "ok",
    taskSupport: "required",
  };
  expect(() => budgetedMcpTool({ tool, execute: async () => "no" })).toThrow(
    "ordinary tool",
  );
  expect(() =>
    budgetedMcpTool({
      tool: {
        ...tool,
        taskSupport: "forbidden",
        commerce: {
          action: "external_checkout",
          categories: ["usage_credits"],
        },
      },
      execute: async () => "no",
    }),
  ).toThrow("ordinary tool");
});
