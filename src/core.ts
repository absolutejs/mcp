// Transport-agnostic core shared by the Elysia plugin (server.ts) and the raw
// request handler (handler.ts). Everything here works with the web-standard
// Request/Response, so it runs on Bun.serve, Hono, Next.js route handlers,
// Cloudflare Workers, or Elysia unchanged.

import { dispatchMcp } from "./dispatch";
import { createSessionRegistry, type SessionRegistry } from "./sessions";
import {
  HTTP_METHOD_NOT_ALLOWED,
  HTTP_NO_CONTENT,
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
const HTTP_NOT_FOUND = 404;

// Elicitation needs the pending call and the client's answer — which arrive on
// two different HTTP requests — to meet in one process. The registry is keyed
// off the config OBJECT so the public API stays `(config, request)`: a server
// built once gets one registry for its lifetime, and a config that never turns
// elicitation on never creates one.
const registries = new WeakMap<object, SessionRegistry>();

const registryFor = <Caller>(config: McpServerConfig<Caller>) => {
  if (!config.elicitation?.enabled) return undefined;
  const existing = registries.get(config);
  if (existing) return existing;
  const created = createSessionRegistry({
    elicitTimeoutMs: config.elicitation.timeoutMs,
  });
  registries.set(config, created);

  return created;
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

  const sessions = registryFor(config);
  const sessionId = request.headers.get("mcp-session-id");
  // A session we don't know is a session we restarted out from under: 404 tells
  // the client to re-initialize, which the spec requires it to handle.
  if (sessions && sessionId && !sessions.get(sessionId)) {
    return new Response(null, { status: HTTP_NOT_FOUND });
  }

  return dispatchMcp(config, auth.caller, auth.scopes ?? [], body, {
    sessionId,
    sessions,
  }).catch(() => rpcError(null, JSONRPC_INVALID_REQUEST, "Internal error"));
};

/** The client is done with its session and says so (spec: Session Management).
 *  Only meaningful when elicitation put us in a session at all — otherwise 405,
 *  which the spec explicitly allows for servers that don't do sessions. */
export const runMcpDelete = <Caller>(
  config: McpServerConfig<Caller>,
  request: Request,
) => {
  const sessions = registryFor(config);
  const sessionId = request.headers.get("mcp-session-id");
  if (!sessions || !sessionId) {
    return new Response(null, { status: HTTP_METHOD_NOT_ALLOWED });
  }
  sessions.drop(sessionId);

  return new Response(null, { status: HTTP_NO_CONTENT });
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

  if (request.method === "DELETE" && pathname === config.path) {
    return runMcpDelete(config, request);
  }

  return null;
};
