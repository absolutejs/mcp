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
