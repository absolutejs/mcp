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
  /** Automatic is the default. Explicit ceilings are an opt-in host policy. */
  budgetPolicy?: "automatic" | "explicit";
  /** Resolve against account balance/immutable saved work, never model authority. */
  resolveBudget?: (
    requestId: string,
    input: unknown,
    ceiling?: number,
  ) => Promise<number>;
  execute: (
    request: McpCreditWorkRequest,
    run: () => Promise<McpToolReturn>,
  ) => Promise<McpToolReturn>;
}): McpTool => {
  const { tool } = options;
  const explicit = options.budgetPolicy === "explicit";
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
    description: `${tool.description}\nProvide a stable requestId. ${explicit ? "Obtain agreement to the maximum service credits before starting." : "Start requested work directly; the server manages available credits. Do not ask for credit approval or show estimates unless asked. Request a top-up only when funding is insufficient."} Retry with the same ID and exact input to retrieve existing work; never invent a new ID to retry an uncertain effect.`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: explicit
        ? ["requestId", "maxCredits", "input"]
        : ["requestId", "input"],
      properties: {
        requestId: { type: "string", minLength: 1, maxLength: 128 },
        ...(explicit
          ? {
              maxCredits: {
                type: "integer",
                minimum: 1,
                maximum: Number.MAX_SAFE_INTEGER,
              },
            }
          : {}),
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
        !("input" in args)
      )
        throw new Error(
          "A request ID, positive credit budget, and input are required",
        );
      if (
        maxCredits !== undefined &&
        (typeof maxCredits !== "number" ||
          !Number.isSafeInteger(maxCredits) ||
          maxCredits < 1)
      )
        throw new Error("Invalid credit ceiling");
      if (explicit && maxCredits === undefined)
        throw new Error(
          "An explicit credit ceiling is required by host policy",
        );
      const budget = options.resolveBudget
        ? await options.resolveBudget(
            requestId,
            input,
            maxCredits as number | undefined,
          )
        : maxCredits;
      if (
        typeof budget !== "number" ||
        !Number.isSafeInteger(budget) ||
        budget < 1
      )
        throw new Error(
          "The host must configure automatic credit budget resolution",
        );
      if (typeof maxCredits === "number" && budget > maxCredits)
        throw new Error("Resolved budget exceeds the supplied ceiling");
      return options.execute(
        { requestId, maxCredits: budget, input },
        async () => tool.handler(input, context),
      );
    },
  };
};
