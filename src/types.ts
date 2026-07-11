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

/** Rich tool-result content blocks. A handler may return a bare string (wrapped
 *  as one text block), an array of these, or a full {@link McpToolResult}. */
export type McpTextContent = { text: string; type: "text" };
export type McpImageContent = {
  data: string;
  mimeType: string;
  type: "image";
};
export type McpAudioContent = {
  data: string;
  mimeType: string;
  type: "audio";
};
export type McpResourceLink = {
  description?: string;
  mimeType?: string;
  name?: string;
  type: "resource_link";
  uri: string;
};
export type McpContent =
  | McpAudioContent
  | McpImageContent
  | McpResourceLink
  | McpTextContent;

export type McpToolResult = {
  content: McpContent[];
  isError?: boolean;
  /** Structured output validated against the tool's `outputSchema`, if any. */
  structuredContent?: Record<string, unknown>;
};

/** What a tool handler may return. A bare string is the common case. */
export type McpToolReturn = McpContent[] | McpToolResult | string;

/** One callable tool. `inputSchema` is a JSON Schema object. */
export type McpTool = {
  annotations?: McpToolAnnotations;
  description: string;
  handler: (args: unknown) => McpToolReturn | Promise<McpToolReturn>;
  inputSchema: Record<string, unknown>;
  /** JSON Schema for `structuredContent`, advertised on `tools/list`. */
  outputSchema?: Record<string, unknown>;
  /** If set, the tool is only listed and callable when the caller's scopes
   *  include this. Tools without a scope are always available. Fails closed:
   *  a scoped tool is hidden when the caller's scopes are unknown. */
  scope?: string;
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

/** What `authorize` returns: the resolved caller (plus the caller's scopes, if
 *  any tools are scope-gated), or a reason for the 401. */
export type McpAuthResult<Caller> =
  | { caller: Caller; ok: true; scopes?: string[] }
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
  /** Page size for tools/prompts/resources list pagination (default 50). */
  listPageSize?: number;
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
