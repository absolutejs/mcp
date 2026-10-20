# MCP service access review — October 20, 2026

This supersedes the automatic-expiry behavior in the September reviews. Reviewed
source dates are historical evidence; a due date is an operator reminder, not a
customer entitlement or service expiration. The shared evaluator now reports
`reviewDueIds` in its existing call audit metadata. Legacy `expiresAt` dates are
also reminders, so existing consumers receive the fix. `revoked: true` explicitly
withdraws a review; removing its grant or changing a restrictive host rule also
blocks it. Missing or malformed evidence and unknown channels remain blocked.
Authentication token, checkout quote, reservation and outbound approval expiries
are different contracts and retain their existing protection.

## Sources checked and scoped decision

- [ChatGPT plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines#commerce-and-monetization): existing paid-account entitlements remain usable; digital sales, upsells and transactional links are prohibited. Keep existing-credit work available, but do not expose credit checkout, subscription sales or saved-card purchases. Treating already purchased service credits as an existing entitlement is our scoped implementation interpretation, not vendor certification.
- [Claude interactive connectors](https://support.claude.com/en/articles/13454812-use-interactive-connectors-in-claude): connecting third-party services and performing permitted actions is supported; purchases in interactive connectors are not. Existing service-credit work remains separate from buying credits; purchase tools stay blocked and no new Claude checkout path is granted.
- [VS Code MCP](https://code.visualstudio.com/docs/agent-customization/mcp-servers): direct authenticated server connections are supported; organization restrictions still apply. [GitHub additional terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features) now point personal users to [Terms of Service section J](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#j-ai-features-training-and-your-data), and volume-license customers to [Generative AI Services Terms](https://github.com/customer-terms/github-generative-ai-services-terms). The older Copilot product-specific link is archived. We interpret independently operated service billing as distinct from reselling GitHub's service; private organization agreements and controls are not overridden.
- [Cursor marketplace terms](https://cursor.com/marketplace-publisher-terms), section 3.1: marketplace plugins cannot charge for access or usage. Retain the marketplace paid-access restriction; direct configuration is a separate channel, not a way to relabel marketplace distribution.
- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization): authenticated resource-owner authorization and scope/audience binding remain required by this service. A client name never grants commerce permission.

No checked source imposes our October 12/13 cutoff. Approved existing-credit
access therefore continues until explicitly withdrawn or a substantive rule
changes. Recheck official policies before relevant releases and when host rules
change; overdue review metadata is operational evidence, not a runtime shutdown.

## Scope of evidence

This is a source review plus shared policy/dispatch regression verification, not
an installed-host certification. It does not grant a marketplace listing, bypass
customer organization controls, perform a new purchase or certify untested hosts.
Direct, Claude and ChatGPT registrations remain classified from server-owned
OAuth callback records; mixed channels use the intersection of their rules.
