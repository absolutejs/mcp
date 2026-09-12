# VS Code individual Copilot: external service-credit checkout

Reviewed September 12, 2026; re-review by October 12, 2026. The operator confirmed
an **individual Copilot subscription**. Channel: native VS Code, manually configured
remote MCP, service-owned HTTPS checkout. This review covers user-requested
one-time purchases of non-transferable credits for the connected service.

## Decision and evidence

**Eligible for a deployment-specific external-checkout binding under the conditions
below.** This is our documented interpretation of the reviewed terms, not a
Microsoft/GitHub certification or an express vendor statement about credit sales.
The inspected terms do not specifically prohibit this scoped flow. Do not describe
that absence as permission for every commercial use or every Copilot account.

- [GitHub additional product terms, Copilot](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#github-copilot)
  directs individual users to the general terms, including AI-feature terms.
- [GitHub ToS, effective April 27, 2026](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#j-ai-features-training-and-your-data)
  covers AI inputs/outputs, user responsibility, and individual data-use controls.
  Section B.5 distinguishes third-party relationships; §H restricts API abuse.
- [GitHub acceptable-use policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies)
  forbid service resale without permission, unsolicited promotions/spam, privacy
  violations and deceptive conduct. Our scope is a requested purchase of the
  connected merchant's own service, with no GitHub-service resale or unsolicited
  promotion. Do not source sales-lead data from GitHub contrary to these rules.
- [VS Code license](https://code.visualstudio.com/license) and
  [MCP documentation](https://code.visualstudio.com/docs/agent-customization/mcp-servers)
  describe the editor and direct MCP/trust mechanisms. The license alone was
  sufficient only for the earlier developer test; it is not a commerce certificate.

Native VS Code 1.135.0 passed the synthetic handoff through its normal Windows
external-site confirmation and the default browser. Opening the page granted
nothing; explicit simulated approval produced one unchanged 1,000-credit result
across repeated reads. See the [host canary](../host-canaries.md). This tests
transport and user interaction; the real merchant/account flow needs its own
staging validation before activation.

## Required deployment scope

1. Bind an operator-reviewed OAuth registration to the authenticated account and
   this exact direct channel. Never grant eligibility from `clientInfo`, model
   name, arbitrary client metadata, or a user-supplied profile. Confirm the
   account's agreement; organization-managed accounts need a separate review.
2. Limit this review to `external_checkout` / `usage_credits`. The shared
   `direct-mcp` default remains unverified until the deployment supplies a fresh
   review. Unknown, ambiguous and published restricted profiles stay closed.
3. Create an expiring, account-bound link on the merchant's own HTTPS origin.
   Keep card entry and explicit payment confirmation in that browser page.
   Tool approval, native **Open**, page load and a chat claim never charge or
   prove payment. Verify payment and grant credits on the server exactly once.
4. Offer the link only in response to a purchase/top-up request. Keep normal
   host trust prompts. Do not automatically opt out of review or mark all
   domains trusted. Never collect payment credentials in MCP arguments or chat.
5. Expire the binding at review expiry; re-review changed terms, account type,
   distribution, categories or host behavior. Follow merchant privacy/terms and
   applicable provider requirements. Treat transcripts as potentially retained.

Excluded: Marketplace listings, GitHub-hosted storefronts, organization accounts,
ChatGPT/Claude hosted channels, embedded card forms, saved-card tool charges,
automatic refill, subscriptions and blanket approval for other MCP clients.
The VS Code rich-view startup workaround is a separate issue and still applies.
