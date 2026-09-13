import { budgetedMcpTool, type McpCreditWorkRequest } from "./budgetedTool";
import type { McpTool, McpToolRegistry, McpToolResult } from "./types";

export type McpBackgroundWorkEstimate = {
  minimumCredits: number;
  estimatedCredits: number;
  totalSteps: number;
  assumptions: string;
};
/** Public output only. Adapters must scope reads to the authenticated account. */
export type McpBackgroundWorkSnapshot = {
  status: "queued" | "running" | "completed" | "stopped" | "failed" | "unknown";
  budget: number;
  charged: number;
  settled: boolean;
  totalSteps: number;
  results: unknown[];
};
export const createBackgroundWorkResult = (
  requestId: string,
  work: McpBackgroundWorkSnapshot,
): McpToolResult => {
  if (!requestId || requestId.length > 128 ||
    !Number.isSafeInteger(work.budget) || work.budget < 1 ||
    !Number.isSafeInteger(work.charged) || work.charged < 0 || work.charged > work.budget ||
    !Number.isSafeInteger(work.totalSteps) || work.totalSteps < 1 ||
    !Array.isArray(work.results) || work.results.length > work.totalSteps ||
    typeof work.settled !== "boolean" ||
    !["queued", "running", "completed", "stopped", "failed", "unknown"].includes(work.status))
    throw new Error("Invalid background work snapshot");
  const summary = {
    requestId, status: work.status, maxCredits: work.budget,
    creditsCharged: work.charged, settled: work.settled,
    totalSteps: work.totalSteps, completedSteps: work.results.length,
    results: work.results,
    message: work.status === "unknown"
      ? "A step has an uncertain outcome. Saved results remain available; credits stay held pending reconciliation. Do not start another job to retry it."
      : "Read get_background_work with this requestId to recover saved progress and spend. Reading never starts or repeats work.",
  };
  return { content: [{ type: "text", text: JSON.stringify(summary) }], structuredContent: summary, isError: work.status === "failed" || work.status === "unknown" };
};

/** Durable dispatch is the adapter's responsibility: atomically reserve, bind
 * and enqueue before returning. Start must deduplicate exact IDs/input/budget.
 * Omit start to expose account recovery without allowing new paid work. */
export const createBackgroundWorkTools = (options: {
  description: string;
  inputSchema: McpTool["inputSchema"];
  estimate?: (input: unknown) => Promise<McpBackgroundWorkEstimate>;
  start?: (request: McpCreditWorkRequest) => Promise<McpBackgroundWorkSnapshot>;
  read: (requestId: string) => Promise<McpBackgroundWorkSnapshot | null>;
}): McpToolRegistry => {
  const tools: McpToolRegistry = {
    get_background_work: {
      description: "Recover this account's saved background work, partial results and credit spend. Read-only; available without credits. Never restarts a provider call.",
      annotations: { readOnlyHint: true },
      commerce: { action: "entitlement_status", categories: ["usage_credits"] },
      inputSchema: { type: "object", additionalProperties: false, required: ["requestId"], properties: { requestId: { type: "string", minLength: 1, maxLength: 128 } } },
      handler: async (args) => {
        const requestId = args && typeof args === "object" && !Array.isArray(args) ? Reflect.get(args, "requestId") : undefined;
        if (typeof requestId !== "string" || !requestId || requestId.length > 128) throw new Error("A request ID is required");
        const work = await options.read(requestId);
        if (!work) return { content: [{ type: "text", text: "No background work found for this account and request ID." }], isError: true };
        return createBackgroundWorkResult(requestId, work);
      },
    },
  };
  const estimate = options.estimate;
  if (estimate) tools.estimate_background_work = {
    description: "Estimate service credits for a background plan without reserving credits or starting work. The minimum admits one step; the total estimates the whole plan. Actual usage varies. Get the user's approval for the maximum before starting; never silently increase it.",
    annotations: { readOnlyHint: true },
    commerce: { action: "paid_access", categories: ["usage_credits"] },
    inputSchema: options.inputSchema,
    handler: async (input) => {
      const value = await estimate(input);
      if (![value.minimumCredits, value.estimatedCredits, value.totalSteps].every(Number.isSafeInteger) || value.minimumCredits < 1 || value.estimatedCredits < value.minimumCredits || value.totalSteps < 1 || typeof value.assumptions !== "string" || !value.assumptions)
        throw new Error("Invalid background work estimate");
      const summary = {
        minimumCredits: value.minimumCredits, estimatedCredits: value.estimatedCredits,
        totalSteps: value.totalSteps, assumptions: value.assumptions,
        message: "Estimate only, not a quote or guarantee. No credits reserved and no work started. Admission is checked again at start and before each step; work can stop with partial results. The approved maximum charge is never increased.",
      };
      return { content: [{ type: "text", text: JSON.stringify(summary) }], structuredContent: summary };
    },
  };
  const start = options.start;
  if (start) tools.start_background_work = budgetedMcpTool({
    tool: {
      description: `${options.description} Use estimate_background_work when available before asking for a budget. Launch bounded background work only after the user agrees to the plan and maximum credits. Return the requestId promptly; poll get_background_work for progress.`,
      inputSchema: options.inputSchema,
      handler: async () => { throw new Error("Background work must use durable dispatch"); },
    },
    execute: async (request) => createBackgroundWorkResult(request.requestId, await start(request)),
  });
  return tools;
};
