import { describe, expect, test } from "bun:test";
import { createCheckoutCanary } from "../canary/checkout";
const origin = "https://checkout.example.test";
const call = async (
  fixture: ReturnType<typeof createCheckoutCanary>,
  name: string,
  args: object,
) => {
  const response = await fixture.mcp(
    new Request("http://127.0.0.1:4428/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  );
  return (await response!.json()).result;
};
const state = (
  fixture: ReturnType<typeof createCheckoutCanary>,
  capability: string,
  action = "read",
  requestOrigin = origin,
) =>
  fixture.checkout(
    new Request(`${origin}/state`, {
      method: "POST",
      headers: { origin: requestOrigin, "content-type": "application/json" },
      body: JSON.stringify({ capability, action }),
    }),
  );
describe("synthetic host checkout canary", () => {
  test("opening and reading never approve; explicit approval is idempotent", async () => {
    const fixture = createCheckoutCanary(origin);
    const issued = (
      await call(fixture, "prepare_test_checkout", {
        productId: "synthetic-1000",
      })
    ).structuredContent;
    const capability = new URL(issued.url).hash.slice(1);
    expect((await fixture.checkout(new Request(issued.url))).status).toBe(200);
    expect((await (await state(fixture, capability)).json()).approved).toBe(
      false,
    );
    expect(
      (
        await call(fixture, "get_test_purchase_status", {
          purchaseId: issued.purchaseId,
        })
      ).structuredContent.creditsGranted,
    ).toBe(0);
    for (let i = 0; i < 2; i++)
      expect((await state(fixture, capability, "approve")).status).toBe(200);
    expect(
      (
        await call(fixture, "get_test_purchase_status", {
          purchaseId: issued.purchaseId,
        })
      ).structuredContent,
    ).toEqual({
      purchaseId: issued.purchaseId,
      status: "approved",
      creditsGranted: 1000,
    });
  });
  test("rejects wrong origin, capability and expired link without approval", async () => {
    let now = Date.now();
    const fixture = createCheckoutCanary(origin, () => now);
    const issued = (
      await call(fixture, "prepare_test_checkout", {
        productId: "synthetic-1000",
      })
    ).structuredContent;
    const capability = new URL(issued.url).hash.slice(1);
    expect(
      (await state(fixture, capability, "approve", "https://wrong.example"))
        .status,
    ).toBe(403);
    expect(
      (await state(fixture, `${issued.purchaseId}/wrong`, "approve")).status,
    ).toBe(404);
    now += 15 * 60_000;
    expect((await state(fixture, capability, "approve")).status).toBe(404);
    expect(
      (
        await call(fixture, "get_test_purchase_status", {
          purchaseId: issued.purchaseId,
        })
      ).structuredContent.creditsGranted,
    ).toBe(0);
    expect((await fixture.checkout(new Request(`${origin}/mcp`))).status).toBe(
      404,
    );
  });
  test("only accepts an exact HTTPS origin", () => {
    for (const url of [
      "http://localhost:4438",
      "https://example.test/path",
      "https://user:password@example.test",
    ])
      expect(() => createCheckoutCanary(url)).toThrow();
  });
});
