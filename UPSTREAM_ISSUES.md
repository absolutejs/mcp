# Upstream issues

## VS Code webviews can go blank after a remount

Tracking: [microsoft/vscode#335908](https://github.com/microsoft/vscode/issues/335908). An issue was submitted; no pull request was submitted.

An earlier asynchronous origin-hash completion can replace the iframe after a newer mount connects. In native Windows VS Code 1.135.0, delaying the first hash reproduced a blank report. A current-promise guard passed three rounds across balance, usage and receipts in the isolated test process. The same unguarded method was found in the local 1.136.1 bundle; that version was source-inspected, not runtime-tested. See [the source patch and regression checker](canary/vscode/README.md).

### Shared workaround in MCP 0.17.6

New sessions identifying themselves as `Visual Studio Code` version `1.135.0` or `1.136.1` receive text and structured results without Apps metadata or HTML resources. Report tools remain available. Authorization, billing and other host negotiations are unchanged. This exact-version rule is a presentation workaround, not a security boundary or a certification of other versions.

For an existing VS Code connection, run **MCP: Reset Cached Tools**, then **Developer: Reload Window**, reconnect/start the MCP server and open a new chat. Reconnection alone reused old UI metadata in our test. Reconnect the MCP server after upgrading: the negotiated Apps capability is stored in the session, so existing sessions retain their old decision. Consumers get the workaround through the package; they do not need a project-specific renderer or an editor patch.

`apps.allowKnownBrokenHosts: true` bypasses the version exclusion for controlled testing of a verified patched host. It still requires the host to advertise the Apps MIME capability. Do not enable it on ordinary affected installations. The diagnostic in-memory VS Code patch does not survive restart and is not the deployed workaround.

### Removal

Keep the fallback for affected builds until they can reliably render Apps. When an upstream fix ships, verify fresh conversations, repeated mounts, refresh and pagination in the released host before certifying rich views there. Remove the override when a patched test build is retired. Keep the source regression and issue history so a successful retry is not mistaken for a fix.
