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

describe("dispatchMcp", () => {
  test("initialize advertises only the configured capabilities", async () => {
    const result = await body(
      await dispatchMcp(baseConfig(), caller, rpc("initialize")),
    );
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
      await dispatchMcp(
        cfg,
        caller,
        rpc("initialize", { protocolVersion: "2024-11-05" }),
      ),
    );
    expect((ok.result as Record<string, unknown>).protocolVersion).toBe(
      "2024-11-05",
    );
    const fallback = await body(
      await dispatchMcp(
        cfg,
        caller,
        rpc("initialize", { protocolVersion: "1999-01-01" }),
      ),
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
          description: "danger",
          handler: () => "ok",
          inputSchema: { type: "object" },
        },
      }),
    });
    const result = await body(
      await dispatchMcp(cfg, caller, rpc("tools/list")),
    );
    const tools = (result.result as Record<string, unknown>).tools as unknown[];
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      annotations: { destructiveHint: true },
      name: "del",
    });
  });

  test("tools/call runs the handler and returns text content", async () => {
    const result = await body(
      await dispatchMcp(
        baseConfig(),
        caller,
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
      await dispatchMcp(cfg, caller, rpc("tools/call", { name: "echo" })),
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
    await dispatchMcp(cfg, caller, rpc("tools/call", { name: "touch" }));
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
      await dispatchMcp(cfg, caller, rpc("tools/call", { name: "boom" })),
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
      await dispatchMcp(
        baseConfig(),
        caller,
        rpc("prompts/get", { name: "x" }),
      ),
    );
    expect((promptResult.error as Record<string, unknown>).code).toBe(-32601);
    const list = await body(
      await dispatchMcp(baseConfig(), caller, rpc("resources/list")),
    );
    expect((list.result as Record<string, unknown>).resources).toEqual([]);
  });

  test("a notification (no id) gets a bare 202 with no body", async () => {
    const response = await dispatchMcp(baseConfig(), caller, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  test("unknown method returns method-not-found", async () => {
    const result = await body(
      await dispatchMcp(baseConfig(), caller, rpc("does/not/exist")),
    );
    expect((result.error as Record<string, unknown>).code).toBe(-32601);
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
      issuer,
      request: requestWith("t"),
      requiredScope: "mcp",
      verify: verify({
        exp: future,
        iss: issuer,
        scope: "openid mcp",
        sub: "u1",
        token_use: "access",
      }),
    });
    expect(result).toEqual({
      payload: {
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
});
