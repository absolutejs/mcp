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
export { dispatchMcp } from "./dispatch";
export { createMcpHandler } from "./handler";
export {
  metadataPathFor,
  protectedResourceMetadata,
  type ProtectedResourceMetadata,
} from "./metadata";
export { mcpServer } from "./server";
export type {
  McpAudioContent,
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
  McpTool,
  McpToolAnnotations,
  McpToolContext,
  McpToolRegistry,
  McpToolResult,
  McpToolReturn,
} from "./types";
