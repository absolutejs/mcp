// Sessions — required ONLY for elicitation, and deliberately nothing else.
//
// Elicitation is the one MCP feature a stateless server cannot do. The server
// sends `elicitation/create` down the SSE stream of an in-flight `tools/call`,
// and the client answers it in a SEPARATE HTTP POST (spec: "the body of the
// POST request MUST be a single JSON-RPC request, notification, or response").
// Two different HTTP requests have to meet, so something has to remember the
// promise between them — that's this.
//
// CONSEQUENCE, stated plainly: an endpoint with elicitation enabled is no
// longer horizontally stateless. The pending promise lives in ONE process, so
// the client's answer must reach the same process — run a single instance, or
// pin sessions (sticky routing on `Mcp-Session-Id`). Everything else in this
// package stays stateless; if you never enable elicitation you never pay this.
import type { McpElicitResult, McpElicitationRequest } from "./types";

const DEFAULT_SESSION_TTL_MS = 3_600_000;
const DEFAULT_ELICIT_TIMEOUT_MS = 120_000;
const SWEEP_EVERY = 50;

type Pending = {
  resolve: (result: McpElicitResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

type Session = {
  /** The client declared the `elicitation` capability at initialize. */
  canElicit: boolean;
  lastSeen: number;
  /** In-flight elicitations, keyed by the JSON-RPC id we sent. */
  pending: Map<string, Pending>;
};

export type SessionRegistry = ReturnType<typeof createSessionRegistry>;

export const createSessionRegistry = (options?: {
  elicitTimeoutMs?: number;
  ttlMs?: number;
}) => {
  const ttlMs = options?.ttlMs ?? DEFAULT_SESSION_TTL_MS;
  const elicitTimeoutMs = options?.elicitTimeoutMs ?? DEFAULT_ELICIT_TIMEOUT_MS;
  const sessions = new Map<string, Session>();
  let sinceSweep = 0;

  // Idle sessions are dropped opportunistically — no timer, so a server with no
  // traffic isn't kept alive by this.
  const sweep = () => {
    sinceSweep += 1;
    if (sinceSweep < SWEEP_EVERY) return;
    sinceSweep = 0;
    const cutoff = Date.now() - ttlMs;
    sessions.forEach((session, id) => {
      if (session.lastSeen >= cutoff) return;
      session.pending.forEach((pending) => {
        clearTimeout(pending.timer);
        pending.resolve({ action: "cancel" });
      });
      sessions.delete(id);
    });
  };

  const touch = (id: string | null) => {
    if (!id) return null;
    const session = sessions.get(id);
    if (!session) return null;
    session.lastSeen = Date.now();

    return session;
  };

  return {
    /** A new session, returned to the client as `Mcp-Session-Id`. */
    create: (canElicit: boolean) => {
      sweep();
      const id = crypto.randomUUID();
      sessions.set(id, { canElicit, lastSeen: Date.now(), pending: new Map() });

      return id;
    },

    drop: (id: string) => {
      const session = sessions.get(id);
      session?.pending.forEach((pending) => {
        clearTimeout(pending.timer);
        pending.resolve({ action: "cancel" });
      });
      sessions.delete(id);
    },

    get: (id: string | null) => touch(id),

    /** The client answered one of our elicitation requests. Returns false when
     *  the id is unknown (a stale answer, or a foreign session) — the caller
     *  should still 202 it, per the transport rules. */
    resolveElicit: (
      sessionId: string | null,
      requestId: string,
      result: McpElicitResult,
    ) => {
      const session = touch(sessionId);
      const pending = session?.pending.get(requestId);
      if (!session || !pending) return false;
      clearTimeout(pending.timer);
      session.pending.delete(requestId);
      pending.resolve(result);

      return true;
    },

    /** Register an outbound elicitation and get back the id to send with it,
     *  plus the promise that settles when the client answers (or gives up). */
    startElicit: (sessionId: string, request: McpElicitationRequest) => {
      const session = sessions.get(sessionId);
      if (!session) {
        return {
          answer: Promise.resolve<McpElicitResult>({ action: "cancel" }),
          id: "",
          request,
        };
      }
      const id = `elicit_${crypto.randomUUID()}`;
      const answer = new Promise<McpElicitResult>((resolve) => {
        // A user who never answers must not hang the tool call forever.
        const timer = setTimeout(() => {
          session.pending.delete(id);
          resolve({ action: "cancel" });
        }, elicitTimeoutMs);
        session.pending.set(id, { resolve, timer });
      });

      return { answer, id, request };
    },
  };
};
