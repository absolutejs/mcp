// A standard OAuth bearer check for MCP access tokens. This is a convenience
// the host calls from its `authorize` — the package never verifies tokens
// itself, so you can use any authorization server (or none). You supply the
// signature `verify`; this adds the claim checks every MCP endpoint needs.

import { isRecord } from "./guards";

const MS_PER_SECOND = 1000;

/** The decoded JWT, as returned by your `verify`. Only `payload` is read. */
export type VerifiedJwt = { header?: unknown; payload: unknown };

export type BearerVerifier = (
  token: string,
) => Promise<VerifiedJwt | undefined> | VerifiedJwt | undefined;

export type VerifyBearerConfig = {
  issuer: string;
  request: Request;
  /** Verify the JWT signature and decode it (e.g. `@absolutejs/auth`'s
   *  `verifyJwt`). Return undefined on an invalid signature. */
  verify: BearerVerifier;
  requiredScope?: string;
};

export type BearerResult =
  | { error: string }
  | {
      payload: Record<string, unknown>;
      scopes: string[];
      subject: string;
    };

/** Verify the `Authorization: Bearer` token: signature (via your `verify`),
 *  `token_use: access`, issuer, expiry, the required scope, and a subject.
 *  Returns the decoded payload + parsed scopes + subject, or a reason string.
 *  The reason is safe to surface in the 401 (never why the signature failed). */
export const verifyBearer = async (
  config: VerifyBearerConfig,
): Promise<BearerResult> => {
  const { issuer, request, verify, requiredScope } = config;
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return { error: "Missing bearer token" };
  const verified = await verify(header.slice("Bearer ".length));
  if (!verified || !isRecord(verified.payload))
    return { error: "Invalid token" };
  const { payload } = verified;
  if (payload.token_use !== "access") return { error: "Not an access token" };
  if (payload.iss !== issuer) return { error: "Wrong issuer" };
  const expires = typeof payload.exp === "number" ? payload.exp : 0;
  if (expires * MS_PER_SECOND <= Date.now()) return { error: "Token expired" };
  const scopes =
    typeof payload.scope === "string" ? payload.scope.split(" ") : [];
  if (requiredScope !== undefined && !scopes.includes(requiredScope)) {
    return { error: `Token lacks the ${requiredScope} scope` };
  }
  const subject = typeof payload.sub === "string" ? payload.sub : "";
  if (!subject) return { error: "Token has no subject" };

  return { payload, scopes, subject };
};
