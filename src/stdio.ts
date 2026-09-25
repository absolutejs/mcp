import { dispatchMcp } from "./dispatch";
import type { McpServerConfig } from "./types";

export type McpStdioOptions<Caller> = {
  config: Omit<
    McpServerConfig<Caller>,
    "authorize" | "issuer" | "path" | "elicitation" | "tasks" | "apps"
  >;
  /** The local process identity. Remote tools must still authorize every call. */
  caller: Caller;
  scopes?: string[];
  input: AsyncIterable<Uint8Array>;
  /** Protocol output only. Never write logs or private tool values here. */
  write: (line: string) => void | Promise<void>;
  maxMessageBytes?: number;
};

/** Newline-delimited stdio transport using the same registry/dispatcher as HTTP.
 * No listening socket or ambient HTTP authorization. The launching OS user owns
 * the process; hosts authenticate remote operations independently. Elicitation,
 * MCP Apps and background tasks are intentionally not advertised by this adapter.
 */
export async function serveMcpStdio<Caller>(options: McpStdioOptions<Caller>) {
  const limit = options.maxMessageBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(limit) || limit < 256 || limit > 16 * 1024 * 1024)
    throw Error("Invalid MCP message limit");
  const config: McpServerConfig<Caller> = {
    ...options.config,
    issuer: "https://localhost",
    path: "/mcp",
    authorize: async () => ({ ok: true, caller: options.caller }),
  };
  let protocolVersion: string | undefined;
  let pending = new Uint8Array(0);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const error = (code: number, message: string) =>
    options.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code, message },
      }) + "\n",
    );
  async function handle(bytes: Uint8Array) {
    if (bytes.length === 0) return;
    let message: unknown;
    try {
      message = JSON.parse(decoder.decode(bytes));
    } catch {
      await error(-32700, "Parse error");
      return;
    }
    const response = await dispatchMcp(
      config,
      options.caller,
      options.scopes ?? [],
      message,
      { protocolVersion },
    );
    if (response.status === 202 || response.status === 204) return;
    const result = (await response.json()) as {
      result?: { protocolVersion?: string };
    };
    if (typeof result.result?.protocolVersion === "string")
      protocolVersion = result.result.protocolVersion;
    await options.write(JSON.stringify(result) + "\n");
  }
  for await (const chunk of options.input) {
    // Scan chunks before allocating: a peer cannot force an unbounded line buffer.
    let offset = 0;
    for (let i = 0; i <= chunk.length; i++) {
      if (i !== chunk.length && chunk[i] !== 10) continue;
      const part = chunk.subarray(offset, i);
      if (pending.length + part.length > limit) {
        await error(-32600, "MCP message exceeds byte limit");
        return;
      }
      const combined = new Uint8Array(pending.length + part.length);
      combined.set(pending);
      combined.set(part, pending.length);
      pending = combined;
      if (i !== chunk.length) {
        await handle(pending);
        pending = new Uint8Array(0);
      }
      offset = i + 1;
    }
  }
  if (pending.length) await error(-32700, "Unterminated MCP message");
}
