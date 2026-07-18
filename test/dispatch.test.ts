import { describe, expect, test } from "bun:test";
import { dispatchMcp } from "../src/dispatch";
import { verifyBearer } from "../src/auth";
import type { McpServerConfig } from "../src/types";

type Caller = { id: string };

const body = async (response: Response) =>
  JSON.parse(await response.text()) as Record<string, unknown>;

const baseConfig = (
  over: Partial<McpServerConfig<Caller>> = {},
): McpServerConfig<Caller> => ({
  authorize: async () => ({ caller: { id: "u1" }, ok: true }),
  issuer: "https://example.test",
  path: "/mcp",
  serverInfo: { name: "test", version: "0.0.0" },
  tools: () => ({
    echo: {
      description: "echo the input",
      handler: (args) => `echoed ${JSON.stringify(args)}`,
      inputSchema: { type: "object" },
    },
  }),
  ...over,
});

const rpc = (method: string, params?: unknown, id: number | string = 1) => ({
  id,
  jsonrpc: "2.0" as const,
  method,
  ...(params === undefined ? {} : { params }),
});

const caller: Caller = { id: "u1" };
const run = (
  config: McpServerConfig<Caller>,
  message: unknown,
  scopes: string[] = [],
) => dispatchMcp(config, caller, scopes, message);

describe("dispatchMcp", () => {
  test("initialize advertises only the configured capabilities", async () => {
    const result = await body(await run(baseConfig(), rpc("initialize")));
    const capabilities = (result.result as Record<string, unknown>)
      .capabilities as Record<string, unknown>;
    expect(capabilities.tools).toBeDefined();
    expect(capabilities.prompts).toBeUndefined();
    expect(capabilities.resources).toBeUndefined();
  });

  test("initialize negotiates a supported protocol, else the preferred one", async () => {
    const cfg = baseConfig({
      supportedProtocols: ["2025-06-18", "2024-11-05"],
    });
    const ok = await body(
      await run(cfg, rpc("initialize", { protocolVersion: "2024-11-05" })),
    );
    expect((ok.result as Record<string, unknown>).protocolVersion).toBe(
      "2024-11-05",
    );
    const fallback = await body(
      await run(cfg, rpc("initialize", { protocolVersion: "1999-01-01" })),
    );
    expect((fallback.result as Record<string, unknown>).protocolVersion).toBe(
      "2025-06-18",
    );
  });

  test("tools/list returns the registry with annotations", async () => {
    const cfg = baseConfig({
      tools: () => ({
        del: {
          annotations: { destructiveHint: true },
          coaz: true,
          description: "danger",
          handler: () => "ok",
          inputSchema: {
            type: "object",
            "x-coaz-mapping": {
              subject: [{ id: "caller.id" }],
              resource: [{ id: "arguments.id" }],
              context: [{ source: "'mcp'" }],
            },
          },
        },
      }),
    });
    const result = await body(await run(cfg, rpc("tools/list")));
    const tools = (result.result as Record<string, unknown>).tools as unknown[];
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      annotations: { destructiveHint: true },
      coaz: true,
      name: "del",
    });
  });

  test("tools/call runs the handler and returns text content", async () => {
    const result = await body(
      await run(
        baseConfig(),
        rpc("tools/call", { arguments: { a: 1 }, name: "echo" }),
      ),
    );
    const payload = result.result as Record<string, unknown>;
    expect(payload.isError).toBe(false);
    expect((payload.content as { text: string }[])[0]?.text).toContain(
      "echoed",
    );
  });

  test("beforeCall can block a call as an isError result, skipping the handler", async () => {
    let ran = false;
    const cfg = baseConfig({
      beforeCall: () => ({ block: "no credits" }),
      tools: () => ({
        echo: {
          description: "echo",
          handler: () => {
            ran = true;

            return "ran";
          },
          inputSchema: { type: "object" },
        },
      }),
    });
    const result = await body(
      await run(cfg, rpc("tools/call", { name: "echo" })),
    );
    const payload = result.result as Record<string, unknown>;
    expect(payload.isError).toBe(true);
    expect((payload.content as { text: string }[])[0]?.text).toBe("no credits");
    expect(ran).toBe(false);
  });

  test("onCall sees the meta a tool handler wrote during the call", async () => {
    const records: { ok: boolean; touched: unknown }[] = [];
    const cfg = baseConfig({
      onCall: ({ meta, ok }) => {
        records.push({ ok, touched: meta.touched });
      },
      tools: ({ meta }) => ({
        touch: {
          description: "touch",
          handler: () => {
            meta.touched = "member-42";

            return "done";
          },
          inputSchema: { type: "object" },
        },
      }),
    });
    await run(cfg, rpc("tools/call", { name: "touch" }));
    expect(records).toEqual([{ ok: true, touched: "member-42" }]);
  });

  test("a throwing handler is reported as isError and still audited", async () => {
    const records: boolean[] = [];
    const cfg = baseConfig({
      onCall: ({ ok }) => {
        records.push(ok);
      },
      tools: () => ({
        boom: {
          description: "boom",
          handler: () => {
            throw new Error("kaboom");
          },
          inputSchema: { type: "object" },
        },
      }),
    });
    const result = await body(
      await run(cfg, rpc("tools/call", { name: "boom" })),
    );
    const payload = result.result as Record<string, unknown>;
    expect(payload.isError).toBe(true);
    expect((payload.content as { text: string }[])[0]?.text).toContain(
      "kaboom",
    );
    expect(records).toEqual([false]);
  });

  test("prompts and resources are refused when not configured", async () => {
    const promptResult = await body(
      await run(baseConfig(), rpc("prompts/get", { name: "x" })),
    );
    expect((promptResult.error as Record<string, unknown>).code).toBe(-32601);
    const list = await body(await run(baseConfig(), rpc("resources/list")));
    expect((list.result as Record<string, unknown>).resources).toEqual([]);
  });

  test("a notification (no id) gets a bare 202 with no body", async () => {
    const response = await run(baseConfig(), {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  test("unknown method returns method-not-found", async () => {
    const result = await body(await run(baseConfig(), rpc("does/not/exist")));
    expect((result.error as Record<string, unknown>).code).toBe(-32601);
  });
});

describe("per-tool scope gating", () => {
  const cfg = baseConfig({
    tools: () => ({
      admin_wipe: {
        description: "scoped",
        handler: () => "wiped",
        inputSchema: { type: "object" },
        scope: "admin",
      },
      read_status: {
        description: "open",
        handler: () => "ok",
        inputSchema: { type: "object" },
      },
    }),
  });

  test("tools/list hides scoped tools the caller can't reach", async () => {
    const withoutScope = await body(await run(cfg, rpc("tools/list"), []));
    const names = (
      (withoutScope.result as Record<string, unknown>).tools as {
        name: string;
      }[]
    ).map((tool) => tool.name);
    expect(names).toEqual(["read_status"]);

    const withScope = await body(await run(cfg, rpc("tools/list"), ["admin"]));
    const scopedNames = (
      (withScope.result as Record<string, unknown>).tools as { name: string }[]
    ).map((tool) => tool.name);
    expect(scopedNames.sort()).toEqual(["admin_wipe", "read_status"]);
  });

  test("tools/call on a hidden scoped tool reports it as unknown", async () => {
    const denied = await body(
      await run(cfg, rpc("tools/call", { name: "admin_wipe" }), []),
    );
    expect((denied.error as Record<string, unknown>).message).toContain(
      "Unknown tool",
    );

    const allowed = await body(
      await run(cfg, rpc("tools/call", { name: "admin_wipe" }), ["admin"]),
    );
    expect((allowed.result as Record<string, unknown>).isError).toBe(false);
  });
});

describe("rich tool results", () => {
  test("a content array is passed through verbatim", async () => {
    const cfg = baseConfig({
      tools: () => ({
        shot: {
          description: "image",
          handler: () => [
            { data: "abc", mimeType: "image/png", type: "image" },
          ],
          inputSchema: { type: "object" },
        },
      }),
    });
    const result = await body(
      await run(cfg, rpc("tools/call", { name: "shot" })),
    );
    const payload = result.result as Record<string, unknown>;
    expect(payload.isError).toBe(false);
    expect((payload.content as { type: string }[])[0]?.type).toBe("image");
  });

  test("a full result object carries structuredContent and isError through", async () => {
    const cfg = baseConfig({
      tools: () => ({
        data: {
          description: "structured",
          handler: () => ({
            content: [{ text: "see structured", type: "text" as const }],
            structuredContent: { count: 3 },
          }),
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
        },
      }),
    });
    const list = await body(await run(cfg, rpc("tools/list")));
    expect(
      (
        (list.result as Record<string, unknown>).tools as {
          outputSchema: unknown;
        }[]
      )[0]?.outputSchema,
    ).toEqual({ type: "object" });
    const call = await body(
      await run(cfg, rpc("tools/call", { name: "data" })),
    );
    const payload = call.result as Record<string, unknown>;
    expect(payload.structuredContent).toEqual({ count: 3 });
    expect(payload.isError).toBe(false);
  });
});

describe("verifyBearer", () => {
  const issuer = "https://example.test";
  const future = Math.floor(Date.now() / 1000) + 3600;
  const requestWith = (token: string) =>
    new Request("https://example.test/mcp", {
      headers: { authorization: `Bearer ${token}` },
      method: "POST",
    });
  const verify = (payload: Record<string, unknown>) => () => ({ payload });

  test("accepts a well-formed access token and parses scopes + subject", async () => {
    const result = await verifyBearer({
      audience: `${issuer}/mcp`,
      issuer,
      request: requestWith("t"),
      requiredScope: "mcp",
      verify: verify({
        aud: ["https://other.test", `${issuer}/mcp`],
        exp: future,
        iss: issuer,
        scope: "openid mcp",
        sub: "u1",
        token_use: "access",
      }),
    });
    expect(result).toEqual({
      payload: {
        aud: ["https://other.test", `${issuer}/mcp`],
        exp: future,
        iss: issuer,
        scope: "openid mcp",
        sub: "u1",
        token_use: "access",
      },
      scopes: ["openid", "mcp"],
      subject: "u1",
    });
  });

  test("rejects a missing bearer header", async () => {
    const result = await verifyBearer({
      issuer,
      request: new Request("https://example.test/mcp", { method: "POST" }),
      verify: verify({}),
    });
    expect(result).toEqual({ error: "Missing bearer token" });
  });

  test("rejects an invalid signature", async () => {
    const result = await verifyBearer({
      issuer,
      request: requestWith("t"),
      verify: () => undefined,
    });
    expect(result).toEqual({ error: "Invalid token" });
  });

  test("rejects the wrong issuer, an expired token, and a missing scope", async () => {
    const wrongIss = await verifyBearer({
      issuer,
      request: requestWith("t"),
      verify: verify({
        exp: future,
        iss: "https://evil.test",
        sub: "u1",
        token_use: "access",
      }),
    });
    expect(wrongIss).toEqual({ error: "Wrong issuer" });

    const expired = await verifyBearer({
      issuer,
      request: requestWith("t"),
      verify: verify({ exp: 1, iss: issuer, sub: "u1", token_use: "access" }),
    });
    expect(expired).toEqual({ error: "Token expired" });

    const noScope = await verifyBearer({
      issuer,
      request: requestWith("t"),
      requiredScope: "mcp:admin",
      verify: verify({
        exp: future,
        iss: issuer,
        scope: "mcp",
        sub: "u1",
        token_use: "access",
      }),
    });
    expect(noScope).toEqual({ error: "Token lacks the mcp:admin scope" });
  });

  test("rejects an access token issued for another protected resource", async () => {
    const result = await verifyBearer({
      audience: `${issuer}/mcp`,
      issuer,
      request: requestWith("t"),
      verify: verify({
        aud: `${issuer}/api`,
        exp: future,
        iss: issuer,
        sub: "u1",
        token_use: "access",
      }),
    });

    expect(result).toEqual({ error: "Wrong audience" });
  });
});
