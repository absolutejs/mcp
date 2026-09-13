# Commerce through MCP: host rules and shared package design

Reviewed: **2026-09-10**. Owner: `@absolutejs/mcp`, with shared services in the AbsoluteJS ecosystem. Status: **host-eligibility foundation implemented; remaining commerce architecture is a design, not a certification**.

## Scope and evidence

This is the shared reference for selling physical goods, digital services and usage credits through MCP. It covers 23 named host/surface groups below, plus an unknown-host fallback. It is a dated survey of published first-party documentation, not a claim to enumerate every MCP client or every contractual clause. Recheck the exact host, distribution channel, product category and region before enabling sales. None of these integrations was exercised in a live host during this research.

Each finding distinguishes:

- **Documented:** the linked source establishes the capability or rule.
- **Restricted:** a published rule excludes the particular flow or requires conditions.
- **Unverified:** the inspected sources do not establish permission or capability. This does not mean forbidden, and it does not mean allowed.
- **Package default:** our proposed engineering choice, not a statement that the host requires it.

The executable policy must eventually have separate decisions for: access to an already-paid service, entitlement explanations, informational links, catalog/pricing display, direct checkout links, saved-card purchases, new-card collection, subscriptions and automatic refill. “Supports payments” is too ambiguous to be a useful boolean.

## Host rules and our treatment

For every row marked unverified commerce, the initial package behavior is to expose authorized existing-service functionality and factual entitlement status, with no sales CTA until that channel is reviewed. Even an informational external link requires a permitted destination. This is our conservative default, not a discovered universal ban. Interactive non-commerce results can still be enabled when supported.

| #   | Host / distribution surface                                   | Documented capability or constraint                                                                                                                                                                                                      | Commerce treatment for package consumers                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Claude web, Desktop, mobile and Cowork interactive connectors | Inline/fullscreen Apps; purchases through interactive connectors are unsupported. External links are supported; declared owned origins can avoid the external-link prompt. [C1][C2]                                                      | No embedded purchase/card-collection flow. Direct external credit checkout remains **unverified**, despite link support. Obtain clarification for that exact flow before enabling it.                                                                                    |
| 2   | Claude Code terminal / remote surfaces                        | Form and URL elicitation are documented. URL mode opens a browser. Certain approval annotations force human interaction on supported versions. [C3]                                                                                      | Use supported non-sensitive prompts; do not copy chat UI assumptions to the terminal. Commerce permission remains unverified. Do not bypass approval through hooks or permissive tool settings.                                                                          |
| 3   | ChatGPT hosted apps/plugins                                   | Digital products/services, subscriptions, tokens and credits cannot be sold; direct checkout and transaction-initiation links are excluded. Existing paid subscriptions can be used; informational entitlement links are permitted. [O1] | For digital credits: entitlement explanation and informational page only. No upgrade plans, buy button, saved-card charge, checkout link or hidden redirect. Confirm how existing prepaid entitlements fit the published subscription wording.                           |
| 4   | ChatGPT eligible physical-goods commerce                      | External checkout is generally available for eligible goods. Saved-method checkout is documented. Collecting new methods requires the ChatGPT payment sheet, available to selected partners. [O2]                                        | Enable only for eligible goods and the merchant's approved integration. No generic hosted-card iframe for collecting new methods. Physical-goods eligibility never authorizes digital-credit sales or mixed-cart circumvention.                                          |
| 5   | Direct Codex MCP: CLI, IDE and configured desktop connections | MCP tools, HTTP/STDIO and OAuth documented; local connections differ from hosted plugin tools. [O3]                                                                                                                                      | Embedded payment support and third-party commerce permission remain unverified. Key rules by actual surface and channel; do not assume all OpenAI surfaces share the same capability set or that direct MCP is exempt from applicable terms.                             |
| 6   | Cursor directly configured MCP / Agents                       | Tools, elicitation and MCP Apps are documented, with normal-result fallback. [U1]                                                                                                                                                        | Technical candidate for richer UI. URL elicitation specifically and credit commerce remain unverified; negotiate modes rather than interpreting generic elicitation as URL support.                                                                                      |
| 7   | Cursor Marketplace plugins                                    | Publisher terms §3.1 disallow direct or indirect fees for access to or use of a marketplace plugin. [U2]                                                                                                                                 | Treat paid plugin access as restricted. Clarify external paid-service/credit treatment before listing a metered connector. “The plugin is free” is not enough to dismiss the indirect-fee wording. Direct configuration is a separate channel, not automatic permission. |
| 8   | VS Code native GitHub Copilot chat                            | MCP Apps render interactive tool results. Server trust and organization controls apply. [V1][V2]                                                                                                                                         | Enable tested result/approval Apps; purchases and checkout links remain unverified. Respect host confirmation and enterprise allowlists.                                                                                                                                 |
| 9   | GitHub Copilot CLI                                            | MCP configuration and tool permissions are documented. [G1]                                                                                                                                                                              | Terminal fallback; no assumed iframe UI or checkout permission. Do not infer a permission to charge from an allow-tools setting.                                                                                                                                         |
| 10  | GitHub Copilot hosted/cloud agents                            | GitHub documents MCP support and organization policy controls; support varies by client. [G2]                                                                                                                                            | Separate profile from VS Code and CLI. Use durable handoff-required results if no person is present; no unattended purchase absent an independently valid mandate and host permission.                                                                                   |
| 11  | Gemini Spark custom connected apps                            | Custom MCP URLs, account linking and manual confirmation for writes are documented. Availability is limited by age, geography, account type and Spark access. [J1]                                                                       | Check eligibility; preserve write confirmations. Apps rendering and credit commerce remain unverified. Do not apply Gemini CLI findings to consumer Gemini.                                                                                                              |
| 12  | Gemini CLI                                                    | Local/remote MCP tools, resources and transport/auth configuration documented. [J2]                                                                                                                                                      | Standard tool/result fallback; no verified embedded checkout or credit-commerce allowance. Verify each elicitation capability from the client.                                                                                                                           |
| 13  | Google Antigravity                                            | MCP connections to developer tools and external services documented. [J3]                                                                                                                                                                | Treat as its own client, not Gemini CLI. Interactive checkout and digital sales remain unverified.                                                                                                                                                                       |
| 14  | Windsurf / Cascade                                            | Former Windsurf documentation redirects to Devin's Cascade documentation and describes MCP integration. [W1]                                                                                                                             | Preserve a distinct Cascade profile and source redirect history. Do not infer identical behavior to Devin cloud. Commerce and Apps checkout remain unverified.                                                                                                           |
| 15  | Devin hosted agent                                            | MCP server/marketplace integration documented. [D1]                                                                                                                                                                                      | Separate interactive and unattended execution. Keep funding recovery resumable; no assumption a hosted job can display an embedded checkout or ask a present user. Commerce unverified.                                                                                  |
| 16  | Perplexity local and remote connectors                        | Local and remote MCP integration documented. [P1]                                                                                                                                                                                        | Verify the user's surface/account configuration. Do not infer third-party credit sales from Perplexity's separate shopping products. Apps checkout and credit commerce unverified.                                                                                       |
| 17  | JetBrains AI Assistant                                        | STDIO, Streamable HTTP and legacy SSE documented; administrators can constrain configured servers. [B1]                                                                                                                                  | Native assistant and externally hosted agents need separate profiles. Tools support does not establish Apps/payment support; commerce unverified.                                                                                                                        |
| 18  | Kiro                                                          | MCP tools, prompts and resource templates documented; enterprise MCP allowlists exist. [K1][K2]                                                                                                                                          | Distinguish CLI and graphical surfaces during testing. Respect governance; Apps checkout and commerce unverified.                                                                                                                                                        |
| 19  | Zed native agent / external agents                            | Native MCP tools and prompts documented. External agent behavior is a separate integration. [Z1]                                                                                                                                         | Native baseline is ordinary tools/results. Do not assume an external agent inherits native UI or vice versa. Commerce unverified.                                                                                                                                        |
| 20  | Cline, Roo Code and Continue                                  | Each documents MCP integration. Continue's documented MCP use requires agent mode. [L1][L2][L3]                                                                                                                                          | Maintain separate client records despite this grouped baseline. No inherited VS Code Apps capability just because an extension runs there. Commerce unverified for each.                                                                                                 |
| 21  | goose Desktop / CLI                                           | Desktop supports interactive MCP Apps. Documentation distinguishes live interactive Apps and standalone App behavior. [H1]                                                                                                               | Desktop is a candidate for a controlled pilot, not a payment certification. CLI needs its own fallback. Operator/model-provider requirements still apply.                                                                                                                |
| 22  | Self-hosted Open WebUI / LibreChat                            | Both document MCP integration; Open WebUI documents OAuth-backed connections. [H2][H3]                                                                                                                                                   | Operator review can establish deployment-specific rules. Do not equate self-hosting with unrestricted commerce or assume all deployments render Apps. Keep separate product/version records.                                                                             |
| 23  | Microsoft Copilot Studio / deployed agents                    | MCP connections use Power Platform connectors and configured authentication. [M1]                                                                                                                                                        | Treat each published channel as its own rendering/runtime surface. Respect tenant governance; native payment UI and credit-commerce permission remain unverified.                                                                                                        |

Missing/new hosts, forks, embedded agents and SDK-built products use an explicit `unknown` profile. A protocol client catalogue can identify additional coverage candidates, but is not commerce-policy evidence. The named groups above are the researched launch inventory, not a permanently complete list.

## Cross-host rules that matter

### Protocol and UI boundaries

MCP form elicitation must not request passwords, API keys, bearer tokens or payment credentials. Sensitive elicitation uses URL mode; only send modes the client advertises. An empty elicitation capability means form support, not URL support. Connector authorization remains the separate OAuth flow. Bind state to authenticated identity, not session ID alone. [S1][S2]

There is a documentation conflict worth preserving: Claude Code's form example mentions a password, while the normative MCP elicitation specification prohibits password collection in forms. Our shared implementation follows the stricter protocol requirement; no password/card form examples. [C3][S1]

MCP Apps uses UI resources, metadata and host messaging. Preserve `_meta.ui.resourceUri`, UI resource metadata and the correct MIME type through listing, resource reads and results. Negotiate capabilities; provide text alternatives. UI-only tool visibility is useful but is not server authorization. Host CSP/frame restrictions and provider requirements must both permit any embedded content. [S3]

Package recommendation: use reviewed components and typed data for account setup, previews, approvals and balances. Do not execute model-generated code as a trusted checkout. Treat all tool results and transcripts as potentially retained or shared; UI metadata is not a secret vault.

### Distribution and product categories

A marketplace policy, direct connection, enterprise deployment and self-hosted installation can have different rules. A consumer choosing an underlying Claude model in another host is not necessarily using Claude's interactive connector product; nevertheless applicable provider terms still matter. Check the real service and distribution arrangement.

Product classification is server-owned: `physical_goods`, `digital_service`, `usage_credits`, `subscription`, or a specifically reviewed category. Classify every mixed-cart line; a restricted line cannot be hidden inside an eligible physical product. User consent, merchant consent, provider support and host commerce permission are separate requirements. None substitutes for the others.

The survey does not authorize regulated goods, money transmission, investment transactions or cryptocurrency commerce. They require a separate category review; a prepaid service-credit balance is not a general-purpose transferable wallet.

### Honest recovery behavior

No credit balance or subscription should be required merely to inspect the user's existing balance, receipts, owned results or support case, subject to account authorization and bounded resource use. A purchase-capable host can show a top-up path. A restricted host shows only the permitted entitlement explanation or informational destination. Never disguise a checkout as support, documentation, account recovery, a QR code, an attachment or a generic link.

Reauthorization resolves authentication, not insufficient credits. An OAuth scope is not approval to charge. “Open external link” approval is not payment confirmation. An elicitation acceptance, a closed window or a user report is not proof of payment.

## Package architecture: implement once, configure per consumer

The following are proposed additions and composition boundaries, **not existing exports**. Existing package responsibilities were inspected in their READMEs/source before assigning work.

| Package                         | Shared responsibility                                                                                                                                                          | Consumer configuration only                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `@absolutejs/mcp`               | Optional commerce integration; host/surface capability adapter; shared tool definitions and Apps; safe result projection; policy-aware recovery; versioned host rule catalogue | Brand, domain, selected products, adapter/store instances, deployment profile                                |
| `@absolutejs/policy`            | Reuse immutable rule versions, digests, activation, simulation and recorded decisions for host-commerce policy evaluation                                                      | Reviewed profile and deployment restrictions; no ad hoc host-name branches                                   |
| `@absolutejs/agency`            | Existing exact-input action approval, execution leases and receipts                                                                                                            | Actor resolution, business permissions and spending mandates                                                 |
| `@absolutejs/auth`              | OAuth identity and consent; reusable narrow checkout-session exchange primitive if missing                                                                                     | Identity store and owned routes/origins; subscription policy stays outside auth                              |
| `@absolutejs/commerce`          | Purchase/quote lifecycle, canonical totals and provider-neutral checkout evidence; extend existing contracts for service-credit purchases where needed                         | Product catalogue, tax/refund configuration and entitlement fulfillment                                      |
| `@absolutejs/commerce-adapters` | Provider-specific hosted checkout, tokenization, verification, refunds and reconciliation                                                                                      | Merchant credentials stored server-side; use actual independently published provider packages                |
| `@absolutejs/billing`           | Usage-credit accounting, persistent purchased grants versus periodic allowances, reservations and settlement contracts                                                         | Rates, allowance policy, credit denomination and DB store                                                    |
| `@absolutejs/wallet`            | Reuse existing agent spend mandates, caps and journal/reservation patterns where monetary wallets are appropriate                                                              | Explicit wallet policy; do not adopt its marketplace dollar limits/fees or conflate cents with usage credits |
| `@absolutejs/handoff`           | Existing external-operation correlation, evidence and reconciliation; extend shared workflow resume coordination                                                               | Durable store and provider callbacks; this package is not currently an authentication-token issuer           |
| `@absolutejs/ai`                | Typed presentation models and result summaries reusable across the portal and MCP                                                                                              | Business labels and supported view types; no provider-specific payment secrets                               |

Keep the core MCP protocol usable without billing dependencies. Prefer an optional, versioned commerce subpath/integration in the MCP package; final exported names require API review. Consume existing packages rather than copying their ledgers or policy engines. A new provider adapter belongs in the adapter repository, not a project's MCP handler.

Shared components should include: setup progress, work preview with budget, exact-action approval, job status, results, credit balance, usage and receipts, and a host-permitted billing entry. Consumers supply validated domain view models and fulfillment adapters. A product may retain its own portal layout; it must not implement its own checkout security or host restrictions.

### Rule catalogue and evaluator

Each rule record should contain:

- Stable rule ID, revision, reviewed date, next-review date and owning maintainer.
- Host, surface, distribution channel, applicable version range, region/account scope and product category.
- Source URL, section, effective date if available, concise finding, evidence status and review rationale.
- Separate decisions for paid access, pricing display, informational links, external checkout, saved-method execution, new-method collection, subscription changes and automatic refill.
- Required capabilities, origin declarations, merchant enrollment, user interaction and approval evidence.
- Resolution path for unknowns; superseded-rule relationship and test fixtures.

Proposed decision vocabulary: `permitted`, `restricted`, `unverified`, `not_applicable`. Return the selected presentation, blocked actions, reason IDs, policy digest and evidence references. A human-readable explanation must remain available for consumers and reviewers. Do not bake conclusions into model prompts only.

Evaluation order:

1. Authenticate account/tenant and resolve a deployment's trusted profile. Treat `clientInfo` and arbitrary headers as hints, not authenticated identity.
2. Resolve actual product category, distribution constraints and current versioned policy.
3. Apply merchant/provider/region and account permissions, then intersect with negotiated capabilities.
4. Select the best permitted experience: native payment UI → approved merchant embedding → approved external handoff → permitted informational recovery → explanation only.
5. Recheck at action execution, including approvals, quote expiry and current account state. Tool discovery or a previously rendered card cannot grant authority.

A server cannot reliably distinguish every marketplace install from every manual connection. Use trusted deployment configuration and verified client-registration relationships where available. If channel identity is ambiguous, apply the intersection of possible restrictions. Never allow a spoofed host name to select a more permissive checkout.

The same decision controls tools/list, direct tools/call, prompts, resources, App buttons and text links. Disabled sales paths must not leak through a fallback. Informational pages cannot automatically redirect to checkout. Applying stricter policy should disable new sales while preserving receipts, already-paid fulfillment and reconciliation.

Do not silently refresh executable policy from scraped web pages. Review and release rule updates with change history; support rapid restrictive overrides. Proposed operational cadence: review monthly and before releases, with earlier review on host policy/version changes. Stale permissive evidence must not indefinitely authorize new transactions.

## Reusable checkout handoff without routine sign-in

Where the host permits an external purchase link, the target is a dedicated merchant page, already associated with the authenticated account. The normal flow is one click to the page, explicit amount/payment confirmation, server-verified grant, then resume in the assistant. Bank challenges or expired/risky sessions may still require verification.

Proposed shared handoff contract:

1. Authorize creation against the MCP identity and current host policy. Mint an opaque, high-entropy, short-lived code; store its hash, tenant/account, intent, permitted scope, expiry and single-use state.
2. The link grants only limited checkout setup, not a normal account session, receipt history or automatic saved-card access. Loading/previewing a URL never purchases anything. Avoid consuming the code on a preview GET.
3. Exchange through the dedicated HTTPS page for a Secure, HttpOnly, narrowly scoped session. Remove the code from the visible URL; suppress referrer/cache/analytics leakage and redact server logs. Bind the exchange to the browser context. Do not silently switch an existing browser account.
4. Validate origin and CSRF protection for mutations. Use server-priced amount/currency, an expiry and operation key. Reveal only the identity detail needed to recognize the purchase destination. A new-card entry stays inside the payment provider's trusted fields on the merchant site.
5. A copied link can confer its limited bearer capability. It must not alone reveal saved methods or authorize charges. Reuse a matching authenticated browser session or require appropriate verification for sensitive saved-method/account management actions.
6. Verify completion from provider evidence and deduplicate both charge and grant. Persist uncertain outcomes for reconciliation; do not retry a possibly successful charge blindly.
7. Resume by durable workflow ID. Refresh the balance/status in the App or next tool call. Expired or changed work requires a new quote/approval; payment completion is not automatic approval of the original outbound action.

This is a new shared security primitive to implement, not a promise that an existing project checkout-intent signature provides sign-in or replay protection. Keep link-generation, session exchange, confirmation and reconciliation tests in packages.

## Shared financial and action invariants

- Separate credit funding from credit consumption and monetary accounting from usage units. An MCP request, a model token and a service credit are different units.
- Reserve enough credits atomically before paid work; bound maximum spend, settle actual use and release unused reservations. No read-then-spend race. Do not double charge workflow totals and component events.
- Period rollover replenishes only periodic allowances; it must not replenish spent purchased grants. Cancellation must not destroy unused purchased credits unless an explicit applicable policy requires it.
- Verify tenant ownership and current permission on each tool/resource/action. Approval binds to exact product/recipient, amount, currency, contents, version and expiry. Use single-use execution leases.
- Distinguish a user-approved action from a preauthorized recurring mandate. Auto refill is off by default and separately gated by host rules, explicit consent, cap and revocation. Tool auto-approval is not recurring billing consent.
- Unknown payment status is a durable state, not failure or success. Recover after crashes between charge, ledger write and fulfillment. Refunds/chargebacks produce auditable adjustments.
- Use domain-specific fulfillment: purchased service credits grant the correct account once; physical orders use their own inventory/fulfillment rules. Credit purchase must not fabricate a subscription.
- Trace usage to work/results where possible. Revenue attribution, pipeline, collected revenue and profit remain distinct; the host assistant's own charges are not automatically observable.

## Implementation sequence and reusable verification

### Confirmed launch scope: broad support, including coding agents

Broad compatibility is a first-release requirement. Validate conversational hosts, IDE agents, terminal agents and a self-hosted deployment from the start. Initial test targets are Claude, direct Codex, Cursor, VS Code Copilot, Claude Code, Gemini CLI, goose Desktop and a self-hosted client; include ChatGPT's restricted commerce presentation. These are validation targets, not verified compatibility claims.

Require passing representative conversational, IDE and terminal clients before launch. Publish exact tested surfaces and versions. All supported clients share account, entitlement, work, result and recovery contracts; interactive rendering and transaction paths depend on each host's capabilities and permitted commerce. A restricted purchase path must not prevent authorized use of existing service entitlements where allowed.

Run one reusable package conformance suite across these clients, with at least two independently configured consumer applications. Additional hosts enter the advertised matrix only after their own checks pass. Do not defer the terminal workflow until after a Claude-only release.

1. **Policy contracts and host fixtures:** formalize the catalogue and pure decision result; map to existing policy/agency contracts. Ship source references and examples together. No payment behavior changes yet.
2. **MCP Apps foundation:** metadata end-to-end, capability negotiation, authenticated resources, user interactions, scoped data and text fallback. Test optional features against old clients.
3. **Commerce handoff and prepaid substrate:** shared narrow sessions, canonical quotes, provider adapter, persistent grants, atomic reservations, idempotency and reconciliation. Extract reusable logic from existing consumers rather than copy it.
4. **Shared tools and components:** compose onboarding, balance, receipts, billing recovery and approval flows from package services. Keep host-specific presentation inside the package.
5. **Conformance and releases:** release changed packages in dependency order, then pin versions in consumers. Publish documentation with the package; deployment-specific approval evidence remains private. Verify at least two independently configured consumers to demonstrate there is no onSpark-specific coupling.

Acceptance fixtures must cover:

| Area              | Required cases                                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host rules        | ChatGPT digital denial, eligible physical goods, mixed cart rejection, Claude purchase-disabled presentation, Cursor marketplace indirect-fee restriction, unknown host/channel and stale rule versions |
| Capabilities      | Apps absent/disabled, form-only elicitation, URL elicitation, denied external link, CSP/frame failures, terminal/headless mode, mobile return, reconnect and server restart                             |
| Bypass resistance | Spoofed client name, hidden direct tool invocation, resources/prompts/text fallback containing forbidden CTA, redirect to transaction from informational page, prompt injection requesting charge       |
| Identity/handoff  | Wrong tenant, revoked auth, mismatched browser account, preview crawler, expired/reused/stolen scoped code, CSRF, arbitrary return URL, secret leakage                                                  |
| Money             | Duplicate request/callback, ambiguous provider result, crashes around capture/grant, concurrent last-credit jobs, settlement/release, allowance rollover, refund/chargeback, mandate revocation         |
| Human actions     | Stale quote, changed recipients/draft/cart, already-executed action, tool auto-approval, repeated click, cancelled checkout, payment succeeds but user declines work                                    |

Live verification records must specify host version/surface, connection channel, product category, account eligibility, negotiated capabilities, policy revision and observed result. Sanitized screenshots/traces supplement automated conformance; neither successful rendering nor a test charge proves platform permission. Use provider sandbox/test identities and no real charges for compatibility checks.

## Open questions and decisions

- Claude: does the interactive connector purchase restriction permit a user-initiated link to a dedicated digital-credit checkout? External-link capability alone leaves this unresolved.
- Cursor Marketplace: how does §3.1 apply to free connectors backed by metered third-party services? Do not assume an exception.
- ChatGPT: can existing prepaid service credits be consumed under the existing-paid-account allowance? Digital top-up sales and transaction links remain explicitly restricted regardless.
- Codex, other proprietary agents and self-hosted deployments: identify applicable commerce/distribution terms and confirm the exact UI before enabling transactions. Open-source code and absence of a documented restriction are not permission from every model/provider.
- Provider support: validate iframe policy, origin registration, 3DS/wallet behavior and merchant eligibility for each enabled flow. No provider migration is justified solely by host UI support.

These questions do not block implementing reusable read-only Apps, policy evaluation, scoped handoff primitives or financial invariants. They block enabling the unresolved sales paths, not the whole product.

## Source register

All sources below were opened during research on 2026-09-10. Summaries above are deliberately narrow; unverified entries mean the inspected sources do not settle the question. Dynamic documentation and contractual terms require revalidation. Source pages that redirect are cited at the resolved official location where available.

- **S1:** [MCP elicitation specification](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation).
- **S2:** [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).
- **S3:** [MCP Apps specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx).
- **C1:** [Claude interactive connectors](https://support.claude.com/en/articles/13454812-use-interactive-connectors-in-claude).
- **C2:** [Claude directory submission and allowed external links](https://claude.com/docs/connectors/building/submission); [software directory policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy).
- **C3:** [Claude Code MCP, elicitation and approvals](https://code.claude.com/docs/en/mcp).
- **O1:** [OpenAI plugin guidelines: commerce and monetization](https://developers.openai.com/plugins/app-guidelines#commerce-and-monetization).
- **O2:** [OpenAI checkout API and eligibility](https://developers.openai.com/plugins/build/monetization).
- **O3:** [Codex and ChatGPT MCP surfaces](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
- **U1:** [Cursor MCP capabilities](https://cursor.com/docs/mcp).
- **U2:** [Cursor Marketplace Publisher Terms, §3.1](https://cursor.com/marketplace-publisher-terms).
- **V1:** [VS Code MCP Apps](https://code.visualstudio.com/blogs/2026/01/26/mcp-apps-support).
- **V2:** [VS Code MCP configuration and trust](https://code.visualstudio.com/docs/agent-customization/mcp-servers).
- **G1:** [GitHub Copilot CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference).
- **G2:** [GitHub Copilot MCP overview and governance](https://docs.github.com/en/copilot/concepts/context/mcp).
- **J1:** [Gemini Spark custom apps and eligibility](https://support.google.com/gemini/answer/17209137).
- **J2:** [Gemini CLI MCP](https://geminicli.com/docs/tools/mcp-server/).
- **J3:** [Google Antigravity MCP](https://antigravity.google/docs/mcp).
- **W1:** [Cascade MCP](https://docs.devin.ai/desktop/cascade/mcp), reached through the former Windsurf documentation URL.
- **D1:** [Devin MCP servers and marketplace](https://docs.devin.ai/work-with-devin/mcp).
- **M1:** [Copilot Studio MCP integration](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent).
- **P1:** [Perplexity local/remote MCP](https://www.perplexity.ai/help-center/en/articles/11502712-local-and-remote-mcps-for-perplexity).
- **B1:** [JetBrains AI Assistant MCP](https://www.jetbrains.com/help/ai-assistant/mcp.html).
- **K1:** [Kiro MCP usage](https://kiro.dev/docs/mcp/usage/).
- **K2:** [Kiro enterprise MCP governance](https://kiro.dev/docs/enterprise/governance/mcp/).
- **Z1:** [Zed MCP](https://zed.dev/docs/ai/mcp).
- **L1:** [Cline MCP](https://docs.cline.bot/mcp/mcp-overview).
- **L2:** [Roo Code MCP](https://roocodeinc.github.io/Roo-Code/features/mcp/using-mcp-in-roo/).
- **L3:** [Continue MCP configuration](https://docs.continue.dev/customize/mcp-tools); [Continue agent-mode requirement](https://docs.continue.dev/reference/continue-mcp).
- **H1:** [goose MCP Apps](https://goose-docs.ai/docs/guides/interactive-chat/mcp-ui/), linked from the project's migrated documentation.
- **H2:** [Open WebUI MCP](https://docs.openwebui.com/features/extensibility/mcp/).
- **H3:** [LibreChat MCP](https://www.librechat.ai/docs/features/mcp).

[S1]: https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation
[S2]: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
[S3]: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
[C1]: https://support.claude.com/en/articles/13454812-use-interactive-connectors-in-claude
[C2]: https://claude.com/docs/connectors/building/submission
[C3]: https://code.claude.com/docs/en/mcp
[O1]: https://developers.openai.com/plugins/app-guidelines#commerce-and-monetization
[O2]: https://developers.openai.com/plugins/build/monetization
[O3]: https://learn.chatgpt.com/docs/extend/mcp?surface=cli
[U1]: https://cursor.com/docs/mcp
[U2]: https://cursor.com/marketplace-publisher-terms
[V1]: https://code.visualstudio.com/blogs/2026/01/26/mcp-apps-support
[V2]: https://code.visualstudio.com/docs/agent-customization/mcp-servers
[G1]: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference
[G2]: https://docs.github.com/en/copilot/concepts/context/mcp
[J1]: https://support.google.com/gemini/answer/17209137
[J2]: https://geminicli.com/docs/tools/mcp-server/
[J3]: https://antigravity.google/docs/mcp
[W1]: https://docs.devin.ai/desktop/cascade/mcp
[D1]: https://docs.devin.ai/work-with-devin/mcp
[P1]: https://www.perplexity.ai/help-center/en/articles/11502712-local-and-remote-mcps-for-perplexity
[B1]: https://www.jetbrains.com/help/ai-assistant/mcp.html
[K1]: https://kiro.dev/docs/mcp/usage/
[K2]: https://kiro.dev/docs/enterprise/governance/mcp/
[Z1]: https://zed.dev/docs/ai/mcp
[L1]: https://docs.cline.bot/mcp/mcp-overview
[L2]: https://roocodeinc.github.io/Roo-Code/features/mcp/using-mcp-in-roo/
[L3]: https://docs.continue.dev/reference/continue-mcp
[H1]: https://goose-docs.ai/docs/guides/interactive-chat/mcp-ui/
[H2]: https://docs.openwebui.com/features/extensibility/mcp/
[H3]: https://www.librechat.ai/docs/features/mcp
[M1]: https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent

## Implementation progress

The first slice exports `evaluateCommerce` through `@absolutejs/mcp/commerce`, adds server-owned `McpTool.commerce` classification and a `McpServerConfig.commerce` resolver, filters tagged tools in discovery, and rechecks eligibility before handler execution. Decisions carry policy version, reason and review evidence into the call audit metadata. No client-name autodetection or live checkout is enabled.

The bundled rules cover the explicit restrictions established above; the broad host inventory currently maps to reviewed direct/self-hosted or unknown profiles rather than claiming every host has been verified. Missing policy, malformed categories, ambiguous restrictions, expired reviews and unavailable capabilities block the action. Deployment reviews cannot override bundled restrictions.

This slice is not a general content filter: prompts, resources, untagged tools and arbitrary returned links require the shared evaluator at their own presentation boundaries. Shared renderers, native capability plumbing, checkout sessions, prepaid accounting changes and live cross-host conformance remain to implement. Existing Agency enforcement remains independent.

## September 12 follow-up: native VS Code developer checkout test

The directly configured VS Code/Copilot channel now has a package-owned
[synthetic checkout canary](host-canaries.md#synthetic-external-checkout-canary).
This is an application development test within VS Code license §1, with no real
merchant, card input, funds or credits. It does not change the `direct-mcp`
production default, approve Marketplace distribution, or establish permission
for live sales under every Copilot agreement. Check the actual account's terms:
individual Copilot uses GitHub ToS §J; volume licensing has separate current
Generative AI Services Terms. The old Copilot product-specific terms are archived.
The linked canary record preserves the exact native host result independently
of commercial eligibility. Existing Claude and ChatGPT restrictions still apply.

## September 12 individual Copilot external-checkout review

The operator confirmed an individual subscription. The [scoped review](reviews/vscode-individual-external-checkout.md)
concludes that user-requested, service-owned HTTPS credit checkout is eligible
for an explicit deployment binding, with a dated interpretation and exact
conditions. This does not change the global direct-MCP default. The complete
native handoff now passes after accounting for Windows' external-site dialog;
no link defect or need for an upstream link fix was established. Rich-view
startup remains a separate tracked issue.

## September 12 individual Copilot paid-work review

The [bounded paid-work review](reviews/vscode-individual-paid-work.md) separately
covers user-requested service work funded by existing service credits for the
reviewed individual Copilot direct-MCP channel. Deployments must bind the exact
registration/account and enforce budgets, retries and recovery. It expires
October 12, 2026. It does not enable the shared default or expand checkout,
organization-account or other-host eligibility.

## Launch evidence checklist — September 12, 2026

This checklist separates reusable package guarantees from deployment activation.
The September 10 survey remains the full host inventory; this follow-up rechecked
the highest-priority restrictions and existing Copilot review boundary. It does
not certify the untested hosts or broaden any executable commerce profile.

### Current source checks

- Claude still documents purchases through interactive connectors as unsupported.
  Its help page does not settle the separate external credit-checkout question.
  Keep that flow unverified pending clarification; non-commerce report rendering
  is a separate capability. [Claude help](https://support.claude.com/en/articles/13454812-use-interactive-connectors-in-claude).
- ChatGPT plugin guidelines still exclude digital-credit sales and transactional
  links. Entitlement explanations and informational destinations are distinct
  from purchase initiation. Do not turn an informational destination into an
  automatic checkout redirect. [Plugin guidelines](https://developers.openai.com/plugins/app-guidelines#commerce-and-monetization).
- Direct Codex documents remote MCP and OAuth. That technical documentation alone
  does not establish commerce eligibility for a particular account/distribution.
  Keep its separate review pending; neither automatically apply hosted-plugin
  rules to every direct connection nor infer an exemption.
  [Direct MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
- Cursor Marketplace still excludes direct and indirect plugin-access fees in
  section 3.1. Review directly configured MCP separately; a working connection
  does not resolve the marketplace restriction.
  [Publisher terms](https://cursor.com/marketplace-publisher-terms).
- GitHub still directs individual Copilot users to ToS section J and Business /
  Enterprise users to different terms. The two scoped individual Copilot reviews
  remain the package's interpretation, expiring October 12, 2026; this check
  does not extend their expiry or authorize organization accounts.
  [Applicable agreements](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#github-copilot).
- VS Code issue #335908 remains open. Retain the tested affected-version fallback
  until a released editor passes the documented fresh-load and remount tests.
  [Upstream issue](https://github.com/microsoft/vscode/issues/335908).

### Evidence required for each advertised host

| Gate | Required evidence | Owner |
| --- | --- | --- |
| Distribution and policy | Exact host surface, account agreement, category, actions, official sources, dated interpretation and expiry | Package review; deployment supplies verified binding |
| Authentication | Real signup/consent return, exact registration/account, refresh, revoked access and cross-account rejection | Auth package primitives and consumer integration |
| Presentation | Installed version, actual negotiated capabilities, visible first load, refresh, pagination and text fallback | MCP package fixture; real host test |
| Funded access | Subscription-free access, portal denial, explicit budget, settlement, retry conflict and recovery at zero | Billing package and consumer services |
| Checkout, if eligible | Own HTTPS origin, explicit browser confirmation, server-priced intent, idempotent grant and uncertain-outcome recovery | Shared handoff plus consumer gateway |
| Work effects | Immutable approval version, ownership, expiry, repeat-safe execution and durable status; rendering performs no action | Shared workflow contract and consumer handler |
| Operations | Manual or automated validation, deployment readiness, reconciliation, support procedure and rollback preserving financial records | Consumer deployment |

Mark each gate **passed**, **qualified**, **pending** or **not offered**, with a
link to evidence. A successful report fixture is not OAuth certification; a
successful payment is not proof of paid model metering. Never count a member or
complimentary account as a production subscription-free canary. No additional
live charge is required merely to review or document a host.

The package commerce regression suite was rerun: 18 tests / 43 assertions passed,
including discovery/execution guards, policy rechecks, restrictive profile
intersection, expiry, spoofed metadata and failure handling. This is regression
evidence for the policy mechanism, not vendor approval or a live host test.

### Recommended implementation order for consumers

Build non-commerce setup and work previews using shared Apps primitives and
identical structured/text contracts first. Then add version-bound approval and
durable results, followed by attributed spend/outcome reporting. Bind each
consumer's domain services rather than duplicating policy, ledger or bridge
code. Test an eligible conversational, IDE and terminal channel separately;
record unavailable hosts as pending. Keep deferred background effects outside
bounded work until their reservation and recovery lifecycle is implemented.

This documentation update changes no runtime API, profile, feature flag or
published package version. It is available in the shared repository and will
ship with the next package release through the existing documentation allowlist.

### Background research estimates

`createBackgroundWorkTools({ estimate, start, read, ... })` optionally exposes
`estimate_background_work`. Its adapter returns minimum credits for one step,
estimated total credits, total steps and explicit assumptions. Public output is
identical in text and structured hosts, and omits adapter-private fields. No
provider work or reservation belongs in the estimate adapter.

Estimates use `paid_access` commerce policy, so a restricted host cannot use this
as a pricing/purchase workaround. Obtain user agreement to the exact plan and
maximum before start. Server-side start must reevaluate admission atomically;
never silently raise a maximum. Saved-work reads remain separate and credit-free.
An estimate is advisory, not an expiring quote or guaranteed cost. Bind input,
account and maximum durably; exact-ID recovery must not depend on current pricing.
