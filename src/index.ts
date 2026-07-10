/**
 * `@absolutejs/mcp` — serve a remote Model Context Protocol endpoint
 * (streamable HTTP, stateless) from a tool/prompt/resource registry.
 *
 * Define the endpoint once with {@link mcpServer} and mount it on your Elysia
 * app. You supply WHICH tools to expose and HOW to authorize a request into a
 * caller ({@link verifyBearer} does the standard OAuth bearer checks against
 * any authorization server); the package owns the JSON-RPC protocol, protocol
 * negotiation, RFC 9728 discovery metadata, and the 401 challenge. Per-call
 * guards (`beforeCall` to gate on credits/rate limits, `onCall` to audit) and a
 * per-call `meta` scratchpad are hooks — the package ships no opinions about
 * billing, storage, or who is allowed in.
 *
 * The tool shape is structurally compatible with `@absolutejs/ai`'s
 * `AIToolMap`, so an AI tool registry serves over MCP without conversion — but
 * nothing here depends on a model: any typed tool registry works.
 */

export {
  verifyBearer,
  type BearerResult,
  type BearerVerifier,
  type VerifiedJwt,
  type VerifyBearerConfig,
} from "./auth";
export { dispatchMcp } from "./dispatch";
export {
  metadataPathFor,
  protectedResourceMetadata,
  type ProtectedResourceMetadata,
} from "./metadata";
export { mcpServer } from "./server";
export type {
  McpAuthResult,
  McpCallGate,
  McpCallMeta,
  McpPromptArgument,
  McpPromptDefinition,
  McpPrompts,
  McpResource,
  McpResources,
  McpServerConfig,
  McpServerInfo,
  McpTool,
  McpToolAnnotations,
  McpToolContext,
  McpToolRegistry,
} from "./types";
