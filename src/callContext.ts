import { AsyncLocalStorage } from "node:async_hooks";
import type { McpCallMeta } from "./types";

/** Server-generated identity. Client arguments must never overwrite this context. */
export type McpCallIdentity = {
  traceId: string;
  requestId: string | number | null;
  sessionId: string | null;
  name: string;
  startedAt: number;
  serverName: string;
  serverVersion: string;
  meta: McpCallMeta;
};
const calls = new AsyncLocalStorage<McpCallIdentity>();
/** Available throughout tool execution, including async provider callbacks. */
export const currentMcpCall = (): McpCallIdentity | undefined =>
  calls.getStore();
export const withMcpCall = <T>(identity: McpCallIdentity, run: () => T): T =>
  calls.run(identity, run);
