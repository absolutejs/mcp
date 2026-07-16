import { describe, expect, test } from "bun:test";
import { createSessionRegistry } from "../src/sessions";
import type { McpElicitAnswer, McpElicitBus } from "../src/types";

describe("elicitation bus lifecycle", () => {
  test("waits for an async subscription and releases it on close", async () => {
    let handler: ((answer: McpElicitAnswer) => void) | undefined;
    let stopped = false;
    const bus: McpElicitBus = {
      publish: async (answer) => handler?.(answer),
      subscribe: async (next) => {
        await Promise.resolve();
        handler = next;
        return async () => {
          stopped = true;
        };
      },
    };
    const registry = createSessionRegistry({ bus, elicitTimeoutMs: 1_000 });
    await registry.ready;
    const pending = registry.startElicit({
      message: "Continue?",
      requestedSchema: { properties: {}, type: "object" },
    });
    await registry.resolveElicit({
      requestId: pending.id,
      result: { action: "decline" },
      sessionId: null,
    });
    expect(await pending.answer).toEqual({ action: "decline" });
    await registry.close();
    expect(stopped).toBe(true);
  });
});
