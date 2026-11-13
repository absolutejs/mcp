# Upstream issues

## VS Code webviews can go blank after a remount

Tracking: [microsoft/vscode#335908](https://github.com/microsoft/vscode/issues/335908). We opened the issue and submitted no pull request. Upstream fixed it in [microsoft/vscode#346646](https://github.com/microsoft/vscode/pull/346646) (commit `7a1fb57`, merged 2026-11-11, after `release/1.146` was cut). The first stable release with the fix will be 1.147.0. Insiders has it from build `d8e7b56`.

When a webview is remounted, an earlier asynchronous origin-hash completion can replace the iframe after the newer mount connects. We reproduced a blank report in native Windows VS Code 1.135.0 by delaying the first hash. The upstream fix ignores a hash result whose per-mount ID is no longer current, for both the encoded origin and iframe initialization. That is equivalent to our patch. [The regression checker](canary/vscode/README.md) fails on 1.135.0 and passes on the fix commit and on `main` as of 2026-11-12.

### Shared workaround

From MCP 0.31.3, new sessions that identify as `Visual Studio Code` or `Visual Studio Code - Insiders` with a version below 1.147.0 receive text and structured results without Apps metadata or HTML resources. MCP 0.17.6 to 0.31.2 matched only 1.135.0 and 1.136.1 exactly, which left every stable release from 1.137 to 1.146 unprotected. Report tools remain available, and authorization, billing and other host negotiations are unchanged. An unparseable version keeps normal negotiation. This rule is a presentation workaround, not a security boundary.

Insiders builds labelled 1.147.0 from before 2026-11-11 lack the fix but match the new cutoff. VS Code does not report its commit, so these builds can't be told apart. Insiders updates itself daily, so we accepted that gap.

For an existing VS Code connection, run **MCP: Reset Cached Tools**, then **Developer: Reload Window**, reconnect/start the MCP server and open a new chat. In our test, reconnecting alone reused old UI metadata. The negotiated Apps capability is stored in the session, so existing sessions keep their old decision until they reconnect.

`apps.allowKnownBrokenHosts: true` bypasses the version exclusion for controlled testing. It still requires the host to advertise the Apps MIME capability. Don't enable it on ordinary affected installations.

### Verification still owed

The 1.147.0 cutoff relies on the upstream fix and the source-level checker. It has not been runtime-verified in a released host. Before answering `/verified` upstream or certifying rich views, do the following on native Windows Insiders (`d8e7b56` or later), and again on stable 1.147.0 when it ships:

1. Test fresh conversations, repeated mounts, refresh and receipt pagination across balance, usage and receipts.
2. Repeat the 350ms delayed-first-hash test that reproduced the blank view on 1.135.0.

Ordinary successful runs don't prove the fix, because the failure is timing-sensitive.

### Removal

Keep the cutoff while sessions from builds below 1.147.0 remain in use. Keep the checker and this history so a successful retry is not mistaken for a fix.
