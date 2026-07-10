// The Elysia plugin. A thin wrapper over the transport-agnostic core: it
// registers the endpoint + discovery routes and delegates each to the shared
// implementation, so the Elysia and raw-handler paths can never diverge.
// Returns a base-typed Elysia so this plugin's routes (all raw Responses) never
// inflate a consumer's Eden treaty type.

import { Elysia } from "elysia";
import { metadataResponse, ROOT_METADATA_PATH, runMcpPost } from "./core";
import { HTTP_METHOD_NOT_ALLOWED } from "./jsonrpc";
import { metadataPathFor } from "./metadata";
import type { McpServerConfig } from "./types";

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

  const base = new Elysia()
    .get(metadataPath, () => metadataResponse(config))
    .get(
      config.path,
      () => new Response(null, { status: HTTP_METHOD_NOT_ALLOWED }),
    )
    // Elysia has already parsed the JSON body (no schema → unknown).
    .post(config.path, ({ body, request }) =>
      runMcpPost(config, request, body),
    );

  const app = config.serveRootMetadata
    ? base.get(ROOT_METADATA_PATH, () => metadataResponse(config))
    : base;

  // Bridge to base Elysia so this plugin's routes (all raw Responses) never
  // inflate a consumer's Eden treaty type — the house pattern for route
  // plugins that expose no typed surface.
  return app as unknown as Elysia;
};
