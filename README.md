# @absolutejs/mcp

Serve a remote [Model Context Protocol](https://modelcontextprotocol.io) endpoint
— streamable HTTP, stateless — from a tool/prompt/resource registry. You supply
**which** tools to expose and **how** to authorize a request into a caller; the
package owns the JSON-RPC protocol, protocol-version negotiation, RFC 9728
discovery metadata, and the `401` challenge that lets a client find your
authorization server.

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

**The trade-off, stated plainly.** Elicitation is the one MCP feature a
stateless server cannot do: the question goes out on the SSE stream of an
in-flight `tools/call`, and the client answers on a _separate_ HTTP POST. Two
requests have to meet, so the pending call is remembered in-process and the
endpoint becomes **session-stateful** (`Mcp-Session-Id`). Run one instance, or
pin sessions. Leave `elicitation` off — the default — and nothing changes: the
server stays stateless, `tools/call` keeps answering with a plain JSON body, and
only tools marked `mayElicit` ever stream.

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

## License

Business Source License 1.1 — see [LICENSE](./LICENSE). Converts to Apache 2.0
on the Change Date.
