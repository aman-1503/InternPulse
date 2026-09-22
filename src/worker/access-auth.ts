/**
 * Cloudflare Access identity verification — the sole source of production
 * authentication. This module answers exactly one question: "who is the
 * verified human behind this request?" It never touches D1 and knows nothing
 * about workspace roles; see production-identity.ts for that layer.
 *
 * Cloudflare Access sits in front of the whole hostname once configured. For
 * an authenticated browser session (cookie-based) Access validates the
 * session at the edge and forwards the request to the Worker with a signed
 * `Cf-Access-Jwt-Assertion` header attached — this happens for ordinary HTTP
 * requests AND for WebSocket upgrade requests (the browser WebSocket API
 * can't set custom headers, but it doesn't need to: Access authenticates the
 * handshake using the existing session cookie and injects the header before
 * the request reaches this Worker).
 *
 * We verify the JWT ourselves (signature, issuer, audience, expiry) rather
 * than trusting the header's mere presence, per Cloudflare's documented
 * approach: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 */
import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from "jose";

export interface AccessIdentity {
  /** Stable per-identity subject claim (`sub`) from the Access JWT. */
  subject: string;
  email: string;
  name?: string;
  identityProvider?: string;
}

export class AccessAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessAuthError";
  }
}

/**
 * Pure verification step, factored out so it can be unit-tested against a
 * local JWKS without any network access — see access-auth.test.ts.
 */
export async function verifyAccessAssertion(
  token: string | null | undefined,
  getKey: JWTVerifyGetKey,
  opts: { issuer: string; audience: string },
): Promise<AccessIdentity> {
  if (!token) throw new AccessAuthError("missing Cf-Access-Jwt-Assertion header");

  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, getKey, {
      issuer: opts.issuer,
      audience: opts.audience,
    }));
  } catch (err) {
    throw new AccessAuthError(`invalid Access assertion: ${(err as Error).message}`);
  }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : undefined;
  const subject = typeof payload.sub === "string" ? payload.sub : undefined;
  if (!email || !subject) {
    throw new AccessAuthError("Access assertion is missing required email/sub claims");
  }

  return {
    subject,
    email,
    name: typeof payload.name === "string" ? payload.name : undefined,
    identityProvider: typeof payload.idp === "string" ? payload.idp : undefined,
  };
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function remoteJwks(teamDomain: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksCache.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, jwks);
  }
  return jwks;
}

/**
 * Verifies the current request's Access assertion against the configured
 * team domain + Application AUD. Throws AccessAuthError on any failure —
 * missing config, missing header, bad signature, wrong issuer/audience,
 * expired token. Never returns a partial/unverified identity.
 */
export async function getAuthenticatedIdentity(request: Request, env: Env): Promise<AccessIdentity> {
  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  if (!teamDomain || !aud) {
    throw new AccessAuthError("Cloudflare Access is not configured (ACCESS_TEAM_DOMAIN / ACCESS_AUD)");
  }
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  return verifyAccessAssertion(token, remoteJwks(teamDomain), {
    issuer: `https://${teamDomain}`,
    audience: aud,
  });
}
