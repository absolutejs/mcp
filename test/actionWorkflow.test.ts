import { expect, test } from "bun:test";
import {
  createActionWorkflowTools,
  projectActionReview,
  type ActionReview,
} from "../src/actionWorkflow";
import { createWorkflowApps } from "../src/workflowApps";
const ctx = {
  caller: {},
  request: new Request("https://test.example"),
  meta: {},
};
const review: ActionReview = {
  actionId: "one",
  revision: "version-one",
  title: "Email",
  expiresAt: "2099-01-01T00:00:00Z",
  recipients: ["example@example.test"],
  subject: "Subject",
  body: "<script>inert</script>",
  consequence: "Sends email",
};
test("review/status tools project data and never execute during recovery", async () => {
  let writes = 0;
  const tools = createActionWorkflowTools({
    review: async () => ({ ...review, secret: "hidden" }),
    job: async () => ({
      actionId: "one",
      status: "unknown",
      title: "Email",
      summary: "Reconcile",
      secret: "hidden",
    }),
    confirm: async () => {
      writes++;
      return {
        actionId: "one",
        status: "queued",
        title: "Email",
        summary: "Queued",
      };
    },
  });
  expect(
    JSON.stringify(
      await tools.get_action_review!.handler({ actionId: "one" }, ctx),
    ),
  ).not.toContain("hidden");
  await tools.get_action_job!.handler({ actionId: "one" }, ctx);
  await tools.resume_action_job!.handler({ actionId: "one" }, ctx);
  expect(writes).toBe(0);
  await expect(
    tools.confirm_action_review!.handler(
      { actionId: "one", expectedRevision: "version-one", accountId: "other" },
      ctx,
    ),
  ).rejects.toThrow();
  await expect(
    tools.get_action_review!.handler(
      { actionId: "one", userSub: "other" },
      ctx,
    ),
  ).rejects.toThrow();
  expect(writes).toBe(0);
  await tools.confirm_action_review!.handler(
    { actionId: "one", expectedRevision: "version-one" },
    ctx,
  );
  expect(writes).toBe(1);
  const decorated = createWorkflowApps().decorateTools(tools);
  expect(decorated.confirm_action_review!.annotations?.readOnlyHint).toBe(
    false,
  );
  expect(decorated.confirm_action_review!.annotations?.openWorldHint).toBe(
    true,
  );
  expect(decorated.resume_action_job!.annotations?.readOnlyHint).toBe(true);
  expect(
    createActionWorkflowTools({
      review: async () => review,
      job: async () => ({
        actionId: "one",
        status: "unknown",
        title: "Email",
        summary: "Reconcile",
      }),
    }).confirm_action_review,
  ).toBeUndefined();
  expect(() => projectActionReview({ ...review, expiresAt: "bad" })).toThrow();
});
test("adapters cannot substitute another action identity", async () => {
  const tools = createActionWorkflowTools({
    review: async () => review,
    job: async () => ({
      actionId: "other",
      status: "succeeded",
      title: "Email",
      summary: "Done",
    }),
  });
  await expect(
    tools.get_action_review!.handler({ actionId: "other" }, ctx),
  ).rejects.toThrow("identity");
  await expect(
    tools.resume_action_job!.handler({ actionId: "one" }, ctx),
  ).rejects.toThrow("identity");
});

test("read-only adapters cannot advertise approval even if their review asks for it", async () => {
  const tools = createActionWorkflowTools({
    review: async () => ({ ...review, canConfirm: true }),
    job: async () => ({
      actionId: "one",
      status: "unknown",
      title: "Email",
      summary: "Reconcile",
    }),
  });
  expect(
    await tools.get_action_review!.handler({ actionId: "one" }, ctx),
  ).toMatchObject({ structuredContent: { canConfirm: false } });
  expect(tools.confirm_action_review).toBeUndefined();
});
