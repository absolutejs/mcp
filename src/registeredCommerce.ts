import type { CommerceContext, CommerceProfile, CommerceReview } from "./commerce";
/** Classify the callback channel from the authenticated OAuth registration.
 * This identifies a transport/distribution shape, not a verified vendor or plan.
 * Never pass tool arguments, clientInfo names, or unbound request metadata. */
export const registeredMcpProfiles = (redirectUris: readonly string[]): CommerceProfile[] => {
  if (!redirectUris.length) return ["unknown"];
  const classify = (value: string): CommerceProfile => {
    try {
      const url = new URL(value);
      if (url.username || url.password) return "unknown";
      if (url.protocol === "https:" && ["claude.ai", "claude.com"].includes(url.hostname)) return "claude-interactive";
      if (url.protocol === "https:" && ["chatgpt.com", "chat.openai.com"].includes(url.hostname)) return "chatgpt-plugin";
      if (["http:", "https:"].includes(url.protocol) && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)) return "direct-mcp";
      if (["vscode:", "vscode-insiders:", "cursor:", "windsurf:"].includes(url.protocol)) return "direct-mcp";
      if (["https://vscode.dev", "https://insiders.vscode.dev"].includes(url.origin) && url.pathname === "/redirect") return "direct-mcp";
      return "unknown";
    } catch { return "unknown"; }
  };
  return [...new Set(redirectUris.map(classify))];
};
/** Every authenticated account shares deployment policy; account ownership and
 * available credit checks remain separate. Mixed callback profiles intersect. */
export const registeredMcpCommerce = (options: {
  redirectUris: readonly string[];
  reviews: readonly CommerceReview[];
  capabilities?: CommerceContext["capabilities"];
}): CommerceContext => ({
  profiles: registeredMcpProfiles(options.redirectUris),
  reviews: options.reviews,
  capabilities: options.capabilities,
});
