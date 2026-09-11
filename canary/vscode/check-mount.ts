/** Run against a trusted VS Code webviewElement.ts checkout; executes its real mountTo method. */
import { readFile } from "node:fs/promises";
const file = process.argv[2];
if (!file) throw Error("Usage: bun check-mount.ts /path/to/webviewElement.ts");
const source = await readFile(file, "utf8");
const start = source.indexOf("\tpublic mountTo(");
const end = source.indexOf("\n\tprivate _registerMessageHandler(", start);
if (start < 0 || end < 0) throw Error("Unsupported source layout");
const method = source.slice(start, end);
const javascript = new Bun.Transpiler({ loader: "ts" }).transformSync(
  `class MountProbe { ${method} }`,
);
type Probe = {
  mountTo: (element: unknown, window: unknown) => void;
  _encodedWebviewOrigin?: string;
  _disposed: boolean;
};
const results: { name: string; passed: boolean }[] = [];
for (const order of [
  [1, 0],
  [0, 1],
]) {
  const pending: ((origin: string) => void)[] = [];
  const mounted: string[] = [];
  const create = new Function(
    "parentOriginHash",
    "EventType",
    "addDisposableListener",
    `${javascript};return MountProbe;`,
  );
  const Constructor = create(
    () => new Promise<string>((resolve) => pending.push(resolve)),
    {},
    () => ({}),
  ) as new () => Probe;
  const probe = new Constructor();
  Object.assign(probe, {
    element: {},
    origin: "test",
    _disposed: false,
    _registerMessageHandler: () => {},
    _register: () => {},
    perfMark: () => {},
    _initElement: (origin: string) => mounted.push(origin),
  });
  const container = { appendChild: () => {} };
  probe.mountTo(container, { origin: "first-window", vscodeWindowId: 1 });
  probe.mountTo(container, { origin: "second-window", vscodeWindowId: 2 });
  for (const index of order) {
    pending[index]!(index === 0 ? "old-origin" : "new-origin");
    await new Promise<void>((resolve) => queueMicrotask(resolve));
  }
  results.push({
    name:
      order[0] === 1
        ? "late-old-startup-ignored"
        : "early-obsolete-startup-ignored",
    passed:
      mounted.length === 1 &&
      mounted[0] === "new-origin" &&
      probe._encodedWebviewOrigin === "new-origin",
  });
  mounted.length = 0;
  probe.mountTo(container, { origin: "disposed-window", vscodeWindowId: 3 });
  probe._disposed = true;
  pending[2]!("disposed-origin");
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  results.push({
    name: "disposed-view-not-mounted",
    passed: mounted.length === 0,
  });
}
const passed = results.every((result) => result.passed);
console.log(JSON.stringify({ passed, results }, null, 2));
if (!passed) process.exitCode = 1;
