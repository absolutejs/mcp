import { expect, test } from "bun:test";
import { registeredMcpProfiles, registeredMcpCommerce } from "../src/registeredCommerce";
import { evaluateCommerce, type CommerceReview } from "../src/commerce";
const review: CommerceReview = { id: "native", profile: "direct-mcp", actions: ["paid_access", "external_checkout"], categories: ["usage_credits"], reviewedAt: "2026-09-13", expiresAt: "2026-10-13", sourceUrls: ["https://example.com/review"] };
const now = new Date("2026-09-14");
test("native registrations share reviewed policy without an account or client allowlist", () => {
  for (const uri of ["http://127.0.0.1:5137/callback", "http://localhost:5000/auth", "http://[::1]:5500/callback", "vscode://extension/callback", "https://vscode.dev/redirect"]) {
    const context = registeredMcpCommerce({ redirectUris: [uri], reviews: [review], capabilities: { externalLinks: true } });
    expect(evaluateCommerce({ action: "paid_access", categories: ["usage_credits"] }, context, now).allowed).toBe(true);
  }
});
test("host restrictions, unknown callbacks, mixed channels and review expiry remain enforced", () => {
  for (const uris of [[], ["https://localhost.attacker.test/callback"], ["https://claude.ai.attacker.test/auth"], ["https://user:password@localhost/auth"], ["javascript:alert(1)"]]) expect(registeredMcpProfiles(uris)).toEqual(["unknown"]);
  const mixed = registeredMcpCommerce({ redirectUris: ["http://localhost/callback", "https://chatgpt.com/connector/oauth"], reviews: [review], capabilities: { externalLinks: true } });
  expect(evaluateCommerce({ action: "external_checkout", categories: ["usage_credits"] }, mixed, now).allowed).toBe(false);
  const native = registeredMcpCommerce({ redirectUris: ["http://localhost/callback"], reviews: [review], capabilities: { externalLinks: true } });
  expect(evaluateCommerce({ action: "paid_access", categories: ["usage_credits"] }, native, new Date("2026-10-13")).allowed).toBe(false);
});
