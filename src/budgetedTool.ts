import type { McpTool, McpToolReturn } from "./types";
export type McpCreditWorkRequest = {
  requestId: string;
  maxCredits: number;
  input: unknown;
};
/** Wrap a synchronous tool with an explicit per-work credit budget. The executor
 * must bind the caller, claim durable work, track usage, and persist its result.
 * Do not wrap deferred jobs without transferring their budget to the worker. */
export const budgetedMcpTool = (options: {
  tool: McpTool;
  execute: (
    request: McpCreditWorkRequest,
    run: () => Promise<McpToolReturn>,
  ) => Promise<McpToolReturn>;
}): McpTool => {
  const { tool } = options;
  if (
    tool.authorization ||
    tool.commerce ||
    tool.coaz ||
    tool.taskSupport === "required"
  )
    throw new Error(
      "Budget wrapping needs an ordinary tool; preserve its authorization and commerce contract separately",
    );
  return {
    ...tool,
    annotations: { ...tool.annotations, readOnlyHint: false },
    outputSchema: undefined,
    commerce: { action: "paid_access", categories: ["usage_credits"] },
    taskSupport: "forbidden",
    description: `${tool.description}\nProvide a stable requestId and the maximum service credits this work may charge. Retry with the same ID and exact input to retrieve existing work; never invent a new ID to retry an uncertain effect.`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["requestId", "maxCredits", "input"],
      properties: {
        requestId: { type: "string", minLength: 1, maxLength: 128 },
        maxCredits: {
          type: "integer",
          minimum: 1,
          maximum: Number.MAX_SAFE_INTEGER,
        },
        input: tool.inputSchema,
      },
    },
    handler: async (args, context) => {
      if (args === null || typeof args !== "object" || Array.isArray(args))
        throw new Error("Invalid credit work request");
      const { requestId, maxCredits, input } = args as Record<string, unknown>;
      if (
        typeof requestId !== "string" ||
        !requestId ||
        requestId.length > 128 ||
        typeof maxCredits !== "number" ||
        !Number.isSafeInteger(maxCredits) ||
        maxCredits < 1 ||
        !("input" in args)
      )
        throw new Error(
          "A request ID, positive credit budget, and input are required",
        );
      return options.execute({ requestId, maxCredits, input }, async () =>
        tool.handler(input, context),
      );
    },
  };
};
