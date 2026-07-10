// Public types for @absolutejs/mcp. A server is defined by a config object:
// the host supplies WHICH tools/prompts/resources to expose, HOW to authorize a
// request into a caller, and OPTIONAL per-call guards; the package owns the
// JSON-RPC protocol, discovery metadata, and 401 challenge.

/** MCP behaviour hints, passed straight through to the client on `tools/list`.
 *  Structurally identical to `@absolutejs/ai`'s `AIToolAnnotations`, so a tool
 *  map from that package satisfies this without conversion. All optional. */
export type McpToolAnnotations = {
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  readOnlyHint?: boolean;
  title?: string;
};

/** One callable tool. `inputSchema` is a JSON Schema object; `handler` receives
 *  the client's `arguments` and returns text (the tool's `content`). */
export type McpTool = {
  annotations?: McpToolAnnotations;
  description: string;
  handler: (args: unknown) => Promise<string> | string;
  inputSchema: Record<string, unknown>;
};

export type McpToolRegistry = Record<string, McpTool>;

/** A resource the client can list and read (`resources/list` / `resources/read`). */
export type McpResource = {
  description?: string;
  mimeType?: string;
  name: string;
  uri: string;
};

export type McpPromptArgument = {
  description: string;
  name: string;
  required?: boolean;
};

export type McpPromptDefinition = {
  arguments?: McpPromptArgument[];
  description: string;
  title: string;
};

/** Per-call scratchpad shared between `tools`, `beforeCall`, and `onCall` for
 *  one `tools/call` request. A tool handler can write to it (e.g. record which
 *  entity it touched) and `onCall` can read it back for the audit row. */
export type McpCallMeta = Record<string, unknown>;

/** What `authorize` returns: the resolved caller, or a reason for the 401. */
export type McpAuthResult<Caller> =
  | { caller: Caller; ok: true }
  | { ok: false; reason: string };

/** Returned by `beforeCall` to refuse a tool call without running it — the
 *  message becomes an `isError` tool result (a paused/rate-limited notice the
 *  model can relay), not a transport error. */
export type McpCallGate = { block: string };

export type McpToolContext<Caller> = { caller: Caller; meta: McpCallMeta };

export type McpPrompts<Caller> = {
  definitions: Record<string, McpPromptDefinition>;
  get: (ctx: {
    args: Record<string, unknown>;
    caller: Caller;
    name: string;
  }) => Promise<string | null> | string | null;
};

export type McpResources<Caller> = {
  /** Defaults to "text/markdown". */
  mimeType?: string;
  list: (ctx: { caller: Caller }) => Promise<McpResource[]> | McpResource[];
  read: (ctx: {
    caller: Caller;
    uri: string;
  }) => Promise<string | null> | string | null;
};

export type McpServerInfo = {
  name: string;
  title?: string;
  version: string;
};

export type McpServerConfig<Caller> = {
  /** Resolve the request into a caller, or a reason for the 401. The package
   *  emits the 401 + RFC 9728 `WWW-Authenticate` challenge; you decide who is
   *  allowed in. See {@link verifyBearer} for the standard token checks. */
  authorize: (request: Request) => Promise<McpAuthResult<Caller>>;
  /** Refuse a single `tools/call` before it runs (credits exhausted, rate
   *  limited). Return `{ block }` to short-circuit; return nothing to proceed. */
  beforeCall?: (ctx: {
    args: unknown;
    caller: Caller;
    meta: McpCallMeta;
    name: string;
  }) => Promise<McpCallGate | void> | McpCallGate | void;
  instructions?: string;
  /** The token issuer — used for discovery metadata and the challenge URL. */
  issuer: string;
  /** Fired after every `tools/call` for auditing. `meta` carries anything the
   *  tool handler wrote during the call. */
  onCall?: (record: {
    args: unknown;
    caller: Caller;
    meta: McpCallMeta;
    name: string;
    ok: boolean;
  }) => Promise<void> | void;
  /** The endpoint path, e.g. "/mcp" or "/mcp/admin". */
  path: string;
  prompts?: McpPrompts<Caller>;
  resources?: McpResources<Caller>;
  /** Advertised in the protected-resource metadata. */
  scopesSupported?: string[];
  /** Also serve the un-suffixed `/.well-known/oauth-protected-resource` alias
   *  (some clients probe the root). Only one endpoint per app may set this. */
  serveRootMetadata?: boolean;
  serverInfo: McpServerInfo;
  /** Protocol versions this endpoint accepts; the first is the preferred one.
   *  Defaults to the versions this package knows. */
  supportedProtocols?: string[];
  /** Build the tool registry for this caller. Called once per request. */
  tools: (
    ctx: McpToolContext<Caller>,
  ) => McpToolRegistry | Promise<McpToolRegistry>;
};
