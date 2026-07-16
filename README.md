# @absolutejs/mcp

MCP tool discovery preserves the OpenID AuthZEN COAZ `coaz` marker and
`x-coaz-mapping` JSON Schema extension end to end. Use `@absolutejs/policy` to
validate and evaluate the mapping before dispatching an authorized tool call.

Serve a remote [Model Context Protocol](https://modelcontextprotocol.io) endpoint
— streamable HTTP, stateless — from a tool/prompt/resource registry. You supply
**which** tools to expose and **how** to authorize a request into a caller; the
package owns the JSON-RPC protocol, protocol-version negotiation, RFC 9728
discovery metadata, and the `401` challenge that lets a client find your
authorization server. The default negotiated revision is the current finalized
`2025-11-25` specification; older finalized revisions remain available when
explicitly requested.

## Agent action enforcement

Tools carrying manifest contract 2 `authorization` metadata fail closed unless
an `agency` enforcement point is configured. Every call becomes an exact-input
action request; allowed calls execute through a short-lived single-use lease and
produce a receipt. Requestable denials return an `absolute.action_decision`
payload containing the action id for an approval workflow.

```ts
import { createAgency, createMemoryAgencyStore } from "@absolutejs/agency";

const agency = createAgency({ policy, store: createMemoryAgencyStore() });

mcpServer<Caller>({
  agency: {
    enforcement: agency,
    resolveActor: ({ caller, scopes }) => ({
      agentId: caller.agentId,
      delegationId: caller.delegationId,
      scopes,
      userId: caller.userId,
    }),
  },
  // normal MCP config…
});
```

## Durable Tasks

The package implements native MCP `2025-11-25` task augmentation:
`execution.taskSupport`, client-requested task creation, `tasks/get`,
`tasks/result`, authorization-bound `tasks/list`, and terminal-safe
`tasks/cancel`. It also retains the older `io.modelcontextprotocol/tasks`
SEP-2663 wire shape only when an older protocol revision is negotiated.

```ts
tasks: {
  authorizationKey: (caller) => caller.userId,
  shouldCreate: ({ name }) => name === "long_running_report",
  store: createMemoryMcpTaskStore(), // use a durable shared store in production
  ttlMs: 60 * 60 * 1000,
}

tools: () => ({
  long_running_report: {
    taskSupport: "optional", // "required" and "forbidden" are also supported
    // normal tool definition…
  },
})
```

Clients can use `callToolAsTask`, then `getTask`, `listTasks`, `cancelTask`, and
`getTaskResult`. Task status never exposes the stored result or authorization
key; the final result is returned only by `tasks/result` with required
`io.modelcontextprotocol/related-task` metadata.

For multi-instance production deployments, use
`createPostgresMcpTaskStore()` and `createPostgresMcpSessionStore()` after
applying `mcpPostgresSchemaSql()`. Task updates and cancellation protect
terminal states in the database, task reads enforce TTL, and session access
atomically extends only unexpired sessions. The adapters accept a structural
SQL client and do not require a particular PostgreSQL driver.

Nothing here depends on a model. The tool shape is structurally compatible with
[`@absolutejs/ai`](https://github.com/absolutejs/ai)'s `AIToolMap`, so an AI tool
registry serves over MCP without conversion — but any typed tool registry works.

```
bun add @absolutejs/mcp
```

Peer dependency: `elysia`.

## Define an endpoint

```ts
import { Elysia } from "elysia";
import { mcpServer, verifyBearer } from "@absolutejs/mcp";
import { verifyJwt } from "@absolutejs/auth"; // or any JWT verifier

type Caller = { userId: string };

const server = new Elysia().use(
  mcpServer<Caller>({
    path: "/mcp",
    issuer: "https://your.app",
    serverInfo: { name: "your-app", title: "Your App", version: "1.0.0" },
    instructions: "What the model should know about this server.",
    scopesSupported: ["openid", "mcp"],
    serveRootMetadata: true,

    // You decide who is allowed in. verifyBearer does the standard OAuth
    // access-token checks; add your own (billing, role, MFA) on top.
    authorize: async (request) => {
      const token = await verifyBearer({
        request,
        issuer: "https://your.app",
        requiredScope: "mcp",
        verify: (jwt) => verifyJwt(jwt, publicJwk),
      });
      if ("error" in token) return { ok: false, reason: token.error };
      return { ok: true, caller: { userId: token.subject } };
    },

    // Called once per request; build the tools for this caller.
    tools: ({ caller }) => buildToolsFor(caller.userId),
  }),
);
```

That is a complete member endpoint. `GET /mcp` returns `405`, `POST /mcp` speaks
JSON-RPC, and `GET /.well-known/oauth-protected-resource[/mcp]` serves the
discovery metadata.

## Guards, prompts, resources

Everything beyond tools is a hook — the package ships no opinion about billing,
storage, or auditing.

```ts
mcpServer<Caller>({
  // ...as above

  // Refuse a single call before it runs (credits, rate limit). The message
  // comes back as an isError tool result the model can relay — not a crash.
  beforeCall: async ({ caller }) =>
    (await outOfCredits(caller))
      ? { block: "Out of credits this cycle." }
      : undefined,

  // Audit every call. `meta` carries whatever the tool handler wrote.
  onCall: ({ caller, name, ok, meta }) =>
    recordCall({ caller, name, ok, touched: meta.touched }),

  // Server-side prompts: recipes the client shows in its picker.
  prompts: {
    definitions: {
      daily_briefing: { title: "Daily briefing", description: "..." },
    },
    get: async ({ name, args, caller }) => buildPromptText(name, args, caller),
  },

  // Readable resources.
  resources: {
    list: ({ caller }) => listResources(caller),
    read: ({ caller, uri }) => readResource(caller, uri), // string | null
  },
});
```

### The `meta` scratchpad

Each `tools/call` gets a fresh `meta` object shared between `tools`,
`beforeCall`, and `onCall`. A tool handler can record what it touched, and your
audit hook can read it back:

```ts
tools: ({ caller, meta }) =>
  buildAdminTools(caller, (memberId) => { meta.touched = memberId; }),
onCall: ({ meta, name, ok }) =>
  ledger.write({ tool: name, ok, member: meta.touched }),
```

## Feedback: the channel a client can't give you

A connected AI client renders no UI for your server. There is no button for the
user to press, so when they say _"that was wrong"_ the only path back to you is
the model relaying it. Every MCP server has this hole, and every one of them
hand-rolls the same two tools.

```ts
import { feedbackTools, FEEDBACK_INSTRUCTIONS } from "@absolutejs/mcp";

mcpServer<Caller>({
  instructions: `${myInstructions} ${FEEDBACK_INSTRUCTIONS}`,
  tools: ({ caller }) => ({
    ...myTools(caller),
    ...feedbackTools({
      caller,
      store: {
        reportProblem: ({ caller, report }) => file(caller, report), // → "Filed as #42."
        submitFeedback: ({ caller, feedback }) => record(caller, feedback),
      },
    }),
  }),
});
```

`FEEDBACK_INSTRUCTIONS` is the load-bearing half. Without it a model treats a
complaint as something to apologise for, and the signal dies where it was
spoken.

## Elicitation: ask the user a question mid-call

A tool that can't finish without something only the user knows can **ask them**
(`elicitation/create`) and wait for the answer.

```ts
mcpServer<Caller>({
  elicitation: { enabled: true },
  tools: () => ({
    book_table: {
      description: "Book a table.",
      inputSchema: { type: "object" },
      mayElicit: true, // opt in: this tool may ask
      handler: async (args, { canElicit, elicit }) => {
        if (!canElicit) return "Tell me the party size and I'll book it.";
        const answer = await elicit({
          message: "How many people?",
          requestedSchema: {
            type: "object",
            properties: { people: { type: "integer", minimum: 1 } },
            required: ["people"],
          },
        });
        if (answer.action !== "accept") return "No problem — cancelled.";
        return `Booked for ${answer.content.people}.`;
      },
    },
  }),
});
```

`requestedSchema` is a **flat object of primitives** (string / number / integer
/ boolean / enum) — the spec restricts it so any client can render a form. The
answer is `accept` (with `content`), `decline` (they said no), `cancel` (they
dismissed it), or `unsupported` (this client can't ask anyone — check
`canElicit` and take another path). Never fabricate an answer for the user; the
spec also forbids eliciting **sensitive information**.

For credentials, third-party OAuth, or payment flows, use `mode: "url"` with a
unique `elicitationId` and HTTPS URL. The client advertises form and URL modes
separately, never prefetches the URL, and returns only the user's consent—not
credentials or page contents. Tool handlers can check `canElicitUrl` before
starting the flow. The server rejects non-HTTPS URLs except localhost
development URLs and rejects URLs containing embedded credentials.

**The trade-off, stated plainly.** Elicitation is the one MCP feature a
stateless server cannot do: the question goes out on the SSE stream of an
in-flight `tools/call`, and the client answers on a _separate_ HTTP POST. Two
requests have to meet, so the endpoint becomes **session-stateful**
(`Mcp-Session-Id`). Leave `elicitation` off — the default — and nothing changes:
the server stays stateless, `tools/call` keeps answering with a plain JSON body,
and only tools marked `mayElicit` ever stream.

**Running more than one instance.** Behind one server the defaults handle it.
Behind several, two different things break, and each has a seam:

```ts
elicitation: {
  enabled: true,
  // (1) The client initializes on A and calls a tool on B, which has never
  //     heard of the session. Put session state where every instance sees it.
  //     It is an id and a boolean — nothing sensitive, nothing large.
  store: {
    create: ({ canElicit }) => db.insertSession(canElicit), // → id
    get: (id) => db.findSession(id),                        // → { canElicit } | null
    drop: (id) => db.deleteSession(id),
  },
  // (2) The tool call and its question live on ONE instance, but the user's
  //     answer POST can land on any of them. A promise cannot move, so route
  //     the answer to the instance that is waiting — over whatever fan-out you
  //     already run (Postgres LISTEN/NOTIFY, Redis, …).
  bus: {
    publish: (answer) => notify("mcp_elicit", answer),
    subscribe: (handler) => listen("mcp_elicit", handler),
  },
}
```

Supply neither and run a single instance (or pin sessions). Supply both and
elicitation is safe behind a load balancer with **no sticky routing** — there is
a test for exactly that: instance A asks, the answer lands on B, the bus carries
it back, and A's call finishes.

AbsoluteJS already ships both production transports. PostgreSQL is the default;
Redis is an optional at-most-once fan-out optimization:

```ts
import { createPostgresChannelBus } from "@absolutejs/sync-bus-pg";
import type { McpElicitAnswer } from "@absolutejs/mcp";

const bus = createPostgresChannelBus<McpElicitAnswer>({
  sql,
  channel: "absolutejs_mcp_elicitation",
  spill: "always",
});

const config = {
  // ...
  elicitation: {
    enabled: true,
    store: createPostgresMcpSessionStore({ sql }),
    bus,
  },
};
```

The channel is only coordination: durable jobs and side effects belong in
`@absolutejs/queue` / `@absolutejs/execution`, not Redis pub/sub or NOTIFY.

Consuming a server that elicits? Pass `onElicit` to `createMcpClient` — that is
what declares the capability, and what the package uses to answer. Omit it and
servers are told you cannot ask anyone.

## A second, stricter endpoint

`mcpServer` is per-endpoint, so an admin console is the same call with a
different scope, a stricter `authorize` (role + MFA + a kill switch, re-checked
live), a rate-limit `beforeCall`, and an audit `onCall`:

```ts
app.use(mcpServer({ path: "/mcp" /* member */ })).use(
  mcpServer({
    path: "/mcp/admin",
    scopesSupported: ["openid", "mcp:admin"] /* stricter */,
  }),
);
```

Only one endpoint per app should set `serveRootMetadata` (the un-suffixed alias).

## OAuth-native MCP client

`createMcpOAuthProvider` handles the current MCP authorization flow without
coupling to an identity vendor: RFC 9728 protected-resource discovery, OAuth or
OIDC authorization-server discovery, Client ID Metadata Document identifiers,
PKCE S256, resource indicators, refresh rotation, incremental scope challenges,
and optional DPoP proofs. The host owns the user interaction and token store.

```ts
const authorization = createMcpOAuthProvider({
  endpoint: "https://tools.example/mcp",
  clientId: "https://my-agent.example/oauth-client.json",
  redirectUri: "https://my-agent.example/oauth/callback",
  fetch: egress.fetch,
  store: durableTokenStore,
  onAuthorize: showConsentAndWaitForCallback,
});

const client = createMcpClient({
  url: "https://tools.example/mcp",
  authorization,
});
```

The client retries a 401 only once and only after the authorization provider
reports success. Metadata fetches require HTTPS, reject redirects, enforce byte
limits, verify issuer/resource identity, and use the injected fetch so production
deployments can route discovery through `@absolutejs/egress`.

## License

Business Source License 1.1 — see [LICENSE](./LICENSE). Converts to Apache 2.0
on the Change Date.
