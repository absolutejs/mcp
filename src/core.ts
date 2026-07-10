// Transport-agnostic core shared by the Elysia plugin (server.ts) and the raw
// request handler (handler.ts). Everything here works with the web-standard
// Request/Response, so it runs on Bun.serve, Hono, Next.js route handlers,
// Cloudflare Workers, or Elysia unchanged.

import { dispatchMcp } from "./dispatch";
import {
  HTTP_METHOD_NOT_ALLOWED,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_PARSE_ERROR,
  rpcError,
  unauthorized,
} from "./jsonrpc";
import { metadataPathFor, protectedResourceMetadata } from "./metadata";
import type { McpServerConfig } from "./types";

export const ROOT_METADATA_PATH = "/.well-known/oauth-protected-resource";
const JSON_HEADERS: Record<string, string> = {
  "content-type": "application/json",
};

export const metadataResponse = <Caller>(config: McpServerConfig<Caller>) =>
  new Response(
    JSON.stringify(
      protectedResourceMetadata({
        issuer: config.issuer,
        resource: `${config.issuer}${config.path}`,
        scopes: config.scopesSupported,
      }),
    ),
    { headers: JSON_HEADERS },
  );

/** Run one POST: authorize → validate the (already-decoded) body → dispatch.
 *  The body is passed in because Elysia pre-parses it while a raw handler must
 *  parse it itself; both funnel through here so the logic lives in one place. */
export const runMcpPost = async <Caller>(
  config: McpServerConfig<Caller>,
  request: Request,
  body: unknown,
): Promise<Response> => {
  const auth = await config.authorize(request);
  if (!auth.ok) {
    return unauthorized(
      `${config.issuer}${metadataPathFor(config.path)}`,
      auth.reason,
    );
  }
  if (body === undefined || body === null) {
    return rpcError(null, JSONRPC_PARSE_ERROR, "Invalid JSON");
  }
  // 2025-06-18 dropped JSON-RPC batching — reject rather than half-support.
  if (Array.isArray(body)) {
    return rpcError(null, JSONRPC_INVALID_REQUEST, "Batching is not supported");
  }

  return dispatchMcp(config, auth.caller, auth.scopes ?? [], body).catch(() =>
    rpcError(null, JSONRPC_INVALID_REQUEST, "Internal error"),
  );
};

/** The full path-aware handler over web-standard Request/Response. Returns a
 *  Response for any MCP route (POST endpoint, GET 405, discovery metadata) and
 *  `null` for anything else, so a host can compose it with its own routes. */
export const handleMcpRequest = async <Caller>(
  config: McpServerConfig<Caller>,
  request: Request,
): Promise<Response | null> => {
  const { pathname } = new URL(request.url);
  const metadataPath = metadataPathFor(config.path);

  if (request.method === "GET") {
    if (pathname === metadataPath) return metadataResponse(config);
    if (config.serveRootMetadata && pathname === ROOT_METADATA_PATH) {
      return metadataResponse(config);
    }
    if (pathname === config.path) {
      return new Response(null, { status: HTTP_METHOD_NOT_ALLOWED });
    }

    return null;
  }

  if (request.method === "POST" && pathname === config.path) {
    const body = await request.json().catch(() => undefined);

    return runMcpPost(config, request, body);
  }

  return null;
};
