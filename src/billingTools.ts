import {
  parseReceiptPage,
  parseUsageRange,
  projectBillingStatus,
  projectReceiptPage,
  projectUsageReport,
  type BillingStatus,
  type ReceiptPage,
  type ReceiptPageRequest,
  type UsageRange,
  type CustomerUsageReport,
} from "@absolutejs/billing/reports";
import type { McpToolRegistry, McpToolResult } from "./types";
const result = (text: string, data: object): McpToolResult => ({
  content: [{ type: "text", text }],
  structuredContent: { ...data },
});
const empty = (input: unknown) => {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length
  )
    throw new Error("This tool takes no arguments");
};
/** Bind each reader to the authenticated account. Keep these reads outside
 * paid-work gates; never include account IDs or provider credentials in input. */
export const createBillingReportTools = (readers: {
  status: () => Promise<BillingStatus>;
  receipts: (request: ReceiptPageRequest) => Promise<ReceiptPage>;
  usage: (range: UsageRange) => Promise<CustomerUsageReport>;
  now?: () => Date;
}): McpToolRegistry => ({
  get_billing_status: {
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    commerce: {
      action: "entitlement_status",
      categories: ["usage_credits", "subscription"],
    },
    description:
      "Read subscription and service-credit status for this account, including reserved credits and debt. Does not charge, renew or cancel anything. Available at zero balance.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    handler: async (input) => {
      empty(input);
      const status = projectBillingStatus(await readers.status());
      return result(
        `${status.credits.remaining} service credits available, ${status.credits.reserved} reserved. Portal access: ${status.portalAccess ? "enabled" : "not enabled"}. Automatic refill is off.`,
        status,
      );
    },
  },
  list_receipts: {
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    commerce: {
      action: "entitlement_status",
      categories: ["usage_credits", "subscription"],
    },
    description:
      "List this account's payment receipts, newest first, with original amounts and refunds recorded to date. Amounts are currency minor units, not consumed credits. Follow nextCursor for more. No payment credentials or provider references are exposed.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        cursor: { type: ["string", "null"], maxLength: 256 },
      },
      additionalProperties: false,
    },
    handler: async (input) => {
      const request = parseReceiptPage(input);
      const page = projectReceiptPage(
        await readers.receipts(request),
        request.limit,
      );
      return result(
        `${page.receipts.length} receipts.${page.nextCursor ? " More receipts are available using nextCursor." : ""}`,
        page,
      );
    },
  },
  get_usage_report: {
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    commerce: { action: "entitlement_status", categories: ["usage_credits"] },
    description:
      "Read recorded service-credit consumption by UTC day and feature. from is inclusive and to is exclusive; at most 90 days, default last 30 days including today. Credits consumed are not dollars paid or the assistant's own tokens. Does not estimate ROI or expose internal provider costs.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", format: "date" },
        to: { type: "string", format: "date" },
      },
      additionalProperties: false,
    },
    handler: async (input) => {
      const range = parseUsageRange(input, readers.now?.());
      const usage = projectUsageReport(await readers.usage(range), range);
      return result(
        `${usage.creditsConsumed} service credits across ${usage.events} recorded events, ${range.from} inclusive to ${range.to} exclusive (UTC).`,
        usage,
      );
    },
  },
});
/** This destination can initiate purchases, so it must retain the checkout
 * classification. A generic billing-page label cannot bypass host rules. */
export const createBillingManagementTool = (destination: string) => {
  const url = new URL(destination);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Billing management requires a fixed HTTPS page URL");
  return {
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    commerce: {
      action: "external_checkout" as const,
      categories: ["usage_credits" as const, "subscription" as const],
    },
    description:
      "Open the service's authenticated billing page to buy credits, review receipts, or manage an existing subscription. Uses a matching browser login; may require sign-in. This link does not grant a login session or authorize any payment.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    handler: async (input: unknown) => {
      empty(input);
      return result(
        `Manage billing on ${url.hostname}: ${url.href}. Sign in if needed; changes require your confirmation.`,
        { url: url.href, requiresBrowserAuthentication: true },
      );
    },
  };
};
