// Public types for @absolutejs/mcp. A server is defined by a config object:
// the host supplies WHICH tools/prompts/resources to expose, HOW to authorize a
// request into a caller, and OPTIONAL per-call guards; the package owns the
// JSON-RPC protocol, discovery metadata, and 401 challenge.

import type { Agency, AgentActor } from "@absolutejs/agency";
import type { ToolAuthorization } from "@absolutejs/manifest";

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

/** A question the SERVER asks the USER, mid-tool-call, through the client
 *  (`elicitation/create`). The schema is a deliberately restricted subset of
 *  JSON Schema — a FLAT object of primitives (string / number / integer /
 *  boolean / enum), so any client can render a form for it. Nested objects and
 *  arrays are not allowed by the spec.
 *
 *  Servers MUST NOT elicit sensitive information (spec, Security). */
export type McpElicitationRequest = {
  message: string;
  requestedSchema: Record<string, unknown>;
};

/** What came back. `unsupported` is ours, not the spec's: it is what you get
 *  when the client never declared the elicitation capability, so a tool can
 *  fall back instead of pretending the user declined. */
export type McpElicitResult =
  | { action: "accept"; content: Record<string, unknown> }
  | { action: "cancel" }
  | { action: "decline" }
  | { action: "unsupported" };

/** The client's answer, on its way back to whichever instance is waiting. */
export type McpElicitAnswer = {
  requestId: string;
  result: McpElicitResult;
  sessionId: string | null;
};

/** Where session state lives. The default is in-memory (one instance). Put it
 *  in your database and any instance can serve any session. Nothing here is
 *  sensitive or large — an id and a capability flag. */
export type McpSessionStore = {
  create: (session: { canElicit: boolean }) => Promise<string> | string;
  drop: (id: string) => Promise<void> | void;
  get: (
    id: string,
  ) => Promise<{ canElicit: boolean } | null> | { canElicit: boolean } | null;
};

/** How an answer reaches the instance that asked the question. The tool call
 *  and its pending promise live on ONE process; the client's answer POST can
 *  land on any of them. Wire this to whatever fan-out you already run
 *  (Postgres LISTEN/NOTIFY, Redis, …) and elicitation works with no sticky
 *  routing. Omit it and you must run a single instance (or pin sessions). */
export type McpElicitBus = {
  /** An answer nobody here was waiting for — someone else might be. */
  publish: (answer: McpElicitAnswer) => void;
  subscribe: (handler: (answer: McpElicitAnswer) => void) => void;
};

/** Passed to a tool handler as its second argument. Ignore it and nothing
 *  changes — every existing handler keeps working. */
export type McpToolCallContext = {
  /** True when this client can actually show the user a form. Check it before
   *  designing a flow around elicit(). */
  canElicit: boolean;
  /** Ask the user a question and wait for the answer. Resolves to
   *  `{action:"unsupported"}` immediately when the client can't elicit, and to
   *  `{action:"cancel"}` if they never answer. */
  elicit: (request: McpElicitationRequest) => Promise<McpElicitResult>;
};

/** One callable tool. `inputSchema` is a JSON Schema object. */
export type McpTool = {
  annotations?: McpToolAnnotations;
  /** Enforceable semantic effects from manifest contract 2. A tool carrying
   *  this is hidden unless the server configures `agency`. */
  authorization?: ToolAuthorization;
  description: string;
  handler: (
    args: unknown,
    context: McpToolCallContext,
  ) => McpToolReturn | Promise<McpToolReturn>;
  inputSchema: Record<string, unknown>;
  /** Set when this tool may call `context.elicit`. It makes the server answer
   *  the `tools/call` with an SSE stream (the only way to send the user a
   *  question mid-call) instead of a plain JSON body — so it is opt-in per
   *  tool, and a server whose tools never elicit stays purely stateless. */
  mayElicit?: boolean;
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

export type McpAgencyOptions<Caller> = {
  enforcement: Agency;
  resolveActor: (context: {
    caller: Caller;
    scopes: string[];
  }) => Promise<AgentActor> | AgentActor;
  serverId?: string;
};

export type McpTaskStatus =
  | "cancelled"
  | "completed"
  | "failed"
  | "input_required"
  | "working";

export type McpTask = {
  authorizationKey: string;
  createdAt: string;
  error?: Record<string, unknown>;
  inputRequests?: Record<string, unknown>;
  lastUpdatedAt: string;
  pollIntervalMs?: number;
  result?: Record<string, unknown>;
  status: McpTaskStatus;
  statusMessage?: string;
  taskId: string;
  ttlMs: number | null;
};

export type McpTaskStore = {
  cancel: (taskId: string) => Promise<void> | void;
  get: (taskId: string) => Promise<McpTask | null> | McpTask | null;
  save: (task: McpTask) => Promise<void> | void;
  update: (
    taskId: string,
    update: Partial<Omit<McpTask, "authorizationKey" | "createdAt" | "taskId">>,
  ) => Promise<McpTask | null> | McpTask | null;
};

export type McpTasksOptions<Caller> = {
  authorizationKey: (caller: Caller) => Promise<string> | string;
  onUpdate?: (context: {
    caller: Caller;
    inputResponses: Record<string, unknown>;
    task: McpTask;
  }) => Promise<void> | void;
  pollIntervalMs?: number;
  shouldCreate: (context: {
    args: unknown;
    caller: Caller;
    name: string;
  }) => Promise<boolean> | boolean;
  store: McpTaskStore;
  ttlMs?: number | null;
};

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
  /** Per-tool action policy enforcement, approval, leases, and receipts. */
  agency?: McpAgencyOptions<Caller>;
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
  /** Turn on elicitation (server asks the USER a question mid-tool-call).
   *  Off by default, because it makes the endpoint SESSION-STATEFUL: the
   *  client answers on a separate HTTP request, so the pending call has to be
   *  remembered in-process. Run one instance, or pin `Mcp-Session-Id`. Tools
   *  must also opt in with `mayElicit`. */
  elicitation?: {
    /** Route answers to the instance that asked. Required to run more than one
     *  instance without sticky sessions. */
    bus?: McpElicitBus;
    enabled: true;
    /** Shared session state. Required to run more than one instance. */
    store?: McpSessionStore;
    /** How long a question waits for a human before it gives up (default 2m). */
    timeoutMs?: number;
  };
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
  /** Final SEP-2663 `io.modelcontextprotocol/tasks` extension support. */
  tasks?: McpTasksOptions<Caller>;
  /** Build the tool registry for this caller. Called once per request. */
  tools: (
    ctx: McpToolContext<Caller>,
  ) => McpToolRegistry | Promise<McpToolRegistry>;
};
