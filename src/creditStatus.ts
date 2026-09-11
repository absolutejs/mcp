import type { McpTool } from "./types";

/** Service credits, not currency or the host model's token usage. */
export type McpCreditBalance = {
  allowance: number;
  consumed: number;
  remaining: number;
  periodEnd: string | null;
};

/** Account identity belongs in the bound reader, never model input. Keep this
 * tool outside paid-work balance gates so exhausted users can recover. */
export const createCreditBalanceTool = (options: {
  read: () => McpCreditBalance | Promise<McpCreditBalance>;
}): McpTool => ({
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    title: "Credit balance",
  },
  commerce: { action: "entitlement_status", categories: ["usage_credits"] },
  description:
    "Read this account's service-credit allowance, consumption and remaining balance. Does not purchase credits or report the AI assistant's own token usage.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: {
    type: "object",
    required: ["allowance", "consumed", "remaining", "periodEnd", "unit"],
    properties: {
      allowance: { type: "integer", minimum: 0 },
      consumed: { type: "integer", minimum: 0 },
      remaining: { type: "integer", minimum: 0 },
      periodEnd: { type: ["string", "null"] },
      unit: { const: "service_credits" },
    },
    additionalProperties: false,
  },
  handler: async () => {
    const balance = await options.read();
    if (
      ![balance.allowance, balance.consumed, balance.remaining].every(
        (n) => Number.isSafeInteger(n) && n >= 0,
      ) ||
      (balance.periodEnd !== null &&
        !Number.isFinite(Date.parse(balance.periodEnd)))
    )
      throw new Error("Credit balance is unavailable");
    // Project fields explicitly: readers may carry private account/provider data.
    const summary = {
      allowance: balance.allowance,
      consumed: balance.consumed,
      remaining: balance.remaining,
      periodEnd: balance.periodEnd,
      unit: "service_credits",
    };
    return {
      content: [
        {
          type: "text",
          text: `${summary.remaining} service credits remaining; ${summary.consumed} consumed.`,
        },
      ],
      structuredContent: summary,
    };
  },
});
