import { expect, test } from "bun:test";
import { createWorkflowTools } from "../src/workflowTools";
import { createWorkflowApps } from "../src/workflowApps";
const context = {
  caller: {},
  request: new Request("https://example.test"),
  meta: {},
};
test("workflow readers reject identity overrides and unsupported requests before reads", async () => {
  let reads = 0;
  const tools = createWorkflowTools({
    operations: ["read_business"],
    setup: async () => {
      reads++;
      return {
        business: null,
        businessCount: 0,
        availableCredits: 0,
        portalAccess: false,
      };
    },
    preview: async (request) => {
      reads++;
      return {
        ...request,
        summary: "Read business",
        availableCredits: 0,
        eligible: false,
        reason: "No credits",
      };
    },
  });
  for (const args of [{ accountId: "other" }, { profileId: "other" }])
    await expect(
      tools.get_setup_status!.handler(args, context),
    ).rejects.toThrow();
  for (const args of [
    { operation: "send", maxCredits: 1 },
    { operation: "read_business", maxCredits: 0 },
    { operation: "read_business", maxCredits: 1, accountId: "other" },
    { operation: "read_business", maxCredits: 1.5 },
  ])
    await expect(
      tools.preview_credit_work!.handler(args, context),
    ).rejects.toThrow();
  expect(reads).toBe(0);
  const setup = await tools.get_setup_status!.handler({}, context);
  expect(setup).toMatchObject({
    structuredContent: { availableCredits: 0, portalAccess: false },
  });
  const args = { operation: "read_business", maxCredits: 1 };
  const first = await tools.preview_credit_work!.handler(args, context);
  expect(await tools.preview_credit_work!.handler(args, context)).toEqual(
    first,
  );
  expect(first).toMatchObject({ structuredContent: { eligible: false } });
  expect(JSON.stringify(first)).toContain(
    "No credits reserved; no work started",
  );
});
test("projection omits private callback fields and rejects mismatched preview", async () => {
  const tools = createWorkflowTools({
    operations: ["read_business"],
    setup: async () => ({
      business: "<script>example</script>",
      businessCount: 1,
      availableCredits: 3,
      portalAccess: false,
      secret: "private",
    }),
    preview: async (request) => ({
      ...request,
      operation: "send",
      summary: "Wrong",
      availableCredits: 3,
      eligible: true,
      reason: "",
    }),
  });
  expect(
    JSON.stringify(await tools.get_setup_status!.handler({}, context)),
  ).not.toContain("private");
  await expect(
    tools.preview_credit_work!.handler(
      { operation: "read_business", maxCredits: 1 },
      context,
    ),
  ).rejects.toThrow("does not match");
  const apps = createWorkflowApps();
  expect(Object.keys(apps.resources)).toHaveLength(4);
  expect(apps.decorateTools(tools).get_setup_status!.ui?.resourceUri).toBe(
    "ui://absolute-workflow/setup.html",
  );
  expect(() =>
    apps.decorateTools({
      get_setup_status: {
        ...tools.get_setup_status!,
        annotations: { readOnlyHint: false },
      },
    }),
  ).toThrow();
});
