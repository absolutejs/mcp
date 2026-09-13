# Account-independent service access

Reviewed September 13, 2026; re-review by October 13, 2026.
This supersedes the per-account canary condition for the general-access deployment,
not the published host restrictions or the requirement for explicit payment approval.

## Scope and decision

A customer account is not a distribution channel. Authenticated customers may use
an independently operated service against their existing service-credit entitlement,
without buying its portal subscription or being individually allowlisted. Each
operation still needs account authorization, an explicit maximum, durable metering
and recovery. Customer charges must never exceed the approved maximum.

Native, directly configured MCP connections may return a user-requested link to
the service's own HTTPS checkout. Card entry and confirmation happen on that page;
the MCP tool neither collects card data nor charges. Organizational policies may
block a user's connector; this service does not bypass those controls or certify
compliance with a customer's private contract. This is a scoped operator
interpretation, not vendor certification or a statement that every marketplace
allows commerce.

## Evidence and limits

- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
  binds access to OAuth scopes and resource owners. The authenticated registration's
  redirect destinations classify a native callback or hosted channel. They do not
  attest a vendor identity, host account plan or marketplace listing.
- [VS Code MCP documentation](https://code.visualstudio.com/docs/agent-customization/mcp-servers)
  documents direct connections and user/server trust. [GitHub additional terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features)
  distinguish individual and organizational agreements. [Individual terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)
  and [Copilot product terms](https://github.com/customer-terms/github-copilot-product-specific-terms)
  leave users responsible for their use. Our inference is that separately requested
  merchant service work is not resale of the host's own service. Keep independent
  service billing separate and obey the host's access/data controls.
- [Claude interactive connectors](https://support.claude.com/en/articles/13454812-use-interactive-connectors-in-claude)
  support third-party service accounts. Existing-credit access is separate from
  purchases. In-connector payment operations remain blocked; this release does not
  grant Claude credit-checkout links while that path remains unqualified.
- [OpenAI plugin guidelines](https://developers.openai.com/plugins/app-guidelines#commerce-and-monetization)
  allow existing paid entitlements while prohibiting digital-credit sales and
  transactional links. Existing work is not a new credit purchase. Keep pricing
  promotions, top-up links, saved-card charges, subscriptions and auto-refill hidden
  from that hosted profile; explain unavailable entitlements without an upsell.

## Shared implementation

`registeredMcpProfiles` and `registeredMcpCommerce` classify only callback URIs
loaded by the server for the authenticated OAuth client. Loopback/native callbacks
select the direct channel, recognized hosted origins select their restricted
profile, and unknown or mixed channels fail closed/intersect. Never classify from
`clientInfo`, a model name, a tool argument, or an unverified query parameter.
A native callback is not proof of Microsoft, Anthropic or OpenAI affiliation.
Marketplace deployments must select their marketplace profile explicitly rather
than reusing a native/direct review. Do not advertise an untested host as tested.

The package does not grant access by itself: the deployment supplies dated reviews,
capabilities, authentication, entitlement checks, rate limits and billing. Restrictive
published rules override these reviews. Account IDs are used to scope data and
charges, not to select an eligible customer cohort. Expired review evidence closes
paid tools while status/recovery remains available.
