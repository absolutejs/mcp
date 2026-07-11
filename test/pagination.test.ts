import { describe, expect, test } from "bun:test";
import { createMcpClient } from "../src/client";
import { dispatchMcp } from "../src/dispatch";
import { createMcpHandler } from "../src/handler";
import type { McpServerConfig, McpToolRegistry } from "../src/types";

type Caller = { id: string };
const caller: Caller = { id: "u1" };

const TOOL_COUNT = 12;
const manyTools = () => {
  const registry: McpToolRegistry = {};
  for (let index = 0; index < TOOL_COUNT; index += 1) {
    registry[`tool_${String(index).padStart(2, "0")}`] = {
      description: `tool ${index}`,
      handler: () => "ok",
      inputSchema: { type: "object" },
    };
  }

  return registry;
};

const config = (pageSize: number): McpServerConfig<Caller> => ({
  authorize: async () => ({ caller, ok: true }),
  issuer: "https://example.test",
  listPageSize: pageSize,
  path: "/mcp",
  serverInfo: { name: "pager", version: "1.0.0" },
  tools: manyTools,
});

const body = async (response: Response) =>
  JSON.parse(await response.text()) as Record<string, unknown>;

const listPage = async (cfg: McpServerConfig<Caller>, cursor?: string) =>
  body(
    await dispatchMcp(cfg, caller, [], {
      id: 1,
      jsonrpc: "2.0",
      method: "tools/list",
      ...(cursor === undefined ? {} : { params: { cursor } }),
    }),
  );

describe("list pagination", () => {
  test("first page carries nextCursor; the last page omits it", async () => {
    const cfg = config(5);
    const first = await listPage(cfg);
    const firstResult = first.result as Record<string, unknown>;
    expect((firstResult.tools as unknown[]).length).toBe(5);
    expect(typeof firstResult.nextCursor).toBe("string");

    const second = await listPage(
      cfg,
      String((firstResult as { nextCursor: string }).nextCursor),
    );
    const secondResult = second.result as Record<string, unknown>;
    expect((secondResult.tools as unknown[]).length).toBe(5);

    const third = await listPage(
      cfg,
      String((secondResult as { nextCursor: string }).nextCursor),
    );
    const thirdResult = third.result as Record<string, unknown>;
    expect((thirdResult.tools as unknown[]).length).toBe(2);
    expect(thirdResult.nextCursor).toBeUndefined();
  });

  test("pages never overlap and cover every tool exactly once", async () => {
    const cfg = config(5);
    const names: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await listPage(cfg, cursor);
      const result = page.result as {
        nextCursor?: string;
        tools: { name: string }[];
      };
      names.push(...result.tools.map((tool) => tool.name));
      if (result.nextCursor === undefined) break;
      cursor = result.nextCursor;
    }
    expect(names.length).toBe(TOOL_COUNT);
    expect(new Set(names).size).toBe(TOOL_COUNT);
  });

  test("a malformed cursor falls back to page zero, not an error", async () => {
    const page = await listPage(config(5), "not-base64!!");
    const result = page.result as { tools: { name: string }[] };
    expect(result.tools[0]?.name).toBe("tool_00");
  });

  test("the client transparently follows cursors to the full list", async () => {
    const handler = createMcpHandler(config(5));
    const clientFetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request =
        input instanceof Request ? input : new Request(input, init);

      return (await handler(request)) ?? new Response("nf", { status: 404 });
    }) as typeof fetch;
    const client = createMcpClient({
      request: clientFetch,
      url: "https://example.test/mcp",
    });
    const tools = await client.listTools();
    expect(tools.length).toBe(TOOL_COUNT);
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(TOOL_COUNT);
  });
});
