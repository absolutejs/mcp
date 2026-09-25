import { expect, test } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalMcpAuthorization } from "../src/local-auth";

test("device approval returns status only; concurrent sessions serialize refresh rotation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-auth-"));
  let refreshes = 0;
  const fetcher = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const body = JSON.parse(String(init?.body));
    if (String(input).endsWith("/device_authorization"))
      return Response.json({
        device_code: "private-device-credential",
        user_code: "ABCD-EFGH",
        verification_uri_complete:
          "https://example.test/oauth/device?user_code=ABCD-EFGH",
        expires_in: 600,
        interval: 5,
      });
    if (body.grant_type === "refresh_token") {
      refreshes++;
      await new Promise((r) => setTimeout(r, 150));
      expect(body.refresh_token).toBe("private-refresh-first");
      return Response.json({
        access_token: "private-access-next",
        refresh_token: "private-refresh-next",
        token_type: "Bearer",
        expires_in: 600,
      });
    }
    return Response.json({
      access_token: "private-access-first",
      refresh_token: "private-refresh-first",
      token_type: "Bearer",
      expires_in: 1,
    });
  }) as typeof fetch;
  const options = {
    issuer: "https://example.test",
    oauthPath: "/oauth",
    clientId: "cli",
    resource: "https://example.test/api",
    scope: "codes",
    directory,
    fetch: fetcher,
  };
  try {
    const one = createLocalMcpAuthorization(options),
      two = createLocalMcpAuthorization(options);
    expect(JSON.stringify(await one.begin())).not.toContain("private-device");
    expect(await one.poll()).toEqual({ state: "connected" });
    const headers = await Promise.all([one.headers(), two.headers()]);
    expect(refreshes).toBe(1);
    expect(headers[0]).toEqual(headers[1]);
    await one.forget();
    await expect(two.headers()).rejects.toThrow("Sign in");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("ambiguous refresh cannot replay an already consumed credential", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-auth-"));
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    join(directory, "tokens.json"),
    JSON.stringify({
      accessToken: "old",
      refreshToken: "private-refresh",
      expiresAt: 0,
    }),
    { mode: 0o600 },
  );
  let calls = 0;
  const client = createLocalMcpAuthorization({
    issuer: "https://example.test",
    oauthPath: "/oauth",
    clientId: "cli",
    resource: "https://example.test/api",
    scope: "codes",
    directory,
    fetch: (async () => {
      calls++;
      throw Error("Network lost");
    }) as typeof fetch,
  });
  try {
    await expect(client.headers()).rejects.toThrow();
    await expect(client.headers()).rejects.toThrow("Sign in");
    expect(calls).toBe(1);
    await expect(readFile(join(directory, "tokens.json"))).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
