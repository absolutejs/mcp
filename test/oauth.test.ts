import { describe, expect, test } from "bun:test";
import {
  createMcpAuthorizationRequest,
  createMcpOAuthProvider,
  createMemoryMcpOAuthTokenStore,
  discoverMcpAuthorization,
  parseMcpAuthorizationChallenge,
} from "../src";

const endpoint = "https://tools.example/mcp";
const resourceMetadata = {
  resource: endpoint,
  authorization_servers: ["https://auth.example"],
  scopes_supported: ["tools.read", "tools.write"],
};
const serverMetadata = {
  issuer: "https://auth.example",
  authorization_endpoint: "https://auth.example/oauth2/authorize",
  token_endpoint: "https://auth.example/oauth2/token",
  code_challenge_methods_supported: ["S256"],
  client_id_metadata_document_supported: true,
};

describe("MCP OAuth client", () => {
  test("parses RFC 9728 incremental scope challenges", () => {
    expect(
      parseMcpAuthorizationChallenge(
        'Bearer resource_metadata="https://tools.example/meta", scope="tools.write", error="insufficient_scope"',
      ),
    ).toEqual({
      scheme: "Bearer",
      resourceMetadataUrl: "https://tools.example/meta",
      scopes: ["tools.write"],
      error: "insufficient_scope",
    });
  });

  test("discovers PRM and creates a resource-bound PKCE request", async () => {
    const fetcher = async (input: string | URL) => {
      const url = String(input);
      if (url.includes("oauth-protected-resource"))
        return new Response(JSON.stringify(resourceMetadata));
      if (url.includes("oauth-authorization-server"))
        return new Response(JSON.stringify(serverMetadata));
      return new Response("missing", { status: 404 });
    };
    const discovery = await discoverMcpAuthorization({
      endpoint,
      fetch: fetcher,
    });
    const request = await createMcpAuthorizationRequest({
      discovery,
      clientId: "https://client.example/oauth.json",
      redirectUri: "https://client.example/callback",
      scopes: ["tools.read"],
    });
    const url = new URL(request.authorizationUrl);
    expect(url.searchParams.get("resource")).toBe(endpoint);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  test("completes authorization on 401 and emits stored bearer headers", async () => {
    const store = createMemoryMcpOAuthTokenStore();
    const fetcher = async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("oauth-protected-resource"))
        return new Response(JSON.stringify(resourceMetadata));
      if (url.includes("oauth-authorization-server"))
        return new Response(JSON.stringify(serverMetadata));
      if (url.endsWith("/oauth2/token")) {
        expect(String(init?.body)).toContain(
          "resource=https%3A%2F%2Ftools.example%2Fmcp",
        );
        return Response.json({
          access_token: "access",
          token_type: "Bearer",
          expires_in: 300,
          scope: "tools.read tools.write",
        });
      }
      return new Response("missing", { status: 404 });
    };
    const provider = createMcpOAuthProvider({
      endpoint,
      clientId: "https://client.example/oauth.json",
      redirectUri: "https://client.example/callback",
      store,
      fetch: fetcher,
      scopes: ["tools.read"],
      onAuthorize: async ({ state }) => ({ code: "code", state }),
    });
    const retry = await provider.onUnauthorized?.({
      method: "POST",
      url: endpoint,
      response: new Response(null, {
        status: 401,
        headers: {
          "www-authenticate":
            'Bearer resource_metadata="https://tools.example/.well-known/oauth-protected-resource/mcp", scope="tools.write"',
        },
      }),
    });
    expect(retry).toBe(true);
    expect(await provider.headers({ method: "POST", url: endpoint })).toEqual({
      authorization: "Bearer access",
    });
  });
});
