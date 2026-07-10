// The Elysia plugin. Mounts the endpoint and its discovery metadata, resolves
// each POST into a caller via your `authorize`, and dispatches the JSON-RPC
// message. Returns a base-typed Elysia so the routes (which return raw
// Responses) never inflate a consumer's Eden treaty type.

import { Elysia } from "elysia";
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

const ROOT_METADATA_PATH = "/.well-known/oauth-protected-resource";

/** Build the MCP endpoint as an Elysia plugin. Mount it with `.use(...)`.
 *
 *  Serves:
 *   - `POST <path>`   — the JSON-RPC endpoint (stateless streamable HTTP)
 *   - `GET  <path>`   — 405 (no server-initiated stream to subscribe to)
 *   - `GET  /.well-known/oauth-protected-resource<path>` — RFC 9728 metadata
 *   - `GET  /.well-known/oauth-protected-resource` — the same, if
 *     `serveRootMetadata` is set (only one endpoint per app should). */
export const mcpServer = <Caller>(config: McpServerConfig<Caller>) => {
  const metadataPath = metadataPathFor(config.path);
  const metadataUrl = `${config.issuer}${metadataPath}`;
  const metadata = () =>
    protectedResourceMetadata({
      issuer: config.issuer,
      resource: `${config.issuer}${config.path}`,
      scopes: config.scopesSupported,
    });

  const base = new Elysia()
    .get(metadataPath, metadata)
    .get(
      config.path,
      () => new Response(null, { status: HTTP_METHOD_NOT_ALLOWED }),
    )
    .post(config.path, async ({ body, request }) => {
      const auth = await config.authorize(request);
      if (!auth.ok) return unauthorized(metadataUrl, auth.reason);
      // Elysia has already parsed the JSON body (no schema → unknown).
      const message = body;
      if (message === undefined || message === null) {
        return rpcError(null, JSONRPC_PARSE_ERROR, "Invalid JSON");
      }
      // 2025-06-18 dropped JSON-RPC batching — reject rather than half-support.
      if (Array.isArray(message)) {
        return rpcError(
          null,
          JSONRPC_INVALID_REQUEST,
          "Batching is not supported",
        );
      }

      return dispatchMcp(config, auth.caller, message).catch(() =>
        rpcError(null, JSONRPC_INVALID_REQUEST, "Internal error"),
      );
    });

  const app = config.serveRootMetadata
    ? base.get(ROOT_METADATA_PATH, metadata)
    : base;

  // Bridge to base Elysia so this plugin's routes (all raw Responses) never
  // inflate a consumer's Eden treaty type — the house pattern for route
  // plugins that expose no typed surface.
  return app as unknown as Elysia;
};
