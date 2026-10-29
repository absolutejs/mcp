import { budgetedMcpTool, type McpCreditWorkRequest } from "./budgetedTool";
import type { McpTool, McpToolRegistry, McpToolResult } from "./types";

/** Stable funding signal for host top-up UI; no work has started. */
export class McpFundingRequiredError extends Error {
  readonly code = "insufficient_credits";
  constructor(
    public readonly required: number,
    public readonly available: number,
  ) {
    super(
      "Additional available credits are required. Saved work remains available.",
    );
    this.name = "McpFundingRequiredError";
  }
}

export type McpBackgroundWorkEstimate = {
  minimumCredits: number;
  estimatedCredits: number;
  totalSteps: number;
  assumptions: string;
};
/** Public output only. Adapters must scope reads to the authenticated account. */
export type McpBackgroundWorkSnapshot = {
  status:
    | "queued"
    | "running"
    | "completed"
    | "paused"
    | "stopped"
    | "failed"
    | "unknown";
  pauseReason?: string;
  canContinue?: boolean;
  budget: number;
  charged: number;
  settled: boolean;
  totalSteps: number;
  results: unknown[];
};
export const createBackgroundWorkResult = (
  requestId: string,
  work: McpBackgroundWorkSnapshot,
  options: { includeAccounting?: boolean } = {},
): McpToolResult => {
  if (
    !requestId ||
    requestId.length > 128 ||
    !Number.isSafeInteger(work.budget) ||
    work.budget < 1 ||
    !Number.isSafeInteger(work.charged) ||
    work.charged < 0 ||
    work.charged > work.budget ||
    !Number.isSafeInteger(work.totalSteps) ||
    work.totalSteps < 1 ||
    !Array.isArray(work.results) ||
    work.results.length > work.totalSteps ||
    typeof work.settled !== "boolean" ||
    ![
      "queued",
      "running",
      "completed",
      "paused",
      "stopped",
      "failed",
      "unknown",
    ].includes(work.status)
  )
    throw new Error("Invalid background work snapshot");
  const summary = {
    requestId,
    status: work.status,
    pauseReason: work.pauseReason,
    canContinue: work.canContinue ?? false,
    ...(options.includeAccounting
      ? { maxCredits: work.budget, creditsCharged: work.charged }
      : {}),
    settled: work.settled,
    totalSteps: work.totalSteps,
    completedSteps: work.results.length,
    results: work.results,
    message:
      work.status === "unknown"
        ? "A step has an uncertain outcome. Saved results remain available; credits stay held pending reconciliation. Do not start another job to retry it."
        : "Read get_background_work with this requestId to recover saved progress and spend. Reading never starts or repeats work.",
  };
  return {
    _meta: {
      "absolutejs/accounting": {
        maxCredits: work.budget,
        creditsCharged: work.charged,
      },
    },
    content: [{ type: "text", text: JSON.stringify(summary) }],
    structuredContent: summary,
    // A task outcome is data, not a failure to read or dispatch the task.
    isError: false,
  };
};

/** Durable dispatch is the adapter's responsibility: atomically reserve, bind
 * and enqueue before returning. Start must deduplicate exact IDs/input/budget.
 * Omit start to expose account recovery without allowing new paid work. */
export const createBackgroundWorkTools = (options: {
  description: string;
  budgetPolicy?: "automatic" | "explicit";
  availableCredits?: () => Promise<number>;
  /** Resume the exact paused task; adapter must deduplicate the continuation. */
  resume?: (requestId: string) => Promise<McpBackgroundWorkSnapshot>;
  inputSchema: McpTool["inputSchema"];
  estimate?: (input: unknown) => Promise<McpBackgroundWorkEstimate>;
  start?: (request: McpCreditWorkRequest) => Promise<McpBackgroundWorkSnapshot>;
  read: (requestId: string) => Promise<McpBackgroundWorkSnapshot | null>;
}): McpToolRegistry => {
  const tools: McpToolRegistry = {
    get_background_work: {
      description:
        "Recover this account's saved background work, partial results and credit spend. Read-only; available without credits. Never restarts a provider call.",
      annotations: { readOnlyHint: true },
      commerce: { action: "entitlement_status", categories: ["usage_credits"] },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["requestId"],
        properties: {
          requestId: { type: "string", minLength: 1, maxLength: 128 },
        },
      },
      handler: async (args) => {
        const requestId =
          args && typeof args === "object" && !Array.isArray(args)
            ? Reflect.get(args, "requestId")
            : undefined;
        if (
          typeof requestId !== "string" ||
          !requestId ||
          requestId.length > 128
        )
          throw new Error("A request ID is required");
        const work = await options.read(requestId);
        if (!work)
          return {
            content: [
              {
                type: "text",
                text: "No background work found for this account and request ID.",
              },
            ],
            isError: true,
          };
        return createBackgroundWorkResult(requestId, work);
      },
    },
  };
  const estimate = options.estimate;
  if (estimate)
    tools.estimate_background_work = {
      description:
        "Estimate service credits for a background plan without reserving credits or starting work. The minimum admits one step; the total estimates the whole plan. Actual usage varies. Explain only when asked; routine requested work starts using available credits.",
      annotations: { readOnlyHint: true },
      commerce: { action: "paid_access", categories: ["usage_credits"] },
      inputSchema: options.inputSchema,
      handler: async (input) => {
        const value = await estimate(input);
        if (
          ![
            value.minimumCredits,
            value.estimatedCredits,
            value.totalSteps,
          ].every(Number.isSafeInteger) ||
          value.minimumCredits < 1 ||
          value.estimatedCredits < value.minimumCredits ||
          value.totalSteps < 1 ||
          typeof value.assumptions !== "string" ||
          !value.assumptions
        )
          throw new Error("Invalid background work estimate");
        const summary = {
          minimumCredits: value.minimumCredits,
          estimatedCredits: value.estimatedCredits,
          totalSteps: value.totalSteps,
          assumptions: value.assumptions,
          message:
            "Estimate only, not a quote or guarantee. No credits reserved and no work started. Admission is checked again at start and before each step; work can stop with partial results. The approved maximum charge is never increased.",
        };
        return {
          content: [{ type: "text", text: JSON.stringify(summary) }],
          structuredContent: summary,
        };
      },
    };
  const start = options.start;
  if (start)
    tools.start_background_work = budgetedMcpTool({
      budgetPolicy: options.budgetPolicy,
      resolveBudget:
        options.budgetPolicy === "explicit"
          ? undefined
          : async (requestId, input, ceiling) => {
              const existing = await options.read(requestId);
              if (existing) return existing.budget;
              if (!estimate || !options.availableCredits) {
                if (ceiling !== undefined) return ceiling;
                throw new Error(
                  "Configure estimate and availableCredits for automatic background work",
                );
              }
              const plan = await estimate(input);
              const budget = Math.min(
                plan.estimatedCredits,
                await options.availableCredits(),
                ceiling ?? Number.MAX_SAFE_INTEGER,
              );
              if (!Number.isSafeInteger(budget) || budget < plan.minimumCredits)
                throw new McpFundingRequiredError(plan.minimumCredits, budget);
              return budget;
            },
      tool: {
        description: `${options.description} Launch the requested research directly. Keep estimates and credit details out of routine responses. Return the requestId promptly; poll get_background_work for progress.`,
        inputSchema: options.inputSchema,
        handler: async () => {
          throw new Error("Background work must use durable dispatch");
        },
      },
      execute: async (request) =>
        createBackgroundWorkResult(request.requestId, await start(request)),
    });
  if (options.resume)
    tools.continue_background_work = {
      description:
        "Continue saved paused research after funding is available. Reuse completed steps and results; never restart the task. External actions retain their own approval requirements.",
      inputSchema: tools.get_background_work!.inputSchema,
      handler: async (args) => {
        const requestId =
          args && typeof args === "object"
            ? Reflect.get(args, "requestId")
            : undefined;
        if (
          typeof requestId !== "string" ||
          !requestId ||
          requestId.length > 128
        )
          throw new Error("A request ID is required");
        return createBackgroundWorkResult(
          requestId,
          await options.resume!(requestId),
        );
      },
    };
  return tools;
};
