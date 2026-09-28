import { expect, test } from "bun:test";

test("browser client entry does not import server-only async context", async () => {
  const result = await Bun.build({
    entrypoints: [
      new URL("./fixtures/browserClient.ts", import.meta.url).pathname,
    ],
    target: "browser",
    write: false,
  });
  expect(result.success).toBe(true);
  expect(result.logs).toHaveLength(0);
});
