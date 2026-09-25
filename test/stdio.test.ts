import { expect, test } from "bun:test";
import { serveMcpStdio } from "../src/stdio";

async function run(chunks: Uint8Array[], limit?: number) {
  const output: string[] = [];
  await serveMcpStdio({
    config: {
      serverInfo: { name: "local", version: "1" },
      tools: () => ({
        status: {
          description: "Status only",
          inputSchema: { type: "object", additionalProperties: false },
          handler: () => "copied",
        },
      }),
    },
    caller: {},
    input: (async function* () {
      yield* chunks;
    })(),
    write: (line) => {
      output.push(line);
    },
    maxMessageBytes: limit,
  });
  return output.map((line) => JSON.parse(line));
}
const enc = new TextEncoder();
test("fragmented initialization, notifications and multiple requests share the registry", async () => {
  const input = enc.encode(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "CLI", version: "1" },
      },
    }) +
      '\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"status","arguments":{}}}\n',
  );
  const output = await run([
    input.slice(0, 7),
    input.slice(7, 31),
    input.slice(31),
  ]);
  expect(output).toHaveLength(2);
  expect(output[0].result.protocolVersion).toBe("2025-11-25");
  expect(output[1].result.content).toEqual([{ type: "text", text: "copied" }]);
});
test("invalid encoding, malformed JSON, and oversized frames fail without echoing input", async () => {
  const output = await run([
    new Uint8Array([255, 10]),
    enc.encode("private-invalid\n"),
  ]);
  expect(output.map((x) => x.error.code)).toEqual([-32700, -32700]);
  expect(JSON.stringify(output)).not.toContain("private-invalid");
  expect((await run([enc.encode("x".repeat(257))], 256))[0].error.code).toBe(
    -32600,
  );
});
test("an incomplete frame is not dispatched at EOF", async () => {
  expect((await run([enc.encode('{"jsonrpc":"2.0"}')]))[0].error.code).toBe(
    -32700,
  );
});
