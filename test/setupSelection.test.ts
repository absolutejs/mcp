import { expect, test } from "bun:test";
import {
  createSetupSelectionTools,
  type SetupSelection,
} from "../src/setupSelection";
import { createWorkflowApps } from "../src/workflowApps";
const ctx = {
  caller: {},
  request: new Request("https://test.example"),
  meta: {},
};
test("setup tools keep reads separate from explicit, revision-bound confirmation", async () => {
  let writes = 0;
  let state: SetupSelection = {
    revision: "one",
    selectedId: null,
    options: [{ id: "owned", label: "Owned" }],
  };
  const tools = createSetupSelectionTools({
    read: async () => state,
    confirm: async (request) => {
      if (request.expectedRevision !== state.revision)
        throw Error("Stale revision");
      if (
        request.selectedId !== null &&
        !state.options.some((o) => o.id === request.selectedId)
      )
        throw Error("Foreign selection");
      writes++;
      state = { ...state, revision: "two", selectedId: request.selectedId };
      return state;
    },
  });
  await tools.get_setup_options!.handler({}, ctx);
  await tools.get_setup_options!.handler({}, ctx);
  expect(writes).toBe(0);
  await expect(
    tools.confirm_setup_selection!.handler(
      { expectedRevision: "one", selectedId: "owned", accountId: "other" },
      ctx,
    ),
  ).rejects.toThrow();
  expect(writes).toBe(0);
  const args = { expectedRevision: "one", selectedId: "owned" };
  expect(await tools.confirm_setup_selection!.handler(args, ctx)).toMatchObject(
    { structuredContent: { selectedId: "owned", revision: "two" } },
  );
  await expect(
    tools.confirm_setup_selection!.handler(args, ctx),
  ).rejects.toThrow("Stale");
  expect(writes).toBe(1);
  expect(
    createWorkflowApps().decorateTools(tools).confirm_setup_selection!
      .annotations?.readOnlyHint,
  ).toBe(false);
});
