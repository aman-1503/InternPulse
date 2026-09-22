/**
 * Opt-in network test against the REAL Cloudflare Access team JWKS endpoint.
 * Skipped by default (and therefore safe in CI / offline dev) — run with your
 * real config supplied via env (never hardcoded here), e.g.:
 *
 *   INTERNPULSE_LIVE_ACCESS_TEST=1 ACCESS_TEAM_DOMAIN=<your-team>.cloudflareaccess.com \
 *     ACCESS_AUD=<your-application-aud> npx vitest run src/worker/access-auth.live.test.ts
 *
 * We can't mint a token Cloudflare's real private key would sign, so this
 * can't prove "a real login succeeds" — only a live human Access session can
 * do that. What it DOES prove, against production Cloudflare infrastructure
 * rather than a local mock: the JWKS URL resolves and returns real keys, and
 * a forged/garbage token is rejected via that same real endpoint (never
 * silently accepted because the network call failed open).
 */
import { describe, it, expect } from "vitest";
import { createRemoteJWKSet } from "jose";
import { AccessAuthError, verifyAccessAssertion } from "./access-auth";

const LIVE = process.env.INTERNPULSE_LIVE_ACCESS_TEST === "1";
const TEAM_DOMAIN = process.env.ACCESS_TEAM_DOMAIN;
const AUD = process.env.ACCESS_AUD;

describe.skipIf(!LIVE || !TEAM_DOMAIN || !AUD)("access-auth against the real Cloudflare Access JWKS", () => {
  it("fetches real signing keys from the configured team domain", async () => {
    const res = await fetch(`https://${TEAM_DOMAIN}/cdn-cgi/access/certs`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { keys: unknown[] };
    expect(Array.isArray(body.keys)).toBe(true);
    expect(body.keys.length).toBeGreaterThan(0);
  });

  it("rejects a forged/unsigned-by-us token via the real JWKS (fails closed, not open)", async () => {
    const jwks = createRemoteJWKSet(new URL(`https://${TEAM_DOMAIN}/cdn-cgi/access/certs`));
    await expect(
      verifyAccessAssertion("this-is-not-a-real-access-token", jwks, {
        issuer: `https://${TEAM_DOMAIN}`,
        audience: AUD,
      }),
    ).rejects.toThrow(AccessAuthError);
  });

  it("rejects a well-formed-but-unsigned JWT with the right claims shape", async () => {
    // header.payload with no valid signature segment at all.
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ email: "attacker@example.com", sub: "attacker", aud: AUD, iss: `https://${TEAM_DOMAIN}` }),
    ).toString("base64url");
    const jwks = createRemoteJWKSet(new URL(`https://${TEAM_DOMAIN}/cdn-cgi/access/certs`));
    await expect(
      verifyAccessAssertion(`${header}.${payload}.`, jwks, {
        issuer: `https://${TEAM_DOMAIN}`,
        audience: AUD,
      }),
    ).rejects.toThrow(AccessAuthError);
  });
});
