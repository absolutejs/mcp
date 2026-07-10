// Framework-agnostic entry point. `createMcpHandler(config)` returns a single
// function over web-standard Request/Response — mount it on Bun.serve, a Hono
// route, a Next.js route handler, Cloudflare Workers, or anything that speaks
// fetch. It returns `null` when the request isn't for an MCP route, so you can
// fall through to your own routing.
//
//   const mcp = createMcpHandler(config);
//   Bun.serve({ fetch: async (req) => (await mcp(req)) ?? new Response("Not found", { status: 404 }) });

import { handleMcpRequest } from "./core";
import type { McpServerConfig } from "./types";

export const createMcpHandler =
  <Caller>(config: McpServerConfig<Caller>) =>
  (request: Request): Promise<Response | null> =>
    handleMcpRequest(config, request);
