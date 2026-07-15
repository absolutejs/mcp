import type { McpSessionStore, McpTask, McpTaskStore } from "./types";

export type McpSqlResult<Row> = {
  rowCount: number;
  rows: ReadonlyArray<Row>;
};

export type McpSqlClient = {
  query: <Row = Record<string, unknown>>(
    sql: string,
    parameters?: ReadonlyArray<unknown>,
  ) => Promise<McpSqlResult<Row>>;
};

const namespaceOf = (namespace: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(namespace))
    throw new Error("MCP PostgreSQL namespace must be a simple identifier");
  return namespace;
};

export const mcpPostgresSchemaSql = (namespace = "mcp") => {
  const ns = namespaceOf(namespace);
  return `CREATE SCHEMA IF NOT EXISTS ${ns};
CREATE TABLE IF NOT EXISTS ${ns}.tasks (
  task_id text PRIMARY KEY,
  authorization_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('working','input_required','completed','failed','cancelled')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz,
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_authorization_updated_idx ON ${ns}.tasks (authorization_key, updated_at DESC);
CREATE INDEX IF NOT EXISTS tasks_expiry_idx ON ${ns}.tasks (expires_at) WHERE expires_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS ${ns}.sessions (
  session_id text PRIMARY KEY,
  can_elicit boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON ${ns}.sessions (expires_at);`;
};

type TaskRow = { data: McpTask };

export const createPostgresMcpTaskStore = ({
  client,
  namespace = "mcp",
  now = () => new Date(),
}: {
  client: McpSqlClient;
  namespace?: string;
  now?: () => Date;
}): McpTaskStore => {
  const ns = namespaceOf(namespace);
  return {
    cancel: async (taskId) => {
      const updatedAt = now().toISOString();
      await client.query(
        `UPDATE ${ns}.tasks SET status = 'cancelled', updated_at = $2::timestamptz, data = data || $3::jsonb WHERE task_id = $1 AND status NOT IN ('cancelled','completed','failed')`,
        [taskId, updatedAt, JSON.stringify({ lastUpdatedAt: updatedAt, status: "cancelled" })],
      );
    },
    get: async (taskId) =>
      (
        await client.query<TaskRow>(
          `SELECT data FROM ${ns}.tasks WHERE task_id = $1 AND (expires_at IS NULL OR expires_at > $2::timestamptz)`,
          [taskId, now().toISOString()],
        )
      ).rows[0]?.data ?? null,
    save: async (task) => {
      const expiresAt =
        task.ttlMs === null
          ? null
          : new Date(new Date(task.createdAt).getTime() + task.ttlMs).toISOString();
      await client.query(
        `INSERT INTO ${ns}.tasks (task_id, authorization_key, status, created_at, updated_at, expires_at, data) VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6::timestamptz, $7::jsonb) ON CONFLICT (task_id) DO NOTHING`,
        [task.taskId, task.authorizationKey, task.status, task.createdAt, task.lastUpdatedAt, expiresAt, JSON.stringify(task)],
      );
    },
    update: async (taskId, update) => {
      const updatedAt = now().toISOString();
      const data = { ...update, lastUpdatedAt: updatedAt };
      const result = await client.query<TaskRow>(
        `UPDATE ${ns}.tasks SET status = COALESCE($2::text, status), updated_at = $3::timestamptz, data = data || $4::jsonb WHERE task_id = $1 AND status NOT IN ('cancelled','completed','failed') RETURNING data`,
        [taskId, update.status ?? null, updatedAt, JSON.stringify(data)],
      );
      if (result.rows[0] !== undefined) return result.rows[0].data;
      return (
        await client.query<TaskRow>(`SELECT data FROM ${ns}.tasks WHERE task_id = $1`, [taskId])
      ).rows[0]?.data ?? null;
    },
  };
};

export const createPostgresMcpSessionStore = ({
  client,
  namespace = "mcp",
  now = () => new Date(),
  ttlMs = 3_600_000,
}: {
  client: McpSqlClient;
  namespace?: string;
  now?: () => Date;
  ttlMs?: number;
}): McpSessionStore => {
  const ns = namespaceOf(namespace);
  return {
    create: async ({ canElicit }) => {
      const id = crypto.randomUUID();
      const current = now();
      await client.query(
        `INSERT INTO ${ns}.sessions (session_id, can_elicit, created_at, last_seen_at, expires_at) VALUES ($1, $2, $3::timestamptz, $3::timestamptz, $4::timestamptz)`,
        [id, canElicit, current.toISOString(), new Date(current.getTime() + ttlMs).toISOString()],
      );
      return id;
    },
    drop: async (id) => {
      await client.query(`DELETE FROM ${ns}.sessions WHERE session_id = $1`, [id]);
    },
    get: async (id) => {
      const current = now();
      const result = await client.query<{ can_elicit: boolean }>(
        `UPDATE ${ns}.sessions SET last_seen_at = $2::timestamptz, expires_at = $3::timestamptz WHERE session_id = $1 AND expires_at > $2::timestamptz RETURNING can_elicit`,
        [id, current.toISOString(), new Date(current.getTime() + ttlMs).toISOString()],
      );
      const row = result.rows[0];
      return row === undefined ? null : { canElicit: row.can_elicit };
    },
  };
};
