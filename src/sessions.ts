// Sessions — required ONLY for elicitation, and deliberately nothing else.
//
// Elicitation is the one MCP feature a stateless server cannot do. The server
// sends `elicitation/create` down the SSE stream of an in-flight `tools/call`,
// and the client answers it in a SEPARATE HTTP POST (spec: "the body of the
// POST request MUST be a single JSON-RPC request, notification, or response").
// Two different HTTP requests have to meet.
//
// Behind ONE server that's just a Map. Behind N servers, two things break, and
// they break differently:
//
//   1. The session itself. The client initializes on instance A and calls a
//      tool on instance B, which has never heard of the session. Fixed by a
//      shared `store` (put it in your database) — session state is tiny and
//      boring: an id and whether the client can elicit.
//
//   2. The pending answer. The tool call and its question live on ONE instance
//      — whichever is running it — but the client's answer POST may land on any
//      of them. A promise cannot be shared, so the answer has to be ROUTED to
//      the instance that's waiting. Fixed by a `bus` (Postgres LISTEN/NOTIFY,
//      Redis, whatever you already have): an answer nobody local was waiting
//      for gets published, and every other instance tries to resolve it.
//
// Supply neither and you get the in-memory single-instance behaviour, which is
// correct and enough for most servers. Supply both and elicitation is safe
// behind a load balancer with no sticky routing.
import type {
  McpElicitAnswer,
  McpElicitBus,
  McpElicitResult,
  McpElicitationRequest,
  McpSessionStore,
} from "./types";

const DEFAULT_SESSION_TTL_MS = 3_600_000;
const DEFAULT_ELICIT_TIMEOUT_MS = 120_000;
const SWEEP_EVERY = 50;

type Pending = {
  resolve: (result: McpElicitResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type SessionRegistry = ReturnType<typeof createSessionRegistry>;

/** In-memory session store — the default, and the right one for a single
 *  instance. Swap it for a DB-backed one to run several. */
const createMemoryStore = (ttlMs: number): McpSessionStore => {
  const sessions = new Map<string, { canElicit: boolean; lastSeen: number }>();
  let sinceSweep = 0;

  const sweep = () => {
    sinceSweep += 1;
    if (sinceSweep < SWEEP_EVERY) return;
    sinceSweep = 0;
    const cutoff = Date.now() - ttlMs;
    sessions.forEach((session, id) => {
      if (session.lastSeen < cutoff) sessions.delete(id);
    });
  };

  return {
    create: (session) => {
      sweep();
      const id = crypto.randomUUID();
      sessions.set(id, { canElicit: session.canElicit, lastSeen: Date.now() });

      return id;
    },
    drop: (id) => {
      sessions.delete(id);
    },
    get: (id) => {
      const session = sessions.get(id);
      if (!session) return null;
      session.lastSeen = Date.now();

      return { canElicit: session.canElicit };
    },
  };
};

export const createSessionRegistry = (options?: {
  bus?: McpElicitBus;
  elicitTimeoutMs?: number;
  store?: McpSessionStore;
  ttlMs?: number;
}) => {
  const ttlMs = options?.ttlMs ?? DEFAULT_SESSION_TTL_MS;
  const elicitTimeoutMs = options?.elicitTimeoutMs ?? DEFAULT_ELICIT_TIMEOUT_MS;
  const store = options?.store ?? createMemoryStore(ttlMs);
  // Promises can't cross a process boundary, so this stays local no matter what
  // the store does. The bus is what carries an answer TO it.
  const pending = new Map<string, Pending>();

  /** Hand an answer to the call waiting for it, if that call is ours. */
  const resolveLocal = (answer: McpElicitAnswer) => {
    const waiting = pending.get(answer.requestId);
    if (!waiting) return false;
    clearTimeout(waiting.timer);
    pending.delete(answer.requestId);
    waiting.resolve(answer.result);

    return true;
  };

  // An answer another instance couldn't place — it may be ours.
  options?.bus?.subscribe((answer) => {
    resolveLocal(answer);
  });

  return {
    create: async (canElicit: boolean) => await store.create({ canElicit }),

    drop: async (id: string) => {
      await store.drop(id);
    },

    get: async (id: string | null) => (id ? await store.get(id) : null),

    /** The client answered. If the call that asked is running HERE, resolve it.
     *  If not, put the answer on the bus so the instance that is waiting can —
     *  the answer must find the promise, and the promise cannot move. */
    resolveElicit: (answer: McpElicitAnswer) => {
      if (resolveLocal(answer)) return true;
      options?.bus?.publish(answer);

      return false;
    },

    /** Register an outbound question. Returns the id to send it under and the
     *  promise that settles when the user answers — or when they never do. */
    startElicit: (request: McpElicitationRequest) => {
      const id = `elicit_${crypto.randomUUID()}`;
      const answer = new Promise<McpElicitResult>((resolve) => {
        // A user who walks away must not hold a tool call open forever.
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ action: "cancel" });
        }, elicitTimeoutMs);
        pending.set(id, { resolve, timer });
      });

      return { answer, id, request };
    },
  };
};
