import { AsyncLocalStorage } from "node:async_hooks";
import type { McpCallIdentity } from "./types";
export type { McpCallIdentity } from "./types";

const calls = new AsyncLocalStorage<McpCallIdentity>();
/** Available throughout tool execution, including async provider callbacks. */
export const currentMcpCall = (): McpCallIdentity | undefined =>
  calls.getStore();
export const withMcpCall = <T>(identity: McpCallIdentity, run: () => T): T =>
  calls.run(identity, run);
