import { expect, test } from "bun:test";
import { createMcpAppResult, readMcpAppView } from "../src/apps";

test("large presentation data stays outside model content, with explicit outcomes and retrieval", () => {
  const view = { evidence: "source text".repeat(10000) };
  const model = {
    status: "blocked",
    blockers: ["Missing purchasing evidence"],
    sourceId: "source-1",
  };
  const result = createMcpAppResult({
    model,
    view,
    meta: { trace: "trace-1" },
  });
  expect(result.structuredContent).toEqual(model);
  expect(JSON.stringify(result.content).length).toBeLessThan(250);
  expect(JSON.stringify(result.structuredContent)).not.toContain("source text");
  expect(readMcpAppView(result)).toEqual(view);
  expect(result._meta?.trace).toBe("trace-1");
});
test("rolling upgrades retain legacy views and error flags", () => {
  expect(readMcpAppView({ structuredContent: { old: true } })).toEqual({
    old: true,
  });
  expect(readMcpAppView(null)).toBeUndefined();
  expect(
    createMcpAppResult({ model: {}, view: {}, isError: true }).isError,
  ).toBe(true);
});
