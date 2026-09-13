import { expect, test } from "bun:test";
import { createCreditWorkResult } from "../src/index";
import { createMcpHandler } from "../src/handler";
const snapshot = {
  budget: 1,
  charged: 0,
  status: "completed" as const,
  result: null as string | null,
};
const parity = (saved: string | null) => {
  const response = createCreditWorkResult("work-1", {
    ...snapshot,
    result: saved,
  });
  const text = response.content[0];
  if (text.type !== "text") throw Error("Expected text");
  expect(JSON.parse(text.text)).toEqual(response.structuredContent);
  return response;
};
test("both host projections expose a saved action ID without replacing billing status", () => {
  const proposal = {
    actionId: "action-1",
    status: "proposed",
    maxCredits: 999,
    requestId: "untrusted",
  };
  expect(parity(JSON.stringify(proposal))).toMatchObject({
    isError: false,
    structuredContent: {
      status: "completed",
      maxCredits: 1,
      requestId: "work-1",
      creditsCharged: 0,
      result: proposal,
    },
  });
});
test("plain text, JSON scalars, arrays and serialized MCP results survive both projections", () => {
  for (const value of [
    "draft",
    "",
    "false",
    "0",
    "null",
    '"quoted"',
    "[1,2]",
    '{"incomplete":',
    JSON.stringify({
      content: [{ type: "text", text: "saved" }],
      structuredContent: { actionId: "a" },
    }),
  ]) {
    const result = parity(value).structuredContent?.result;
    let expected: unknown = value;
    try {
      expected = JSON.parse(value);
    } catch {}
    expect(result).toEqual(expected);
  }
});
test("pending and failed work retain status and recovery instructions without leaking row fields", () => {
  const work = {
    ...snapshot,
    status: "running" as const,
    privateToken: "secret",
    request: "digest",
  };
  const response = createCreditWorkResult("work-1", work);
  expect(response.structuredContent).toMatchObject({
    status: "running",
    result: null,
  });
  expect(response.structuredContent?.message).toContain("do not restart");
  expect(JSON.stringify(response)).not.toContain("secret");
  expect(JSON.stringify(response)).not.toContain("digest");
  parity(null);
  expect(
    createCreditWorkResult("work-1", {
      ...snapshot,
      status: "failed",
      result: "provider unavailable",
    }),
  ).toMatchObject({
    isError: true,
    structuredContent: { status: "failed", result: "provider unavailable" },
  });
});
test("invalid accounting cannot be presented as a valid saved result", () => {
  for (const patch of [
    { budget: -1 },
    { charged: 2 },
    { charged: NaN },
    { budget: Infinity },
    { charged: 0.5 },
  ]) {
    expect(() =>
      createCreditWorkResult("work-1", { ...snapshot, ...patch }),
    ).toThrow("Invalid saved credit work");
  }
  expect(() => createCreditWorkResult("", snapshot)).toThrow();
});
test("wire dispatch preserves the complete result for a structured-only host", async () => {
  const handler = createMcpHandler({
    authorize: async () => ({
      ok: true as const,
      caller: { id: "owner" },
      scopes: ["mcp"],
    }),
    issuer: "https://example.test",
    path: "/mcp",
    scopesSupported: ["mcp"],
    serverInfo: { name: "test", version: "1" },
    tools: () => ({
      saved: {
        description: "Read saved work",
        inputSchema: { type: "object" },
        handler: () =>
          createCreditWorkResult("work-1", {
            ...snapshot,
            result: '{"actionId":"action-1"}',
          }),
      },
    }),
  });
  const response = await handler(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "saved", arguments: {} },
      }),
    }),
  );
  const body = await response!.json();
  expect(body.result.structuredContent.result.actionId).toBe("action-1");
  expect(JSON.parse(body.result.content[0].text)).toEqual(
    body.result.structuredContent,
  );
});
