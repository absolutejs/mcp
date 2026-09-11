import { expect, test } from "bun:test";
import { createMcpHandler } from "../src/handler";
import { runAuthenticatedCanary } from "../canary/authenticated";
const fixture = (readOnly = true, shared = false, brokenDelete = false) => {
  const handler = createMcpHandler({
    issuer: "https://test.example",
    path: "/mcp",
    serverInfo: { name: "test", version: "1" },
    apps: { resources: {} },
    authorize: async (request) => {
      const token = request.headers.get("authorization");
      return token === "Bearer alice" || token === "Bearer bob"
        ? { ok: true, caller: token.slice(7) }
        : { ok: false, reason: "invalid" };
    },
    tools: ({ caller }) => ({
      report: {
        description: "Account read",
        inputSchema: { type: "object" },
        annotations: { readOnlyHint: readOnly },
        handler: () => (shared ? "same" : caller),
      },
    }),
  });
  let calls = 0;
  const request = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    let req = new Request(input, init);
    if (
      req.method === "POST" &&
      (await req.clone().json()).method === "tools/call"
    )
      calls++;
    if (
      brokenDelete &&
      req.method === "DELETE" &&
      !req.headers.has("authorization")
    ) {
      req = new Request(req);
      req.headers.set("authorization", "Bearer alice");
    }
    return (await handler(req))!;
  }) as typeof fetch;
  return { request, calls: () => calls };
};
const options = {
  url: "https://test.example/mcp",
  accounts: ["alice", "bob"] as const,
  tool: { name: "report" },
  fingerprint: (result: { content: unknown }) => JSON.stringify(result.content),
};
test("authenticated canary proves isolation and reconnect using only its own sessions", async () => {
  const f = fixture();
  const result = await runAuthenticatedCanary({
    ...options,
    request: f.request,
  });
  expect(result.passed).toBe(true);
  expect(result.checks).toHaveLength(12);
  expect(f.calls()).toBe(7);
  expect(JSON.stringify(result)).not.toContain("alice");
  expect(JSON.stringify(result)).not.toContain("bob");
});
test("canary detects unauthenticated session deletion regression", async () => {
  const f = fixture(true, false, true);
  const result = await runAuthenticatedCanary({
    ...options,
    request: f.request,
  });
  expect(result.passed).toBe(false);
  expect(result.checks.filter((c) => !c.passed).map((c) => c.name)).toEqual([
    "unauthenticated-delete-rejected",
    "session-survives-rejected-delete",
  ]);
});
test("canary refuses a tool without explicit read-only annotation before calling it", async () => {
  const f = fixture(false);
  await expect(
    runAuthenticatedCanary({ ...options, request: f.request }),
  ).rejects.toThrow("read-only");
  expect(f.calls()).toBe(0);
});
test("identical account results cannot falsely pass isolation", async () => {
  const f = fixture(true, true);
  await expect(
    runAuthenticatedCanary({ ...options, request: f.request }),
  ).rejects.toThrow("inconclusive");
});
test("canary rejects insecure targets and identical credentials", async () => {
  await expect(
    runAuthenticatedCanary({ ...options, url: "http://test.example/mcp" }),
  ).rejects.toThrow("HTTPS");
  await expect(
    runAuthenticatedCanary({ ...options, accounts: ["same", "same"] }),
  ).rejects.toThrow("distinct credentials");
});
