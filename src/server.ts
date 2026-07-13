// The Elysia plugin. A thin wrapper over the transport-agnostic core: it
// registers the endpoint + discovery routes and delegates each to the shared
// implementation, so the Elysia and raw-handler paths can never diverge.
// Returns a base-typed Elysia so this plugin's routes (all raw Responses) never
// inflate a consumer's Eden treaty type.

import { Elysia } from "elysia";
import {
  metadataResponse,
  primeMcpSessions,
  ROOT_METADATA_PATH,
  runMcpDelete,
  runMcpPost,
} from "./core";
import { HTTP_METHOD_NOT_ALLOWED } from "./jsonrpc";
import { metadataPathFor } from "./metadata";
import type { McpServerConfig } from "./types";

/** Build the MCP endpoint as an Elysia plugin. Mount it with `.use(...)`.
 *
 *  Serves:
 *   - `POST <path>`   — the JSON-RPC endpoint (streamable HTTP; answers with a
 *     plain JSON body, or an SSE stream when a tool may elicit)
 *   - `GET  <path>`   — 405 (no standalone server-initiated stream)
 *   - `DELETE <path>` — end an elicitation session (405 when sessionless)
 *   - `GET  /.well-known/oauth-protected-resource<path>` — RFC 9728 metadata
 *   - `GET  /.well-known/oauth-protected-resource` — the same, if
 *     `serveRootMetadata` is set (only one endpoint per app should). */
export const mcpServer = <Caller>(config: McpServerConfig<Caller>) => {
  const metadataPath = metadataPathFor(config.path);
  // Subscribe to the elicitation bus at mount time, not on the first request.
  primeMcpSessions(config);

  const base = new Elysia()
    .get(metadataPath, () => metadataResponse(config))
    .get(
      config.path,
      () => new Response(null, { status: HTTP_METHOD_NOT_ALLOWED }),
    )
    // Elysia has already parsed the JSON body (no schema → unknown).
    .post(config.path, ({ body, request }) => runMcpPost(config, request, body))
    // Ending a session (only sessionful when elicitation is on; 405 otherwise).
    .delete(config.path, ({ request }) => runMcpDelete(config, request));

  const app = config.serveRootMetadata
    ? base.get(ROOT_METADATA_PATH, () => metadataResponse(config))
    : base;

  // Bridge to base Elysia so this plugin's routes (all raw Responses) never
  // inflate a consumer's Eden treaty type — the house pattern for route
  // plugins that expose no typed surface.
  return app as unknown as Elysia;
};
