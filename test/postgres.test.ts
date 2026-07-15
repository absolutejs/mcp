import { describe, expect, test } from "bun:test";
import {
  createPostgresMcpSessionStore,
  createPostgresMcpTaskStore,
  mcpPostgresSchemaSql,
  type McpSqlClient,
} from "../src";

describe("MCP PostgreSQL stores", () => {
  test("creates task and session tables and rejects unsafe namespaces", () => {
    expect(mcpPostgresSchemaSql()).toContain("mcp.tasks");
    expect(mcpPostgresSchemaSql()).toContain("mcp.sessions");
    expect(() => mcpPostgresSchemaSql("mcp;drop")).toThrow("simple identifier");
  });

  test("terminal task protection is enforced in SQL", async () => {
    const calls: string[] = [];
    const client: McpSqlClient = {
      query: async (sql) => {
        calls.push(sql);
        return { rowCount: 0, rows: [] };
      },
    };
    const store = createPostgresMcpTaskStore({ client });
    await store.cancel("task-1");
    await store.update("task-1", { status: "completed" });
    expect(calls[0]).toContain("status NOT IN ('cancelled','completed','failed')");
    expect(calls[1]).toContain("status NOT IN ('cancelled','completed','failed')");
  });

  test("touches and extends only unexpired sessions", async () => {
    const calls: string[] = [];
    const client: McpSqlClient = {
      query: async (sql) => {
        calls.push(sql);
        return { rowCount: 1, rows: [{ can_elicit: true }] };
      },
    };
    const store = createPostgresMcpSessionStore({
      client,
      now: () => new Date("2026-01-01T00:00:00Z"),
    });
    expect(await store.get("session-1")).toEqual({ canElicit: true });
    expect(calls[0]).toContain("expires_at >");
  });
});
