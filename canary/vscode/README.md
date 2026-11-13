# VS Code webview mount race

A host lifecycle race can leave an MCP App blank before its inner document loads. `mountTo` computes the parent-origin hash asynchronously. A subsequent mount can finish first; without a current-startup check, the older completion can overwrite the origin and reset the iframe after the newer connection is ready.

`webview-mount-race.patch` fixes the host's source implementation by applying a completion only when its captured promise is still the current mount promise. It does not change MCP or billing code, disable sandboxing, retry tools, or add an arbitrary delay.

The baseline is VS Code 1.135.0, commit `08d4889f9ec4a1685d257b9b95de036c8e1ce1e5`. The same mount method was present on upstream main when checked September 11, 2026. [Upstream source](https://github.com/microsoft/vscode/blob/08d4889f9ec4a1685d257b9b95de036c8e1ce1e5/src/vs/workbench/contrib/webview/browser/webviewElement.ts).

## Reproduce and check the source fix

Use a trusted VS Code checkout and the package's Bun checker. The checker extracts and executes the actual `mountTo` method; it does not substitute a second implementation. Other DOM/service hooks are stubbed, and hash completion order is controlled.

```sh
bun /path/to/node_modules/@absolutejs/mcp/canary/vscode/check-mount.ts src/vs/workbench/contrib/webview/browser/webviewElement.ts
# Original: exits 1 for both obsolete-startup checks.
git apply /path/to/node_modules/@absolutejs/mcp/canary/vscode/webview-mount-race.patch
bun /path/to/node_modules/@absolutejs/mcp/canary/vscode/check-mount.ts src/vs/workbench/contrib/webview/browser/webviewElement.ts
# Patched: all four checks pass; exits 0.
```

The checker executes code from the supplied source file. Use only a trusted checkout. It needs Bun and is a targeted lifecycle regression, not the complete VS Code test suite.

## Native-host verification

In the isolated, signed-in native Windows VS Code 1.135.0 test window, completing an earlier origin hash 350ms after a newer startup reproduced a blank report on the unmodified host. With the equivalent current-promise guard applied only in the test process, three repeated rounds across balance, usage and receipts rendered all views without reloading. Both source-level completion orders now pass, and disposed views remain excluded. No paid tools or customer data were used.

Some unmodified first-load runs passed too: this is a timing-sensitive failure, and ordinary successful retries do not prove it fixed. The controlled race provides the regression. Additional host defects remain possible; this patch addresses the demonstrated obsolete-startup race.

## Delivery status

We reported the bug in [microsoft/vscode#335908](https://github.com/microsoft/vscode/issues/335908). Upstream fixed it in [microsoft/vscode#346646](https://github.com/microsoft/vscode/pull/346646) (commit `7a1fb57`), which ships in 1.147.0 and in Insiders from `d8e7b56`. The checker supports both the 1.135.0 layout and the newer one, which adds `generateUuid`, `hashParentOrigin` and `_mountDisposables`. On 2026-11-12 it failed on 1.135.0 and passed all four checks on 1.135.0 with this patch, on `7a1fb57`, and on `main`. Run it against a new upstream checkout to catch a regression of the guard.

The package itself does not modify installed editors. MCP 0.31.3 serves text and structured reports to VS Code builds below 1.147.0. See [UPSTREAM_ISSUES.md](../../UPSTREAM_ISSUES.md) for the scope, the override, the native verification still owed and the removal conditions.
