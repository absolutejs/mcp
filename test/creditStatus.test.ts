import { expect, test } from "bun:test";
import { createCreditBalanceTool } from "../src/creditStatus";
import type { McpToolCallContext } from "../src/types";
const context: McpToolCallContext = {
  canElicit: false,
  canElicitUrl: false,
  elicit: async () => ({ action: "unsupported" }),
};
test("credit status stays account-bound, works at zero, and projects only public fields", async () => {
  const tool = createCreditBalanceTool({
    read: () => ({
      allowance: 100,
      consumed: 100,
      remaining: 0,
      periodEnd: null,
      privateToken: "secret",
    }),
  });
  const result = await tool.handler({ userSub: "another-account" }, context);
  expect(result).toMatchObject({
    structuredContent: { remaining: 0, unit: "service_credits" },
  });
  expect(JSON.stringify(result)).not.toContain("secret");
  expect(tool.commerce?.action).toBe("entitlement_status");
});
test("credit status rejects invalid source accounting", async () => {
  const tool = createCreditBalanceTool({
    read: () => ({
      allowance: 100,
      consumed: 0,
      remaining: NaN,
      periodEnd: null,
    }),
  });
  await expect(tool.handler({}, context)).rejects.toThrow(
    "Credit balance is unavailable",
  );
});
