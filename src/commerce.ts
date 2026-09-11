/** Host commerce eligibility, not payment authorization. All inputs are
 * server-owned; never derive a permissive profile from clientInfo alone. */
export const COMMERCE_POLICY_VERSION = "2026-09-10.1";
export const COMMERCE_POLICY_SOURCES = Object.freeze({
  claude:
    "https://support.claude.com/en/articles/13454812-use-interactive-connectors-in-claude",
  chatgpt:
    "https://developers.openai.com/plugins/app-guidelines#commerce-and-monetization",
  chatgptCheckout: "https://developers.openai.com/plugins/build/monetization",
  cursorMarketplace: "https://cursor.com/marketplace-publisher-terms",
});
export type CommerceAction =
  | "entitlement_status"
  | "informational_link"
  | "paid_access"
  | "pricing"
  | "external_checkout"
  | "saved_method_purchase"
  | "new_method_collection"
  | "subscription"
  | "automatic_refill";
export type CommerceCategory =
  | "physical_goods"
  | "digital_service"
  | "usage_credits"
  | "subscription";
export type CommerceProfile =
  | "claude-interactive"
  | "chatgpt-plugin"
  | "cursor-marketplace"
  | "direct-mcp"
  | "self-hosted"
  | "unknown";
export type CommerceRequirement = {
  action: CommerceAction;
  /** All product categories this tool can expose, including every cart line.
   * Dynamic catalogs must be classified by the server before registration. */
  categories: readonly CommerceCategory[];
};
export type CommerceReview = {
  id: string;
  profile: CommerceProfile;
  actions: readonly CommerceAction[];
  categories: readonly CommerceCategory[];
  reviewedAt: string;
  expiresAt: string;
  sourceUrls: readonly string[];
};
export type CommerceContext = {
  /** Ambiguous channels are evaluated as the intersection of their rules. */
  profiles: readonly CommerceProfile[];
  reviews?: readonly CommerceReview[];
  /** Reviewed and tested capabilities; these do not establish permission. */
  capabilities?: {
    externalLinks?: boolean;
    interactiveUi?: boolean;
    nativePaymentSheet?: boolean;
  };
};
export type CommerceDecision = {
  allowed: boolean;
  status: "permitted" | "restricted" | "unverified";
  reason: string;
  policyVersion: string;
  sourceUrls: string[];
  reviewIds: string[];
};
const actions = new Set<string>([
  "entitlement_status",
  "informational_link",
  "paid_access",
  "pricing",
  "external_checkout",
  "saved_method_purchase",
  "new_method_collection",
  "subscription",
  "automatic_refill",
]);
const categories = new Set<string>([
  "physical_goods",
  "digital_service",
  "usage_credits",
  "subscription",
]);
const profiles = new Set<string>([
  "claude-interactive",
  "chatgpt-plugin",
  "cursor-marketplace",
  "direct-mcp",
  "self-hosted",
  "unknown",
]);
const sales = new Set<CommerceAction>([
  "pricing",
  "external_checkout",
  "saved_method_purchase",
  "new_method_collection",
  "subscription",
  "automatic_refill",
]);
const decision = (
  status: CommerceDecision["status"],
  reason: string,
  sourceUrls: string[] = [],
  reviewIds: string[] = [],
): CommerceDecision => ({
  allowed: status === "permitted",
  status,
  reason,
  policyVersion: COMMERCE_POLICY_VERSION,
  sourceUrls,
  reviewIds,
});
const validSource = (source: string) => {
  try {
    const url = new URL(source);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
};
const reviewed = (
  review: CommerceReview,
  profile: CommerceProfile,
  req: CommerceRequirement,
  now: number,
) =>
  typeof review.id === "string" &&
  review.id.trim().length > 0 &&
  review.profile === profile &&
  Array.isArray(review.actions) &&
  review.actions.includes(req.action) &&
  Array.isArray(review.categories) &&
  req.categories.every((c) => review.categories.includes(c)) &&
  Number.isFinite(Date.parse(review.reviewedAt)) &&
  Date.parse(review.reviewedAt) <= now &&
  Number.isFinite(Date.parse(review.expiresAt)) &&
  Date.parse(review.expiresAt) > now &&
  Array.isArray(review.sourceUrls) &&
  review.sourceUrls.length > 0 &&
  review.sourceUrls.every(validSource);

/** Published restrictions cannot be overridden by a deployment review.
 * Unverified paths need explicit, fresh server-side review evidence. */
export const evaluateCommerce = (
  req: CommerceRequirement,
  context: CommerceContext,
  now = new Date(),
): CommerceDecision => {
  if (
    !req ||
    !actions.has(req.action) ||
    !Array.isArray(req.categories) ||
    req.categories.length === 0 ||
    req.categories.some((c) => !categories.has(c)) ||
    !context ||
    !Array.isArray(context.profiles) ||
    context.profiles.length === 0 ||
    context.profiles.some((p) => !profiles.has(p)) ||
    !Number.isFinite(now.getTime())
  )
    return decision("unverified", "invalid_commerce_context");
  const results = context.profiles.map((profile): CommerceDecision => {
    const digital = req.categories.some((c) => c !== "physical_goods");
    if (profile === "chatgpt-plugin" && digital && sales.has(req.action))
      return decision("restricted", "chatgpt_digital_commerce", [
        COMMERCE_POLICY_SOURCES.chatgpt,
      ]);
    if (
      profile === "claude-interactive" &&
      [
        "saved_method_purchase",
        "new_method_collection",
        "subscription",
        "automatic_refill",
      ].includes(req.action)
    )
      return decision("restricted", "claude_interactive_purchases", [
        COMMERCE_POLICY_SOURCES.claude,
      ]);
    if (profile === "cursor-marketplace" && req.action === "paid_access")
      return decision("restricted", "cursor_marketplace_paid_access", [
        COMMERCE_POLICY_SOURCES.cursorMarketplace,
      ]);
    if (req.action === "entitlement_status")
      return decision("permitted", "non_transactional_status");
    if (req.action === "informational_link" && profile === "chatgpt-plugin")
      return decision("permitted", "chatgpt_entitlement_information", [
        COMMERCE_POLICY_SOURCES.chatgpt,
      ]);
    if (profile === "unknown")
      return decision("unverified", "unknown_host_channel");
    const review = context.reviews?.find((r) =>
      reviewed(r, profile, req, now.getTime()),
    );
    return review
      ? decision(
          "permitted",
          "reviewed_deployment",
          [...review.sourceUrls],
          [review.id],
        )
      : decision("unverified", "commerce_review_required");
  });
  const blocked =
    results.find((r) => r.status === "restricted") ??
    results.find((r) => !r.allowed);
  if (blocked) return blocked;
  const caps = context.capabilities;
  if (
    (req.action === "external_checkout" ||
      req.action === "informational_link") &&
    caps?.externalLinks !== true
  )
    return decision("unverified", "external_links_unavailable");
  if (
    (req.action === "saved_method_purchase" ||
      req.action === "new_method_collection") &&
    caps?.interactiveUi !== true
  )
    return decision("unverified", "interactive_ui_unavailable");
  if (
    req.action === "new_method_collection" &&
    context.profiles.includes("chatgpt-plugin") &&
    caps?.nativePaymentSheet !== true
  )
    return decision("restricted", "chatgpt_native_payment_sheet_required", [
      COMMERCE_POLICY_SOURCES.chatgptCheckout,
    ]);
  return decision(
    "permitted",
    "host_commerce_eligible",
    [...new Set(results.flatMap((r) => r.sourceUrls))],
    [...new Set(results.flatMap((r) => r.reviewIds))],
  );
};

export { createCreditBalanceTool, type McpCreditBalance } from "./creditStatus";

export {
  createCheckoutHandoffTool,
  createPurchaseStatusTool,
  type McpPurchaseStatus,
} from "./checkoutTools";

export {
  createBillingReportTools,
  createBillingManagementTool,
} from "./billingTools";
