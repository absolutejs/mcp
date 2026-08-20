import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { mcpServer } from "../src/server";
import type { McpServerConfig } from "../src/types";

const config: McpServerConfig<{ id: string }> = {
  authorize: async (request) =>
    request.headers.get("authorization") === "Bearer good"
      ? { caller: { id: "user-1" }, ok: true, scopes: ["mcp"] }
      : { ok: false, reason: "bad token" },
  issuer: "https://example.test",
  path: "/mcp",
  serverInfo: { name: "elysia-v2-test", version: "1.0.0" },
  tools: () => ({
    ping: {
      description: "Return pong",
      handler: () => "pong",
      inputSchema: { type: "object" },
    },
  }),
};

describe("Elysia 2 plugin composition", () => {
  const app = new Elysia().use(mcpServer(config));

  test("serves discovery and an authorized JSON-RPC call", async () => {
    const metadata = await app.handle(
      new Request(
        "https://example.test/.well-known/oauth-protected-resource/mcp",
      ),
    );
    expect(metadata.status).toBe(200);

    const response = await app.handle(
      new Request("https://example.test/mcp", {
        body: JSON.stringify({
          id: 1,
          jsonrpc: "2.0",
          method: "tools/call",
          params: { arguments: {}, name: "ping" },
        }),
        headers: {
          authorization: "Bearer good",
          "content-type": "application/json",
          "mcp-protocol-version": "2025-11-25",
        },
        method: "POST",
      }),
    );
    const payload = (await response.json()) as {
      result: { content: Array<{ text: string }> };
    };
    expect(response.status).toBe(200);
    expect(payload.result.content[0]?.text).toBe("pong");
  });
});
