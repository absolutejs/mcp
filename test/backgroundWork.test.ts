import { expect, test } from "bun:test";
import { createBackgroundWorkTools, createBackgroundWorkResult, type McpBackgroundWorkSnapshot } from "../src/backgroundWork";
const snapshot: McpBackgroundWorkSnapshot = { status: "running", budget: 10, charged: 3, settled: false, totalSteps: 2, results: [{ text: "saved finding", source: "https://example.com" }] };
test("text and structured hosts receive identical progress, results and spend", () => {
  const result = createBackgroundWorkResult("job", { ...snapshot, privateAccount: "secret" } as McpBackgroundWorkSnapshot);
  const content = result.content[0];
  if (content?.type !== "text") throw new Error("Missing text");
  expect(JSON.parse(content.text)).toEqual(result.structuredContent);
  expect(content.text).not.toContain("secret");
  expect(result.structuredContent).toMatchObject({ completedSteps: 1, creditsCharged: 3, results: snapshot.results });
});
test("read-only recovery never calls start and can be offered without a start adapter", async () => {
  let starts = 0;
  const tools = createBackgroundWorkTools({ description: "Research", inputSchema: { type: "object" }, start: async () => { starts++; return snapshot; }, read: async (id) => id === "job" ? snapshot : null });
  // The transport supplies context; these handlers deliberately do not use it.
  const context = {} as Parameters<NonNullable<typeof tools.get_background_work>["handler"]>[1];
  await tools.get_background_work!.handler({ requestId: "job" }, context);
  await tools.get_background_work!.handler({ requestId: "job" }, context);
  expect(starts).toBe(0);
  expect(tools.get_background_work!.annotations?.readOnlyHint).toBe(true);
  expect(tools.start_background_work!.commerce?.action).toBe("paid_access");
  const recovery = createBackgroundWorkTools({ description: "Research", inputSchema: {}, read: async () => null });
  expect(recovery.start_background_work).toBeUndefined();
  const missing = await recovery.get_background_work!.handler({ requestId: "job" }, context);
  expect(missing).toMatchObject({ isError: true });
});
