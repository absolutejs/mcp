import { expect, test } from "bun:test";
import {
  createBillingReportTools,
  createBillingManagementTool,
} from "../src/billingTools";
import { evaluateCommerce } from "../src/commerce";
const context = {
  caller: {},
  request: new Request("https://service.test"),
  meta: {},
};
test("billing readers reject account overrides before calling account-bound readers", async () => {
  let reads = 0;
  const tools = createBillingReportTools({
    status: async () => {
      reads++;
      return {
        portalAccess: false,
        subscription: null,
        credits: {
          remaining: 0,
          reserved: 0,
          purchased: 0,
          promotional: 0,
          debt: 0,
        },
        automaticRefill: false,
      };
    },
    receipts: async () => {
      reads++;
      return { receipts: [], nextCursor: null };
    },
    usage: async (range) => {
      reads++;
      return {
        ...range,
        creditsConsumed: 0,
        events: 0,
        byDay: [],
        byFeature: [],
      };
    },
  });
  for (const tool of Object.values(tools)) {
    await expect(
      tool.handler({ accountId: "other" }, context),
    ).rejects.toThrow();
    expect(
      evaluateCommerce(tool.commerce!, { profiles: ["unknown"] }).allowed,
    ).toBe(true);
  }
  expect(reads).toBe(0);
  expect(
    JSON.stringify(await tools.get_billing_status!.handler({}, context)),
  ).toContain('"remaining":0');
  await expect(
    tools.get_usage_report!.handler(
      { from: "2026-01-01", to: "2026-09-01" },
      context,
    ),
  ).rejects.toThrow();
  expect(reads).toBe(1);
});
test("management links do not bypass digital-commerce policy or grant authentication", async () => {
  const tool = createBillingManagementTool("https://service.test/billing");
  expect(
    evaluateCommerce(tool.commerce, { profiles: ["chatgpt-plugin"] }).allowed,
  ).toBe(false);
  expect(
    evaluateCommerce(tool.commerce, { profiles: ["unknown"] }).allowed,
  ).toBe(false);
  expect(JSON.stringify(await tool.handler({}))).toContain(
    '"requiresBrowserAuthentication":true',
  );
  for (const url of [
    "http://service.test/billing",
    "https://secret@service.test/billing",
    "https://service.test/billing#secret",
    "https://service.test/billing?token=secret",
  ])
    expect(() => createBillingManagementTool(url)).toThrow();
});
