import type { McpTool } from "./types";
const record = (input: unknown): input is Record<string, unknown> =>
  typeof input === "object" && input !== null && !Array.isArray(input);
export type McpPurchaseStatus = {
  purchaseId: string;
  status:
    | "not_started"
    | "pending"
    | "approved"
    | "declined"
    | "refunded"
    | "reconciliation";
  creditsGranted: number;
};
/** The issuer is bound to the authenticated account and canonical server pricing.
 * Register only through the commerce guard. This tool never takes payment data. */
export const createCheckoutHandoffTool = (options: {
  origin: string;
  issue: (
    productId: string,
  ) => Promise<{ purchaseId: string; url: string; expiresAt: string }>;
}): McpTool => ({
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
    title: "Open credit checkout",
  },
  commerce: { action: "external_checkout", categories: ["usage_credits"] },
  description:
    "Prepare a short-lived credit-purchase link on the service website. The user reviews and explicitly pays there. Never send card data in chat. Does not charge a card or create a subscription.",
  inputSchema: {
    type: "object",
    properties: { productId: { type: "string", minLength: 1, maxLength: 128 } },
    required: ["productId"],
    additionalProperties: false,
  },
  handler: async (input) => {
    if (
      !record(input) ||
      Object.keys(input).length !== 1 ||
      typeof input.productId !== "string" ||
      !input.productId ||
      input.productId.length > 128
    )
      throw new Error("A productId is required");
    const result = await options.issue(input.productId);
    const url = new URL(result.url);
    if (
      url.protocol !== "https:" ||
      url.origin !== new URL(options.origin).origin ||
      url.username ||
      url.password ||
      !Number.isFinite(Date.parse(result.expiresAt))
    )
      throw new Error("Invalid checkout handoff");
    return {
      content: [
        {
          type: "text",
          text: `Review and pay on ${url.hostname}: ${url.href}. Expires ${result.expiresAt}. No payment has been made.`,
        },
      ],
      structuredContent: {
        purchaseId: result.purchaseId,
        url: url.href,
        expiresAt: result.expiresAt,
      },
    };
  },
});
export const createPurchaseStatusTool = (options: {
  read: (purchaseId: string) => Promise<McpPurchaseStatus | null>;
}): McpTool => ({
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  commerce: { action: "entitlement_status", categories: ["usage_credits"] },
  description:
    "Read this account's credit-purchase status. Available at zero balance. Does not initiate or retry payment.",
  inputSchema: {
    type: "object",
    properties: {
      purchaseId: { type: "string", minLength: 1, maxLength: 128 },
    },
    required: ["purchaseId"],
    additionalProperties: false,
  },
  handler: async (input) => {
    if (
      !record(input) ||
      Object.keys(input).length !== 1 ||
      typeof input.purchaseId !== "string" ||
      !input.purchaseId ||
      input.purchaseId.length > 128
    )
      throw new Error("A purchaseId is required");
    const value = await options.read(input.purchaseId);
    if (!value) return "No purchase with that ID exists for this account.";
    if (
      value.purchaseId !== input.purchaseId ||
      ![
        "not_started",
        "pending",
        "approved",
        "declined",
        "refunded",
        "reconciliation",
      ].includes(value.status) ||
      !Number.isSafeInteger(value.creditsGranted) ||
      value.creditsGranted < 0
    )
      throw new Error("Purchase status is unavailable");
    const summary = {
      purchaseId: value.purchaseId,
      status: value.status,
      creditsGranted: value.creditsGranted,
    };
    return {
      content: [
        {
          type: "text",
          text: `Purchase ${summary.status}; ${summary.creditsGranted} credits granted.`,
        },
      ],
      structuredContent: summary,
    };
  },
});
