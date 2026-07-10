// RFC 9728 protected-resource metadata — how an MCP client discovers the
// authorization server for this endpoint. The metadata document lives at
// `/.well-known/oauth-protected-resource<path>` (and optionally the root alias).

export type ProtectedResourceMetadata = {
  authorization_servers: string[];
  resource: string;
  scopes_supported: string[];
};

export const protectedResourceMetadata = (input: {
  issuer: string;
  resource: string;
  scopes?: string[];
}): ProtectedResourceMetadata => ({
  authorization_servers: [input.issuer],
  resource: input.resource,
  scopes_supported: input.scopes ?? [],
});

/** The metadata document URL for an endpoint path, per RFC 9728 §3: the path is
 *  inserted after the well-known segment. `/mcp` → `/.well-known/oauth-protected-resource/mcp`. */
export const metadataPathFor = (path: string) =>
  `/.well-known/oauth-protected-resource${path}`;
