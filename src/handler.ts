// Framework-agnostic entry point. `createMcpHandler(config)` returns a single
// function over web-standard Request/Response — mount it on Bun.serve, a Hono
// route, a Next.js route handler, Cloudflare Workers, or anything that speaks
// fetch. It returns `null` when the request isn't for an MCP route, so you can
// fall through to your own routing.
//
//   const mcp = createMcpHandler(config);
//   Bun.serve({ fetch: async (req) => (await mcp(req)) ?? new Response("Not found", { status: 404 }) });

import { handleMcpRequest, primeMcpSessions } from "./core";
import type { McpServerConfig } from "./types";

export const createMcpHandler = <Caller>(config: McpServerConfig<Caller>) => {
  // Subscribe to the elicitation bus (if any) NOW: an instance that has served
  // no traffic is exactly the one about to be handed someone else's answer.
  primeMcpSessions(config);

  return (request: Request): Promise<Response | null> =>
    handleMcpRequest(config, request);
};
