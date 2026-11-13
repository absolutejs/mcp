# Upstream issues

## VS Code webviews can go blank after a remount

Tracking: [microsoft/vscode#335908](https://github.com/microsoft/vscode/issues/335908). We opened the issue and submitted no pull request. Upstream fixed it in [microsoft/vscode#346646](https://github.com/microsoft/vscode/pull/346646) (commit `7a1fb57`, merged 2026-11-11, after `release/1.146` was cut). The first stable release with the fix will be 1.147.0. Insiders has it from build `d8e7b56`.

When a webview is remounted, an earlier asynchronous origin-hash completion can replace the iframe after the newer mount connects. We reproduced a blank report in native Windows VS Code 1.135.0 by delaying the first hash. The upstream fix ignores a hash result whose per-mount ID is no longer current, for both the encoded origin and iframe initialization. That is equivalent to our patch. [The regression checker](canary/vscode/README.md) fails on 1.135.0 and passes on the fix commit and on `main` as of 2026-11-12.

### Shared workaround

From MCP 0.31.3, new sessions that identify as `Visual Studio Code` or `Visual Studio Code - Insiders` with a version below 1.147.0 receive text and structured results without Apps metadata or HTML resources. MCP 0.17.6 to 0.31.2 matched only 1.135.0 and 1.136.1 exactly, which left every stable release from 1.137 to 1.146 unprotected. Report tools remain available, and authorization, billing and other host negotiations are unchanged. An unparseable version keeps normal negotiation. This rule is a presentation workaround, not a security boundary.

Insiders builds labelled 1.147.0 from before 2026-11-11 lack the fix but match the new cutoff. VS Code does not report its commit, so these builds can't be told apart. Insiders updates itself daily, so we accepted that gap.

For an existing VS Code connection, run **MCP: Reset Cached Tools**, then **Developer: Reload Window**, reconnect/start the MCP server and open a new chat. In our test, reconnecting alone reused old UI metadata. The negotiated Apps capability is stored in the session, so existing sessions keep their old decision until they reconnect.

`apps.allowKnownBrokenHosts: true` bypasses the version exclusion for controlled testing. It still requires the host to advertise the Apps MIME capability. Don't enable it on ordinary affected installations.

### Native verification (2026-11-12)

We tested portable native Windows builds against the synthetic loopback canary, with no real accounts or payments.

- **Insiders `d8e7b56` (`1.147.0-insider`):** all three report Apps rendered in a fresh chat. We confirmed this by reading the text inside each App frame. Scrolling the views away and back forces webview unmount and remount; across those sweeps there were about 250 on-screen checks and none were blank. Reload Window with a restored session rendered the views again without extra tool calls. Refresh worked on balance and usage, and receipt pagination reached the empty final page with "Older receipts" hidden. With alternate origin-hash digests delayed by 350ms, the race fired twice, a newer mount's hash finishing while an older one was pending, and no view went blank.
- **Stable 1.146.0:** it connected as `Visual Studio Code` 1.146.0 with the Apps MIME type, and MCP 0.31.3 withheld UI metadata (text fallback confirmed). Chats restored from before the change show "MCP server … isn't available yet" in place of the App; that is cosmetic.
- **Not established:** the delayed-hash control on stable. Its Copilot agent did not expose the workspace server's tools, so no App rendered there to blank. The Insiders race result therefore rests on the September 1.135.0 reproduction and the source checker, not on a same-day control.
- **Host identity:** the 1.147 Copilot agent harness ("new Copilot experience") initializes MCP as `copilot-cli` 1.0.110-1, not `Visual Studio Code`. A pre-1.147 build running that harness would bypass the version cutoff. We accept this as a transitional gap, because `copilot-cli` carries no editor version and fixed builds use the same identity.

Stable 1.147.0 still needs a quick recheck when it ships.

### Removal

Keep the cutoff while sessions from builds below 1.147.0 remain in use. Keep the checker and this history so a successful retry is not mistaken for a fix.
