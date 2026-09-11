import { expect, test } from "bun:test";
import {
  createCheckoutHandoffTool,
  createPurchaseStatusTool,
} from "../src/checkoutTools";
import { evaluateCommerce } from "../src/commerce";
const context = {
  caller: {},
  request: new Request("https://shop.test"),
  meta: {},
};
test("checkout rejects card fields before issuing and cannot bypass host classification", async () => {
  let calls = 0;
  const tool = createCheckoutHandoffTool({
    origin: "https://shop.test",
    issue: async () => {
      calls++;
      return {
        purchaseId: "id",
        url: "https://shop.test/buy#secret",
        expiresAt: "2026-09-12T00:00:00Z",
      };
    },
  });
  await expect(
    tool.handler({ productId: "small", card: "secret" }, context),
  ).rejects.toThrow();
  expect(calls).toBe(0);
  expect(
    evaluateCommerce(tool.commerce!, { profiles: ["chatgpt-plugin"] }).allowed,
  ).toBe(false);
  expect(
    evaluateCommerce(tool.commerce!, { profiles: ["unknown"] }).allowed,
  ).toBe(false);
  expect(
    JSON.stringify(await tool.handler({ productId: "small" }, context)),
  ).toContain("No payment has been made");
  const unsafe = createCheckoutHandoffTool({
    origin: "https://shop.test",
    issue: async () => ({
      purchaseId: "id",
      url: "https://evil.test/buy",
      expiresAt: "2026-09-12T00:00:00Z",
    }),
  });
  await expect(
    unsafe.handler({ productId: "small" }, context),
  ).rejects.toThrow();
});
test("purchase recovery projects public fields and isolates missing purchases", async () => {
  const tool = createPurchaseStatusTool({
    read: async (id) =>
      id === "mine"
        ? {
            purchaseId: id,
            status: "approved",
            creditsGranted: 100,
            customerVaultId: "private",
          }
        : null,
  });
  const result = JSON.stringify(
    await tool.handler({ purchaseId: "mine" }, context),
  );
  expect(result).toContain("approved");
  expect(result).not.toContain("private");
  expect(await tool.handler({ purchaseId: "other" }, context)).toBe(
    "No purchase with that ID exists for this account.",
  );
});
