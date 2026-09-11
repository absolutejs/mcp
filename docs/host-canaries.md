# Repeatable MCP host canaries

The package ships `canary/server.ts`: a loopback-only, synthetic billing endpoint using the built package handler, report tools and Apps resources. It requires Bun. It has no customer database, authentication credentials, checkout tool or payment mutations. Never mount this unauthenticated fixture in an application or expose it as a production endpoint.

From an installed package, run `bun node_modules/@absolutejs/mcp/canary/server.ts`. From this repository, build first, then `bun run canary`. The fixed endpoint is `http://127.0.0.1:4428/mcp`. Startup validates all four report calls before listening. Stop it with Ctrl-C after the test. A port conflict fails startup rather than replacing another service.

The JSONL log records protocol methods, status, client name/version, negotiated protocol, advertised Apps MIME types and tool success. It records only the MCP protocol-version header and omits all other headers, session IDs, tool arguments and report bodies. Keep host transcripts local: host logs can contain unrelated account or environment information. Commit only reviewed evidence.

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

Terminal tests ran against the built `0.17.0` runtime. The later Claude web test used the published `0.17.1` canary.

| Host                                             | Negotiation                                                              | Observed result                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Claude Code 2.1.265, print mode, Streamable HTTP | Requested 2025-11-25; accepted server 2025-06-18; no Apps MIME extension | Four read calls passed, including cursor pagination; text/structured fallback; no embedded rendering claim |
| Codex CLI 0.154.0, exec mode, Streamable HTTP    | Requested and accepted 2025-06-18; no Apps MIME extension                | Four read calls passed, including cursor pagination; text/structured fallback; no embedded rendering claim |
| Claude web, Windows Chrome 152.0.7977.83         | Apps MIME advertised; accepted 2025-06-18                                | Three native views, refresh and pagination passed                                                          |
| VS Code 1.135.0                                  | Apps MIME advertised; negotiated 2025-11-25; omitted protocol header     | Three views, refresh and pagination verified after compatibility fix; initial balance required reload      |
| Cursor, Gemini CLI, goose                        | Executables unavailable in this environment                              | Not tested                                                                                                 |
| ChatGPT hosted surfaces                          | No host canary performed                                                 | Not tested                                                                                                 |

Both tested terminal clients tolerated GET 405 (no standalone SSE stream) and discovered all three tools. Claude Code also sent a `server/discover` probe that received 400 before successful initialization. These observations do not establish support in other versions or distributions. Initial fixture-development attempts failed receipt validation; the final fixture uses the billing package cursor encoder, supplies a valid receipt ID, and validates its records before listening.

The remaining release gates are other host surfaces including IDE rendering, authenticated staging reconnect/isolation, then the product's migration and commerce approval gates. This evidence does not enable any host commerce profile.

Sources: [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [VS Code MCP servers](https://code.visualstudio.com/docs/copilot/customization/mcp-servers), and the installed `claude --help` / `claude mcp --help` output. Host observations above come from actual local runs, not documentation claims.

## Claude web rendering evidence

The signed-in custom-connector test used the published 0.17.1 synthetic canary and native Windows Chrome 152.0.7977.83. Claude identified the reports as three interactive tools. All three HTML resource reads and initial tool calls succeeded. There were exactly three initial report calls; loading/reloading the views did not issue extra tool calls. Explicit balance refresh, usage refresh and Older receipts produced three further successful read calls. Daily usage expanded correctly. The final receipt page was empty and the Older receipts button disappeared. At a 390-pixel desktop viewport the embedded views had 322-pixel widths and no horizontal document overflow. This is not a native mobile-app check.

A temporary public tunnel allowed discovery but failed tool execution before reaching the handler. The passing run used a dedicated HTTPS development endpoint forwarding to the unchanged synthetic fixture. The temporary connector and route were removed afterward. No production application, billing data, OAuth grants or commerce profiles were changed. Reviewed aggregate evidence is in `canary/results/2026-09-11-claude-web.json`; it includes no endpoint addresses, headers, session IDs, credentials or chat transcripts. Patch 0.17.2 distributes this evidence; report runtime code is unchanged.

For Windows/WSL testing, a headed Linux browser may not appear on the Windows desktop. Use a native Windows test browser with a separate persistent profile and loopback CDP endpoint. Reuse one Playwright CDP connection. If existing cross-origin frames are missing from automation, reload with that connection established; Claude uses a wrapper frame and a nested `about:blank` app frame. Never commit browser profiles or credentials.

Conversational rendering is verified for this exact surface. Cursor interactive rendering and authenticated staging reconnect/account-isolation remain separate open gates.

## VS Code Copilot and session compatibility (0.17.3)

Native Windows VS Code 1.135.0 advertised Apps MIME support but omitted MCP-Protocol-Version on subsequent requests. The shared handler now applies the specified 2025-03-26 fallback for an absent header; explicitly unsupported values still return 400. The fixture now uses default supported protocols instead of forcing a downgrade. See the [MCP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#protocol-version-header).

Three report views rendered in the signed-in isolated Copilot workspace. Balance and usage refresh, daily expansion and receipt pagination passed. There were six report calls: three initial calls and three explicit button actions. Reloading restored the original report results with no extra report calls. All app documents measured 242px without horizontal document overflow. The first balance webview was blank until a window reload; its cause is not isolated, so this is a qualified rendering result, not proof of reliable first-load behavior. Reviewed aggregate evidence: `canary/results/2026-09-11-vscode.json`.

Package regressions verify authorization before session deletion, per-request account selection, expired-session HTTP 404, and fresh explicit client initialization. HTTP failures now produce McpClientError with status (and a JSON-RPC code when available), including empty/non-JSON responses. After a session 404, call client.initialize() to negotiate a fresh session before further operations. The failed tool is never automatically replayed; callers must decide whether retrying is appropriate. Synthetic credentials prove handler behavior, not OAuth correctness or real-tenant isolation. Authenticated staging remains a separate release gate.
