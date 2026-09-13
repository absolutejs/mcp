# Negotiated MCP Apps

Added in `@absolutejs/mcp@0.17.0`. The server and client support the stable MCP Apps extension (`io.modelcontextprotocol/ui`). Views bundle the official `@modelcontextprotocol/ext-apps@2.0.0` browser SDK; the package does not implement a custom postMessage bridge.

```ts
import {
  createBillingApps,
  createBillingReportTools,
  mcpServer,
} from "@absolutejs/mcp";
const views = createBillingApps();
mcpServer({
  // ...normal issuer, path, serverInfo and authorization configuration
  apps: { resources: views.resources, store: sharedSessionStore },
  tools: ({ caller }) =>
    views.decorateTools(
      createBillingReportTools({
        status: () => readStatus(caller.id),
        receipts: (page) => readReceipts(caller.id, page),
        usage: (range) => readUsage(caller.id, range),
      }),
    ),
});
```

The snippet illustrates wiring; the application supplies authentication, a shared store and account-bound readers. Billing readers still use normal scopes, Agency authorization, commerce policy, credit exceptions and rate limits. The view never receives account credentials.

## Protocol and fallback

A client must declare `capabilities.extensions["io.modelcontextprotocol/ui"].mimeTypes` containing `text/html;profile=mcp-app` during initialize. The server persists `canRenderUi` in its session store. Only negotiated clients receive `_meta.ui.resourceUri` and `visibility: ["model", "app"]` in tool discovery. Clients without that capability, missing sessions and old stores that omit the new field receive standard tools and text/structured results. Subsequent tool arguments or request metadata cannot upgrade the negotiated capability.

`withMcpApp(tool, "ui://…")` preserves the tool's handler and enforcement metadata. Configure its offline HTML resource in `apps.resources`. The resource must be a complete HTML5 document beginning with `<!doctype html>`. Resources are listed/read only when the linked tool is currently available under the authenticated caller's scope, Agency and commerce rules. These checks run again on each request, including after discovery.

Resource responses preserve the `text/html;profile=mcp-app` MIME type and `_meta.ui` CSP metadata. This release supports offline resources: no external connections, external assets, nested frames or privileged permissions are requested. Hosts must still enforce the sandbox and CSP. App-only tools, arbitrary network allowlists and payment forms are not implemented by this helper.

The package client can opt in with `createMcpClient({ apps: true, ... })` and preserves remote `_meta`. Only set this when the host implements the actual sandboxed renderer; the client option does not build one or authorize commerce.

## Shared sessions and migration

Apps introduces session state even when elicitation is off. Use a shared `McpSessionStore` for multiple instances. If elicitation also supplies a store, that store takes precedence over `apps.store` so both capabilities use one session identity. A custom store must preserve `canRenderUi`; omitting it fails closed to text-only presentation. Store capability flags, not authentication or payment permission, in these records.

For package PostgreSQL stores, apply `mcpPostgresMigrations()` before running the updated store. The existing `mcp@0.10.1` SQL and digest remain unchanged. The new `mcp@0.17.0` entry adds `can_render_ui boolean NOT NULL DEFAULT false`. `mcpPostgresSchemaSql()` combines both for fresh or idempotent manual setup. Existing sessions default to false and clients must initialize again to negotiate Apps. Custom application tables require their own matching additive migration.

## Billing views

`createBillingApps()` supplies status, usage and receipt templates plus a tool decorator. The status view shows credit buckets and portal/subscription status. Usage supports bounded date refreshes and expandable daily rows. Receipts support cursor pagination. Refresh invokes only the corresponding read tool through the official host bridge. Opening a view does not trigger another tool call. User-facing values are assigned with DOM text operations, not HTML interpolation. No purchase links, card fields, direct API fetches, analytics or automatic refill controls are included.

The package build regenerates and bundles the browser code into the published artifact, with no CDN dependency. `bun run typecheck`, `bun run test` and `bun run build` generate it before consuming it. Consumers do not need a separate frontend build.

## Verification and boundaries

Protocol tests cover negotiation, text fallback, spoofed later capabilities, authorization/commerce resource gates, shared session persistence, client metadata preservation and the immutable legacy migration digest. The browser fixture uses the official AppBridge, an `allow-scripts` iframe without same-origin access, and restrictive CSP. Run `bun test/fixtures/appsServer.ts` from this repository, then open `http://127.0.0.1:4417/?view=status` (or `usage`, `receipts`). Fixtures contain only fake data.

Passing this fixture does not certify a particular conversational, IDE or terminal host. Real-host capability/refresh/session-expiry checks remain required before activation. Rendering support never supplies checkout permission; apply [commerce-host-rules.md](commerce-host-rules.md) independently.

Primary references checked September 11, 2026: [stable Apps specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx), [official quickstart](https://apps.extensions.modelcontextprotocol.io/api/documents/quickstart.html), [App SDK](https://apps.extensions.modelcontextprotocol.io/api/classes/app.App.html), [AppBridge SDK](https://apps.extensions.modelcontextprotocol.io/api/classes/app-bridge.AppBridge.html).

## Real-host canaries

See [the reusable host canary and observed results](host-canaries.md) for isolated connection instructions, acceptance criteria and remaining rollout gates.

## Read-only setup and work previews

`createWorkflowTools` binds authenticated setup and preview readers; `createWorkflowApps`
decorates those tools and supplies offline resources. Merge its resources into the
server Apps configuration alongside billing resources. Both tools return text and
projected structured data when no Apps capability is negotiated. Setup reports
business context, portal access and available credits. Preview requires an allowed
operation and a positive proposed maximum, reports current eligibility, and never
reserves or executes. A maximum is not a price estimate or approval.

Readers must close over the authenticated account and resolve domain ownership.
Unknown operations and extra arguments (including account IDs) reject before reads.
The package strips extra reader fields. There is no executor callback. Consumers
keep these tools outside the zero-credit work gate with a bounded read rate limit.
Execution independently validates authorization, balance, stable work ID and budget.
Neither view contains checkout links, setup mutations or outbound actions.

The official Apps bridge delivers initial results without automatic tool calls.
Only explicit Refresh invokes the same read tool; preview refresh preserves the
operation and budget. Errors clear stale eligibility and point back to the assistant.
Known affected VS Code builds retain the shared text fallback. The visible-browser
fixture is `bun test/fixtures/workflowServer.ts` (loopback port 4418); it uses zero
credits and no gateway or database.

### Reviewed setup selection

`createSetupSelectionTools({ read, confirm })` exposes `get_setup_options` and
`confirm_setup_selection`; `createWorkflowApps()` supplies the selection view.
The adapter returns `{ revision, selectedId, options: [{ id, label }] }`, with
`null` selecting all businesses. It must bind the authenticated account itself.
`confirm({ expectedRevision, selectedId })` must atomically compare the reviewed
revision, validate ownership, change selection, and advance the revision. Every
other selection writer must advance it too, including A → B → A. The package
validates and projects values but cannot provide database atomicity for adapters.

The view makes no call on mount. Review and Cancel are local; Confirm sends the
exact reviewed revision and selection once. Errors discard review state and
require a fresh read. Text-only hosts receive the same options/revision and must
obtain explicit approval before invoking the write tool. This is a reversible
setup action with no billing or outbound effects; it does not authorize paid
work. At most 200 options are supported; IDs/revisions are bounded at 128
characters and labels at 512. No account selector or credentials enter the view.

### Durable action status and reviewed outbound approval

`createActionWorkflowTools({ review, job, confirm? })` provides
`get_action_review`, `get_action_job`, `resume_action_job`, and (only with a
confirmation adapter) `confirm_action_review`. `createWorkflowApps()` supplies
the shared action view. The review contains the full recipients, subject, body,
consequences, exact revision, and expiry. The view separates local review/cancel
from explicit **Approve and queue**, marks that tool as an external destructive
write, and never calls tools on mount. Host theme changes are applied explicitly.

Bind identity in the adapter. Under a database lock, compare the reviewed
revision and expiry, authorize the immutable payload, and commit the decision
and durable outbox together. All draft writers must refuse edits after claim.
Use a stable effect identity and retain ambiguous outcomes for reconciliation;
never make provider calls inside this confirmation tool. Returned job identity
must match the requested action. Error responses require a saved-status read,
not an automatic approval retry or a newly invented action ID.

`resume_action_job` resumes **tracking**, by reading the existing durable job.
It does not restart work, grant a new lease, retry, resend, or reconcile an
unknown outcome. The worker owns safe retries. Project only user-facing status
and summaries; do not expose raw provider errors, credentials or queue internals.
The text-only path carries the same review and status; host support does not
expand authorization or commerce eligibility. Review bodies are bounded at
100,000 characters, subjects at 2,000, and recipient lists at 100.

### Deferred prepaid action budgets

Action review accepts optional `maxCredits`; confirmation echoes that exact value.
A `requiresBudget` adapter exposes approval only for a review containing an explicit
positive safe-integer budget and marks confirmation as `paid_access` for
`usage_credits`. Existing server-bound host commerce policy still applies.
The consumer must bind the budget into its revision, atomically reserve with the
outbox, and transfer metering to its durable worker. Never interpret a review read
as spending permission. Missing or changed budgets must fail confirmation.

The shared App displays the hold, charge ceiling and uncertain-outcome behavior
before approval, then carries the budget unchanged to confirmation. Job results
may show projected `creditUsage` (work ID, maximum, charged amount and reserved or
settled state). Read/resume/refresh never reserve, settle or retry execution.
