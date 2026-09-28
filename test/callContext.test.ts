import { expect, test } from "bun:test";
import { dispatchMcp } from "../src/dispatch";
import { currentMcpCall } from "../src/callContext";
import type { McpServerConfig } from "../src/types";
const server = (): McpServerConfig<string> => ({
  issuer: "https://test.invalid",
  path: "/mcp",
  serverInfo: { name: "test", version: "1" },
  authorize: async () => ({ ok: true, caller: "owner", scopes: [] }),
  tools: () => ({
    probe: {
      description: "Probe",
      inputSchema: { type: "object" },
      handler: async () => {
        const first = currentMcpCall();
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(currentMcpCall()).toBe(first);
        return JSON.stringify({
          traceId: first?.traceId,
          session: first?.sessionId,
        });
      },
    },
  }),
});
const call = (config: McpServerConfig<string>, id: number) =>
  dispatchMcp(
    config,
    "owner",
    [],
    {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: "probe", arguments: { traceId: "untrusted" } },
    },
    { sessionId: `session-${id}` },
  );
test("call context is server-generated and isolated across concurrent requests", async () => {
  const responses = await Promise.all([call(server(), 1), call(server(), 2)]);
  const values = await Promise.all(
    responses.map(async (r) =>
      JSON.parse((await r.json()).result.content[0].text),
    ),
  );
  expect(values[0].traceId).not.toBe(values[1].traceId);
  expect(values[0].traceId).not.toBe("untrusted");
  expect(values.map((v) => v.session)).toEqual(["session-1", "session-2"]);
  expect(currentMcpCall()).toBeUndefined();
});
test("failed start persistence prevents effects; completion failure does not rerun effects", async () => {
  let effects = 0;
  const config = server();
  config.tools = () => ({
    probe: {
      description: "Probe",
      inputSchema: { type: "object" },
      handler: () => {
        effects++;
        return "done";
      },
    },
  });
  config.onCallStart = () => {
    throw Error("storage unavailable");
  };
  expect((await (await call(config, 1)).json()).error).toBeDefined();
  expect(effects).toBe(0);
  config.onCallStart = () => {};
  config.onCall = () => {
    throw Error("completion unavailable");
  };
  expect((await (await call(config, 2)).json()).result.content[0].text).toBe(
    "done",
  );
  expect(effects).toBe(1);
});
