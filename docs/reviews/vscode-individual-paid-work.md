# VS Code individual Copilot: bounded paid service work

Reviewed September 12, 2026; expires October 12, 2026. Channel: native VS Code,
manually configured remote MCP, individual Copilot subscription. Scope:
user-requested work delivered by the connected service, paid from that service's
existing credit balance. This review is separate from
[external checkout](vscode-individual-external-checkout.md).

## Decision

Eligible for a deployment-specific `paid_access` binding for `usage_credits` and
`digital_service` under the conditions below. This is our interpretation of the
reviewed terms, not vendor certification or express approval of every paid MCP.
The reviewed terms do not identify a specific prohibition on this bounded use
of an independently operated service. Re-review account type, distribution,
service behavior and changed terms before expanding the scope.

## Primary sources and interpretation

- [GitHub additional product terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#github-copilot)
  directs individual Copilot users to GitHub ToS section J; organizational
  agreements are outside this review.
- [GitHub ToS](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)
  distinguishes third-party relationships in B.5. Section H prohibits API abuse
  and certain data uses; J covers AI output responsibility and individual data
  controls. Our inference: the user's separate service agreement can govern
  metered service work, while the user's Copilot obligations continue to apply.
- [GitHub acceptable-use policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies)
  restrict resale of GitHub services, spam, privacy misuse and abusive activity.
  The reviewed service sells its own work. It must not sell Copilot access,
  share accounts, evade usage limits, or obtain GitHub data for prohibited sales
  or solicitation. Ordinary task drafts do not authorize sending outreach.
- [VS Code MCP documentation](https://code.visualstudio.com/docs/agent-customization/mcp-servers)
  documents remote-server configuration and host trust/tool interaction.
  Technical support for a tool is not commercial permission. Preserve the host's
  approvals; the service's ledger must independently enforce its budget.

## Required deployment controls

1. Bind the reviewed origin, verified OAuth registration and authenticated
   account on the server. Client names, `clientInfo`, prompts, tool arguments or
   claimed host capabilities cannot select the review. Unknown clients stay
   ineligible. Organization accounts require a separate review.
2. Make service-credit charging clear before work starts. Require a stable work
   ID and an explicit maximum service-credit budget. Service credits are not
   Copilot tokens or a promise of monetary return. Never infer an unlimited
   spending authorization from authentication, a tool result or a chat claim.
3. Reserve and settle atomically, cap the account's charge, and deduplicate
   retries. Replaying a completed work ID returns its stored result. Reject
   changed inputs under the same ID. Preserve uncertain work for reconciliation;
   do not release its hold and repeat its effects without verification.
4. Keep account ownership, cancellation/deletion, entitlement and balance checks
   on the server. Exhaustion blocks new paid work but preserves bounded status
   and recovery access. Background work needs its own durable budget propagation;
   exclude handlers that cannot uphold the cap across detached work.
5. This review grants only `paid_access`; checkout needs its own review. It does
   not permit card collection in chat, saved-card charges, subscriptions,
   automatic refill, bulk outreach or arbitrary third-party purchases. Retain
   any separate approval needed for outbound effects and sensitive actions.
6. Limit outputs to information the user is authorized to access. Treat host
   transcripts as retained data. Apply the service's privacy obligations and do
   not expose credentials, capability links or unrelated account records in
   diagnostics or reusable canary evidence.

A deployment must validate its ledger migration, actual host/account connection,
retry behavior, budget limits and recovery before activation. A review alone
neither activates tools nor certifies their accounting. This document does not
change the shared `direct-mcp` default or restrictions for Claude, ChatGPT,
marketplaces, organization-managed Copilot or other hosts.
