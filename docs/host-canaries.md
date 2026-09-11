# Repeatable MCP host canaries

The package ships `canary/server.ts`: a loopback-only, synthetic billing endpoint using the built package handler, report tools and Apps resources. It requires Bun. It has no customer database, authentication credentials, checkout tool or payment mutations. Never mount this unauthenticated fixture in an application or expose it as a production endpoint.

From an installed package, run `bun node_modules/@absolutejs/mcp/canary/server.ts`. From this repository, build first, then `bun run canary`. The fixed endpoint is `http://127.0.0.1:4428/mcp`. Startup validates all four report calls before listening. Stop it with Ctrl-C after the test. A port conflict fails startup rather than replacing another service.

The JSONL log records protocol methods, status, client name/version, negotiated protocol, advertised Apps MIME types and tool success. It omits headers, session IDs, tool arguments and report bodies. Keep host transcripts local: host logs can contain unrelated account or environment information. Commit only reviewed evidence.

## Host connections

Claude Code supports a per-invocation config, so testing need not modify an existing connector:

```sh
claude --strict-mcp-config --mcp-config '{"mcpServers":{"billing_canary":{"type":"http","url":"http://127.0.0.1:4428/mcp"}}}'
```

Codex CLI supports invocation-scoped configuration:

```sh
codex --config 'mcp_servers.billing_canary.url="http://127.0.0.1:4428/mcp"' --config 'mcp_servers.billing_canary.required=true'
```

For VS Code, use an isolated test workspace with this `.vscode/mcp.json`, then start the server from the MCP configuration UI:

```json
{
  "servers": {
    "billing_canary": { "type": "http", "url": "http://127.0.0.1:4428/mcp" }
  }
}
```

These commands describe connection setup, not proof that a host renders Apps. Conversational services that require an externally reachable endpoint need a dedicated synthetic staging endpoint and a signed-in test account. The loopback fixture is not directly reachable from those hosted services; do not point them at a customer's billing account to substitute for this test.

## Test sequence and acceptance

Ask the host to call `get_billing_status`, `get_usage_report` with `from=2026-09-01` and `to=2026-09-11`, `list_receipts`, then `list_receipts` with the returned `nextCursor`.

Expected: zero available credits, 12 reserved, no subscription or portal access; 8 credits consumed across 2 events; one USD receipt for 1000 cents with 200 refunded; an empty final page and null cursor. All four calls must succeed. Check actual tool results and server logs, not just the model's success statement.

Record the exact host version/surface, transport, requested and negotiated protocol, Apps MIME capability, tool discovery metadata, tool-call results, and visible rendering. If MIME negotiation is absent, all three tools must omit UI metadata and remain usable as text/structured results. If present, check the three views, refresh, pagination, narrow widths and absence of extra initial tool calls. Separately exercise expired-session reconnect and account isolation against an authenticated staging deployment; the synthetic endpoint does not certify OAuth, tenant isolation, payment permission or migration behavior.

## Observed September 11, 2026

Tests ran against the built `0.17.0` runtime, with the reusable canary distributed starting in `0.17.1`.

| Host                                             | Negotiation                                                              | Observed result                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Claude Code 2.1.265, print mode, Streamable HTTP | Requested 2025-11-25; accepted server 2025-06-18; no Apps MIME extension | Four read calls passed, including cursor pagination; text/structured fallback; no embedded rendering claim |
| Codex CLI 0.154.0, exec mode, Streamable HTTP    | Requested and accepted 2025-06-18; no Apps MIME extension                | Four read calls passed, including cursor pagination; text/structured fallback; no embedded rendering claim |
| Claude web                                       | Browser redirected to sign-in                                            | Not tested; requires signed-in test session and reachable synthetic staging endpoint                       |
| VS Code 1.135.0                                  | Installed version confirmed                                              | Interactive Copilot/MCP Apps UI not exercised                                                              |
| Cursor, Gemini CLI, goose                        | Executables unavailable in this environment                              | Not tested                                                                                                 |
| ChatGPT hosted surfaces                          | No host canary performed                                                 | Not tested                                                                                                 |

Both tested terminal clients tolerated GET 405 (no standalone SSE stream) and discovered all three tools. Claude Code also sent a `server/discover` probe that received 400 before successful initialization. These observations do not establish support in other versions or distributions. Initial fixture-development attempts failed receipt validation; the final fixture uses the billing package cursor encoder, supplies a valid receipt ID, and validates its records before listening.

The remaining release gates are real conversational/IDE rendering, authenticated staging reconnect/isolation, then the product's migration and commerce approval gates. This evidence does not enable any host commerce profile.

Sources: [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [VS Code MCP servers](https://code.visualstudio.com/docs/copilot/customization/mcp-servers), and the installed `claude --help` / `claude mcp --help` output. Host observations above come from actual local runs, not documentation claims.
