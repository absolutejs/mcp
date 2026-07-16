export type McpProtectedResourceMetadata = {
  resource: string;
  authorization_servers: string[];
  scopes_supported?: string[];
  bearer_methods_supported?: string[];
  resource_name?: string;
  resource_documentation?: string;
};

export type McpAuthorizationServerMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
  dpop_signing_alg_values_supported?: string[];
  client_id_metadata_document_supported?: boolean;
};

export type McpOAuthTokens = {
  accessToken: string;
  tokenType: "Bearer" | "DPoP";
  expiresAt?: number;
  refreshToken?: string;
  scopes: string[];
  resource: string;
};

export type McpOAuthTokenStore = {
  load(resource: string): Promise<McpOAuthTokens | undefined>;
  save(tokens: McpOAuthTokens): Promise<void>;
  remove(resource: string): Promise<void>;
};

export type McpAuthorizationChallenge = {
  scheme: string;
  resourceMetadataUrl?: string;
  scopes: string[];
  error?: string;
};

export type McpOAuthDiscovery = {
  resource: McpProtectedResourceMetadata;
  authorizationServer: McpAuthorizationServerMetadata;
  resourceMetadataUrl: string;
};

export type McpAuthorizationProvider = {
  headers(context: {
    method: string;
    url: string;
  }): Promise<Record<string, string>> | Record<string, string>;
  onUnauthorized?(context: {
    method: string;
    response: Response;
    url: string;
  }): Promise<boolean> | boolean;
};

export type McpOAuthInteractiveRequest = {
  authorizationUrl: string;
  state: string;
  scopes: readonly string[];
  resource: string;
};

export type McpOAuthOptions = {
  clientId: string;
  redirectUri: string;
  store: McpOAuthTokenStore;
  fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
  onAuthorize(
    request: McpOAuthInteractiveRequest,
  ): Promise<{ code: string; state: string }>;
  scopes?: string[];
  createDpopProof?: (input: {
    accessToken?: string;
    method: string;
    url: string;
  }) => Promise<string>;
  now?: () => number;
  maxMetadataBytes?: number;
};

const splitChallenges = (value: string) => {
  const entries: string[] = [];
  let quoted = false;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"' && value[index - 1] !== "\\") quoted = !quoted;
    if (character === "," && !quoted) {
      entries.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  entries.push(value.slice(start).trim());
  return entries;
};

export const parseMcpAuthorizationChallenge = (
  value: string | null,
): McpAuthorizationChallenge | undefined => {
  if (!value) return undefined;
  const firstSpace = value.indexOf(" ");
  const scheme = firstSpace < 0 ? value : value.slice(0, firstSpace);
  if (scheme.toLowerCase() !== "bearer" && scheme.toLowerCase() !== "dpop")
    return undefined;
  const parameters = new Map<string, string>();
  for (const entry of splitChallenges(
    firstSpace < 0 ? "" : value.slice(firstSpace + 1),
  )) {
    const separator = entry.indexOf("=");
    if (separator < 1) continue;
    const key = entry.slice(0, separator).trim().toLowerCase();
    const raw = entry.slice(separator + 1).trim();
    parameters.set(
      key,
      raw.startsWith('"') && raw.endsWith('"')
        ? raw.slice(1, -1).replaceAll('\\"', '"')
        : raw,
    );
  }
  return {
    scheme,
    resourceMetadataUrl: parameters.get("resource_metadata"),
    scopes: parameters.get("scope")?.split(" ").filter(Boolean) ?? [],
    error: parameters.get("error"),
  };
};

const endpointMetadataPath = (endpoint: URL) =>
  `/.well-known/oauth-protected-resource${endpoint.pathname === "/" ? "" : endpoint.pathname}`;

const fetchJson = async <Value>(
  url: string,
  fetcher: McpOAuthOptions["fetch"],
  maxBytes: number,
): Promise<Value> => {
  const target = new URL(url);
  if (target.protocol !== "https:")
    throw new Error("OAuth metadata requires HTTPS");
  const response = await fetcher(target, {
    headers: { accept: "application/json" },
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(`OAuth metadata discovery failed with ${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new Error("OAuth metadata exceeds byte limit");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes)
    throw new Error("OAuth metadata exceeds byte limit");
  return JSON.parse(new TextDecoder().decode(bytes)) as Value;
};

export const discoverMcpAuthorization = async ({
  endpoint,
  fetch: fetcher,
  resourceMetadataUrl,
  maxMetadataBytes = 64 * 1024,
}: {
  endpoint: string;
  fetch: McpOAuthOptions["fetch"];
  resourceMetadataUrl?: string;
  maxMetadataBytes?: number;
}): Promise<McpOAuthDiscovery> => {
  const target = new URL(endpoint);
  const resourceUrl =
    resourceMetadataUrl ??
    new URL(endpointMetadataPath(target), target.origin).toString();
  const resource = await fetchJson<McpProtectedResourceMetadata>(
    resourceUrl,
    fetcher,
    maxMetadataBytes,
  );
  if (resource.resource !== endpoint)
    throw new Error(
      "Protected resource metadata has the wrong resource identifier",
    );
  const issuer = resource.authorization_servers?.[0];
  if (!issuer)
    throw new Error("Protected resource metadata has no authorization server");
  const issuerUrl = new URL(issuer);
  if (issuerUrl.protocol !== "https:")
    throw new Error("Authorization server issuer requires HTTPS");
  const candidates = [
    new URL("/.well-known/oauth-authorization-server", issuerUrl).toString(),
    new URL("/.well-known/openid-configuration", issuerUrl).toString(),
  ];
  let authorizationServer: McpAuthorizationServerMetadata | undefined;
  for (const candidate of candidates) {
    try {
      const metadata = await fetchJson<McpAuthorizationServerMetadata>(
        candidate,
        fetcher,
        maxMetadataBytes,
      );
      if (metadata.issuer === issuer) {
        authorizationServer = metadata;
        break;
      }
    } catch {
      // Try the other standards-defined discovery document.
    }
  }
  if (!authorizationServer)
    throw new Error("Authorization server discovery failed");
  return { resource, authorizationServer, resourceMetadataUrl: resourceUrl };
};

const random = (bytes = 32) =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString(
    "base64url",
  );
const challengeFor = async (verifier: string) =>
  Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  ).toString("base64url");

export const createMcpAuthorizationRequest = async ({
  discovery,
  clientId,
  redirectUri,
  scopes,
}: {
  discovery: McpOAuthDiscovery;
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
}) => {
  if (
    !discovery.authorizationServer.code_challenge_methods_supported?.includes(
      "S256",
    )
  )
    throw new Error("Authorization server does not advertise PKCE S256");
  const codeVerifier = random(48);
  const state = random(24);
  const url = new URL(discovery.authorizationServer.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code_challenge", await challengeFor(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", discovery.resource.resource);
  url.searchParams.set("state", state);
  if (scopes.length) url.searchParams.set("scope", scopes.join(" "));
  return { authorizationUrl: url.toString(), codeVerifier, state };
};

const parseTokens = (
  value: unknown,
  resource: string,
  now: number,
): McpOAuthTokens => {
  if (!value || typeof value !== "object")
    throw new Error("Malformed OAuth token response");
  const body = value as Record<string, unknown>;
  if (typeof body.access_token !== "string")
    throw new Error("OAuth response has no access token");
  return {
    accessToken: body.access_token,
    tokenType: body.token_type === "DPoP" ? "DPoP" : "Bearer",
    ...(typeof body.expires_in === "number"
      ? { expiresAt: now + body.expires_in * 1000 }
      : {}),
    ...(typeof body.refresh_token === "string"
      ? { refreshToken: body.refresh_token }
      : {}),
    scopes:
      typeof body.scope === "string"
        ? body.scope.split(" ").filter(Boolean)
        : [],
    resource,
  };
};

const tokenRequest = async ({
  endpoint,
  fetch: fetcher,
  params,
  dpopProof,
  now,
  resource,
}: {
  endpoint: string;
  fetch: McpOAuthOptions["fetch"];
  params: URLSearchParams;
  dpopProof?: string;
  now: number;
  resource: string;
}) => {
  const response = await fetcher(endpoint, {
    method: "POST",
    redirect: "error",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(dpopProof ? { dpop: dpopProof } : {}),
    },
    body: params.toString(),
  });
  if (!response.ok)
    throw new Error(`OAuth token exchange failed with ${response.status}`);
  return parseTokens(await response.json(), resource, now);
};

export const createMemoryMcpOAuthTokenStore = (): McpOAuthTokenStore => {
  const tokens = new Map<string, McpOAuthTokens>();
  return {
    load: async (resource) => tokens.get(resource),
    save: async (value) => {
      tokens.set(value.resource, structuredClone(value));
    },
    remove: async (resource) => {
      tokens.delete(resource);
    },
  };
};

export const createMcpOAuthProvider = (
  options: McpOAuthOptions & { endpoint: string },
): McpAuthorizationProvider => {
  const now = options.now ?? Date.now;
  let discovery: McpOAuthDiscovery | undefined;
  const ensureDiscovery = async (metadataUrl?: string) =>
    (discovery ??= await discoverMcpAuthorization({
      endpoint: options.endpoint,
      fetch: options.fetch,
      resourceMetadataUrl: metadataUrl,
      maxMetadataBytes: options.maxMetadataBytes,
    }));

  const refresh = async (tokens: McpOAuthTokens) => {
    if (!tokens.refreshToken) return false;
    const found = await ensureDiscovery();
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      client_id: options.clientId,
      resource: found.resource.resource,
    });
    if (tokens.scopes.length) params.set("scope", tokens.scopes.join(" "));
    const proof = await options.createDpopProof?.({
      method: "POST",
      url: found.authorizationServer.token_endpoint,
    });
    const next = await tokenRequest({
      endpoint: found.authorizationServer.token_endpoint,
      fetch: options.fetch,
      params,
      dpopProof: proof,
      now: now(),
      resource: found.resource.resource,
    });
    await options.store.save({
      ...next,
      refreshToken: next.refreshToken ?? tokens.refreshToken,
    });
    return true;
  };

  return {
    headers: async ({ method, url }) => {
      let tokens = await options.store.load(options.endpoint);
      if (!tokens) return {};
      if (tokens.expiresAt !== undefined && tokens.expiresAt <= now() + 5_000) {
        if (!(await refresh(tokens))) return {};
        tokens = await options.store.load(options.endpoint);
        if (!tokens) return {};
      }
      const headers: Record<string, string> = {
        authorization: `${tokens.tokenType} ${tokens.accessToken}`,
      };
      const proof = await options.createDpopProof?.({
        accessToken: tokens.accessToken,
        method,
        url,
      });
      if (proof) headers.dpop = proof;
      return headers;
    },
    onUnauthorized: async ({ response }) => {
      const challenge = parseMcpAuthorizationChallenge(
        response.headers.get("www-authenticate"),
      );
      const found = await ensureDiscovery(challenge?.resourceMetadataUrl);
      const existing = await options.store.load(found.resource.resource);
      if (existing?.refreshToken && (await refresh(existing))) return true;
      const scopes = [
        ...new Set([...(options.scopes ?? []), ...(challenge?.scopes ?? [])]),
      ];
      const request = await createMcpAuthorizationRequest({
        discovery: found,
        clientId: options.clientId,
        redirectUri: options.redirectUri,
        scopes,
      });
      const result = await options.onAuthorize({
        authorizationUrl: request.authorizationUrl,
        state: request.state,
        scopes,
        resource: found.resource.resource,
      });
      if (result.state !== request.state)
        throw new Error("OAuth state mismatch");
      const params = new URLSearchParams({
        grant_type: "authorization_code",
        code: result.code,
        client_id: options.clientId,
        redirect_uri: options.redirectUri,
        code_verifier: request.codeVerifier,
        resource: found.resource.resource,
      });
      const proof = await options.createDpopProof?.({
        method: "POST",
        url: found.authorizationServer.token_endpoint,
      });
      const tokens = await tokenRequest({
        endpoint: found.authorizationServer.token_endpoint,
        fetch: options.fetch,
        params,
        dpopProof: proof,
        now: now(),
        resource: found.resource.resource,
      });
      await options.store.save(tokens);
      return true;
    },
  };
};
