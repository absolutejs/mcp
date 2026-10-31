import { expect, test } from "bun:test";
import {
  McpFundingRequiredError,
  createBackgroundWorkTools,
  createBackgroundWorkResult,
  type McpBackgroundWorkSnapshot,
} from "../src/backgroundWork";
const snapshot: McpBackgroundWorkSnapshot = {
  status: "running",
  budget: 10,
  charged: 3,
  settled: false,
  totalSteps: 2,
  results: [{ text: "saved finding", source: "https://example.com" }],
};
test("text and structured hosts receive identical progress, results and spend", () => {
  const result = createBackgroundWorkResult("job", {
    ...snapshot,
    privateAccount: "secret",
  } as McpBackgroundWorkSnapshot);
  const content = result.content[0];
  if (content?.type !== "text") throw new Error("Missing text");
  expect(JSON.parse(content.text)).toEqual(result.structuredContent);
  expect(content.text).not.toContain("secret");
  expect(result.structuredContent).toMatchObject({
    completedSteps: 1,
    results: snapshot.results,
  });
});
test("read-only recovery never calls start and can be offered without a start adapter", async () => {
  let starts = 0;
  const tools = createBackgroundWorkTools({
    description: "Research",
    inputSchema: { type: "object" },
    start: async () => {
      starts++;
      return snapshot;
    },
    read: async (id) => (id === "job" ? snapshot : null),
  });
  // The transport supplies context; these handlers deliberately do not use it.
  const context = {} as Parameters<
    NonNullable<typeof tools.get_background_work>["handler"]
  >[1];
  await tools.get_background_work!.handler({ requestId: "job" }, context);
  await tools.get_background_work!.handler({ requestId: "job" }, context);
  expect(starts).toBe(0);
  expect(tools.get_background_work!.annotations?.readOnlyHint).toBe(true);
  expect(tools.start_background_work!.commerce?.action).toBe("paid_access");
  const recovery = createBackgroundWorkTools({
    description: "Research",
    inputSchema: {},
    read: async () => null,
  });
  expect(recovery.start_background_work).toBeUndefined();
  const missing = await recovery.get_background_work!.handler(
    { requestId: "job" },
    context,
  );
  expect(missing).toMatchObject({ isError: true });
});

test("estimates project only public fields and cannot start work", async () => {
  let starts = 0;
  const tools = createBackgroundWorkTools({
    description: "Research",
    inputSchema: {},
    read: async () => null,
    start: async () => {
      starts++;
      return snapshot;
    },
    estimate: async () => ({
      minimumCredits: 20,
      estimatedCredits: 60,
      totalSteps: 3,
      assumptions: "One search per question",
      privateAccount: "secret",
    }),
  });
  const context = {} as Parameters<
    NonNullable<typeof tools.estimate_background_work>["handler"]
  >[1];
  const result = await tools.estimate_background_work!.handler({}, context);
  expect(starts).toBe(0);
  expect(tools.estimate_background_work!.commerce?.action).toBe("paid_access");
  expect(result).toMatchObject({
    structuredContent: { minimumCredits: 20, estimatedCredits: 60 },
  });
  expect(JSON.stringify(result)).not.toContain("secret");
  const invalid = createBackgroundWorkTools({
    description: "Research",
    inputSchema: {},
    read: async () => null,
    estimate: async () => ({
      minimumCredits: 20,
      estimatedCredits: 1,
      totalSteps: 3,
      assumptions: "test",
    }),
  });
  await expect(
    invalid.estimate_background_work!.handler({}, context),
  ).rejects.toThrow("Invalid background work estimate");
});

test("automatic budgets are the default, top-ups are exceptional, and replay keeps its budget", async () => {
  let available = 8;
  let saved: McpBackgroundWorkSnapshot | null = null;
  const budgets: number[] = [];
  const tools = createBackgroundWorkTools({
    description: "Research",
    inputSchema: { type: "object" },
    availableCredits: async () => available,
    read: async () => saved,
    estimate: async () => ({
      minimumCredits: 3,
      estimatedCredits: 10,
      totalSteps: 2,
      assumptions: "fixture",
    }),
    start: async (request) => {
      budgets.push(request.maxCredits);
      saved = { ...snapshot, budget: request.maxCredits };
      return saved;
    },
    resume: async () => ({ ...snapshot, status: "completed", settled: true }),
  });
  const context = {} as Parameters<
    NonNullable<typeof tools.start_background_work>["handler"]
  >[1];
  expect(tools.start_background_work!.inputSchema.required).toEqual([
    "requestId",
    "input",
  ]);
  await tools.start_background_work!.handler(
    { requestId: "job", input: {} },
    context,
  );
  available = 0;
  await tools.start_background_work!.handler(
    { requestId: "job", input: {} },
    context,
  );
  expect(budgets).toEqual([8, 8]);
  await tools.get_background_work!.handler({ requestId: "job" }, context);
  saved = null;
  await expect(
    tools.start_background_work!.handler(
      { requestId: "new", input: {} },
      context,
    ),
  ).rejects.toBeInstanceOf(McpFundingRequiredError);
  expect(
    await tools.continue_background_work!.handler(
      { requestId: "job" },
      context,
    ),
  ).toMatchObject({ structuredContent: { status: "completed" } });
});
test("explicit spend approval is an opt-in host policy", () => {
  const tools = createBackgroundWorkTools({
    description: "Research",
    inputSchema: {},
    budgetPolicy: "explicit",
    read: async () => null,
    start: async () => snapshot,
  });
  expect(tools.start_background_work!.inputSchema.required).toContain(
    "maxCredits",
  );
});

test("routine task output keeps accounting out of model-facing content", () => {
  const result = createBackgroundWorkResult("job", snapshot);
  expect(JSON.stringify(result.content)).not.toContain("creditsCharged");
  expect(result._meta).toMatchObject({
    "absolutejs/accounting": { maxCredits: 10, creditsCharged: 3 },
  });
  expect(
    createBackgroundWorkResult("job", snapshot, { includeAccounting: true })
      .structuredContent,
  ).toMatchObject({ creditsCharged: 3 });
});

for (const status of [
  "queued",
  "running",
  "completed",
  "paused",
  "stopped",
  "failed",
  "unknown",
] as const) {
  test(`reading ${status} work preserves its outcome without starting work`, async () => {
    let starts = 0;
    const tools = createBackgroundWorkTools({
      description: "Research",
      inputSchema: {},
      read: async () => ({ ...snapshot, status }),
      start: async () => {
        starts++;
        return snapshot;
      },
    });
    const context = {} as Parameters<
      NonNullable<typeof tools.get_background_work>["handler"]
    >[1];
    const result = await tools.get_background_work!.handler(
      { requestId: "job" },
      context,
    );
    expect(result).toMatchObject({
      isError: false,
      structuredContent: {
        requestId: "job",
        status,
        results: snapshot.results,
        canContinue: false,
      },
    });
    expect(starts).toBe(0);
    if (status === "unknown")
      expect(JSON.stringify(result)).toContain("Do not start another job");
  });
}

test("execution completion preserves unmet fulfillment in text and structured results", () => {
  const fulfillment = {
    status: "partial" as const,
    summary:
      "Research finished with two of eight qualified targets. More research is needed.",
  };
  const result = createBackgroundWorkResult("job", {
    ...snapshot,
    status: "completed",
    settled: true,
    fulfillment,
  });
  expect(result.structuredContent).toMatchObject({
    status: "completed",
    fulfillment,
    message: fulfillment.summary,
  });
  expect(result.content[0]?.type).toBe("text");
  expect(result.isError).toBe(false);
  const unknown = createBackgroundWorkResult("job", {
    ...snapshot,
    status: "unknown",
    fulfillment,
  });
  expect(unknown.structuredContent?.message).toContain("uncertain outcome");
});
