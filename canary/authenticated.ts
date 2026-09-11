/** Authenticated staging checks. Tokens/results remain in memory and are never logged. */
import type { McpToolResult } from "@absolutejs/mcp";
export type AuthenticatedCanaryOptions = {
  url: string;
  accounts: readonly [string, string];
  tool: { name: string; arguments?: Record<string, unknown> };
  /** Select stable account-owned data, excluding timestamps and shared metadata. */
  fingerprint: (result: McpToolResult) => string;
  request?: typeof fetch;
};
export const runAuthenticatedCanary = async (
  options: AuthenticatedCanaryOptions,
) => {
  const url = new URL(options.url);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    )
  )
    throw Error("HTTPS required outside loopback");
  if (
    !options.accounts[0] ||
    !options.accounts[1] ||
    options.accounts[0] === options.accounts[1]
  )
    throw Error("Two distinct credentials required");
  const request = options.request ?? fetch;
  const checks: { name: string; passed: boolean }[] = [];
  const sessions: { token: string; id: string; protocol: string }[] = [];
  const send = async (
    token: string | null,
    session: (typeof sessions)[number] | undefined,
    method: string,
    params: unknown = {},
  ) =>
    request(options.url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(session
          ? {
              "mcp-session-id": session.id,
              "mcp-protocol-version": session.protocol,
            }
          : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  const body = async (response: Response) => {
    if (
      !response.ok ||
      !response.headers.get("content-type")?.includes("application/json")
    )
      throw Error("Canary requires successful JSON responses");
    const value = await response.json();
    if (value.error || !value.result || value.result.isError)
      throw Error("Canary RPC failed");
    return value.result;
  };
  const initialize = async (token: string) => {
    const response = await send(token, undefined, "initialize", {
      protocolVersion: "2025-11-25",
      clientInfo: { name: "absolute-authenticated-canary", version: "1" },
      capabilities: {
        elicitation: {},
        extensions: {
          "io.modelcontextprotocol/ui": {
            mimeTypes: ["text/html;profile=mcp-app"],
          },
        },
      },
    });
    const result = await body(response);
    const id = response.headers.get("mcp-session-id");
    if (!id || typeof result.protocolVersion !== "string")
      throw Error("Stateful MCP session required");
    const session = { token, id, protocol: result.protocolVersion };
    sessions.push(session);
    await request(options.url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "mcp-session-id": id,
        "mcp-protocol-version": session.protocol,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
    return session;
  };
  const drop = (session: (typeof sessions)[number], authorized = true) =>
    request(options.url, {
      method: "DELETE",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        "mcp-session-id": session.id,
        "mcp-protocol-version": session.protocol,
        ...(authorized ? { authorization: `Bearer ${session.token}` } : {}),
      },
    });
  const read = async (token: string, session: (typeof sessions)[number]) =>
    options.fingerprint(
      await body(await send(token, session, "tools/call", options.tool)),
    );
  try {
    const a = await initialize(options.accounts[0]);
    const b = await initialize(options.accounts[1]);
    for (const session of [a, b]) {
      const discovery = await body(
        await send(session.token, session, "tools/list"),
      );
      if (
        !discovery.tools?.some(
          (tool: { name: string; annotations?: { readOnlyHint?: boolean } }) =>
            tool.name === options.tool.name &&
            tool.annotations?.readOnlyHint === true,
        )
      )
        throw Error("Explicitly read-only tool required for both accounts");
    }
    const first = await read(a.token, a);
    const second = await read(b.token, b);
    if (!first || !second || first === second)
      throw Error(
        "Distinct stable account-owned results required; isolation is inconclusive",
      );
    checks.push({ name: "distinct-account-results", passed: true });
    for (const [session, expected] of [
      [a, first],
      [b, second],
    ] as const)
      checks.push({
        name: "stable-account-result",
        passed: (await read(session.token, session)) === expected,
      });
    for (const [token, session, expected] of [
      [b.token, a, second],
      [a.token, b, first],
    ] as const) {
      const response = await send(token, session, "tools/call", options.tool);
      // Binding a session to its owner is also safe; otherwise current credentials must select the data.
      checks.push({
        name: "cross-session-account-isolation",
        passed:
          [401, 403, 404].includes(response.status) ||
          options.fingerprint(await body(response)) === expected,
      });
    }
    for (const token of [null, "invalid-canary-credential"])
      checks.push({
        name: "invalid-credential-rejected",
        passed: (await send(token, a, "tools/list")).status === 401,
      });
    checks.push({
      name: "unauthenticated-delete-rejected",
      passed: (await drop(a, false)).status === 401,
    });
    checks.push({
      name: "session-survives-rejected-delete",
      passed: (await send(a.token, a, "tools/list")).status === 200,
    });
    const deletion = await drop(b);
    checks.push({
      name: "own-session-deletion",
      passed: deletion.status === 204,
    });
    checks.push({
      name: "terminated-session-404",
      passed: (await send(b.token, b, "tools/list")).status === 404,
    });
    const fresh = await initialize(b.token);
    checks.push({
      name: "fresh-session-read",
      passed: fresh.id !== b.id && (await read(b.token, fresh)) === second,
    });
    return { passed: checks.every((check) => check.passed), checks };
  } finally {
    for (const session of sessions) await drop(session).catch(() => undefined);
  }
};
