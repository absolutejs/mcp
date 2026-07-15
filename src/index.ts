/**
 * `@absolutejs/mcp` — serve (and consume) a Model Context Protocol endpoint
 * over streamable HTTP, from a tool/prompt/resource registry.
 *
 * **Serve.** Define the endpoint once and mount it: {@link mcpServer} returns an
 * Elysia plugin, or {@link createMcpHandler} returns a framework-agnostic
 * `(request) => Response | null` for Bun.serve / Hono / Next.js / Workers. You
 * supply WHICH tools to expose and HOW to authorize a request into a caller
 * ({@link verifyBearer} does the standard OAuth bearer checks against any
 * authorization server); the package owns the JSON-RPC protocol, protocol
 * negotiation, RFC 9728 discovery metadata, and the 401 challenge. Per-call
 * guards (`beforeCall`, `onCall`), a per-call `meta` scratchpad, per-tool
 * `scope` gating, and rich tool results (text/image/structured) are all
 * built in; the package ships no opinion about billing, storage, or access.
 *
 * **Feedback.** A connected AI client gives a server no UI, so a user's "that
 * was wrong" can only come back through the model. {@link feedbackTools} is the
 * pair of tools that carries it (report_problem / submit_feedback), and
 * {@link FEEDBACK_INSTRUCTIONS} is the sentence that makes a model actually use
 * them instead of just apologising. {@link McpServerConfig.elicitation} goes
 * further: a tool marked `mayElicit` can ASK the user a question mid-call
 * (`elicitation/create`) and wait for the answer.
 *
 * **Consume.** {@link createMcpClient} is a streamable-HTTP client for calling
 * OTHER MCP servers — the half you need to expose a user's own connected tools
 * to your agent. Safety wrapping around untrusted remote tools (namespacing,
 * injection defense, approval gating) is the host's job.
 *
 * The tool shape is structurally compatible with `@absolutejs/ai`'s `AIToolMap`,
 * so an AI tool registry serves over MCP without conversion — but nothing here
 * depends on a model.
 */

export {
  verifyBearer,
  type BearerResult,
  type BearerVerifier,
  type VerifiedJwt,
  type VerifyBearerConfig,
} from "./auth";
export {
  createMcpClient,
  McpClientError,
  type McpClient,
  type McpClientOptions,
  type McpInitializeResult,
  type McpRemoteTool,
} from "./client";
export { dispatchMcp, type McpDispatchContext } from "./dispatch";
export {
  FEEDBACK_INSTRUCTIONS,
  feedbackTools,
  type McpFeedbackRating,
  type McpFeedbackReport,
  type McpFeedbackStore,
  type McpProblemReport,
} from "./feedback";
export { createMcpHandler } from "./handler";
export {
  metadataPathFor,
  protectedResourceMetadata,
  type ProtectedResourceMetadata,
} from "./metadata";
export { mcpServer } from "./server";
export { createSessionRegistry, type SessionRegistry } from "./sessions";
export { createMemoryMcpTaskStore, publicMcpTask } from "./tasks";
export {
  createPostgresMcpSessionStore,
  createPostgresMcpTaskStore,
  mcpPostgresSchemaSql,
  type McpSqlClient,
  type McpSqlResult,
} from "./postgres";
export type {
  McpAgencyOptions,
  McpAudioContent,
  McpElicitAnswer,
  McpElicitationRequest,
  McpElicitBus,
  McpElicitResult,
  McpSessionStore,
  McpAuthResult,
  McpCallGate,
  McpCallMeta,
  McpContent,
  McpImageContent,
  McpPromptArgument,
  McpPromptDefinition,
  McpPrompts,
  McpResource,
  McpResourceLink,
  McpResources,
  McpServerConfig,
  McpServerInfo,
  McpTextContent,
  McpTask,
  McpTaskStatus,
  McpTaskStore,
  McpTasksOptions,
  McpTool,
  McpToolAnnotations,
  McpToolCallContext,
  McpToolContext,
  McpToolRegistry,
  McpToolResult,
  McpToolReturn,
} from "./types";
