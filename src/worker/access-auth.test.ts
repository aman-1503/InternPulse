import { describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JWTVerifyGetKey } from "jose";
import { AccessAuthError, verifyAccessAssertion } from "./access-auth";

const ISSUER = "https://test-team.cloudflareaccess.com";
const AUDIENCE = "test-application-aud";

async function makeKeys() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  const jwks: JWTVerifyGetKey = createLocalJWKSet({ keys: [jwk] });
  return { privateKey, jwks };
}

async function signToken(
  privateKey: CryptoKey,
  overrides: Partial<{
    sub: string;
    email: string;
    name: string;
    idp: string;
    iss: string;
    aud: string;
    expiresIn: string;
  }> = {},
): Promise<string> {
  const builder = new SignJWT({
    email: overrides.email ?? "alice@example.com",
    name: overrides.name,
    idp: overrides.idp,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setSubject(overrides.sub ?? "access-subject-alice")
    .setIssuedAt()
    .setIssuer(overrides.iss ?? ISSUER)
    .setAudience(overrides.aud ?? AUDIENCE)
    .setExpirationTime(overrides.expiresIn ?? "5m");
  return builder.sign(privateKey);
}

describe("verifyAccessAssertion", () => {
  it("accepts a validly signed token for the configured issuer/audience", async () => {
    const { privateKey, jwks } = await makeKeys();
    const token = await signToken(privateKey, { name: "Alice Intern" });
    const identity = await verifyAccessAssertion(token, jwks, { issuer: ISSUER, audience: AUDIENCE });
    expect(identity).toEqual({
      subject: "access-subject-alice",
      email: "alice@example.com",
      name: "Alice Intern",
      identityProvider: undefined,
    });
  });

  it("rejects a missing token", async () => {
    const { jwks } = await makeKeys();
    await expect(verifyAccessAssertion(null, jwks, { issuer: ISSUER, audience: AUDIENCE })).rejects.toThrow(
      AccessAuthError,
    );
  });

  it("rejects a malformed token", async () => {
    const { jwks } = await makeKeys();
    await expect(
      verifyAccessAssertion("not-a-jwt", jwks, { issuer: ISSUER, audience: AUDIENCE }),
    ).rejects.toThrow(AccessAuthError);
  });

  it("rejects an expired token", async () => {
    const { privateKey, jwks } = await makeKeys();
    const token = await signToken(privateKey, { expiresIn: "-1h" });
    await expect(verifyAccessAssertion(token, jwks, { issuer: ISSUER, audience: AUDIENCE })).rejects.toThrow(
      AccessAuthError,
    );
  });

  it("rejects the wrong audience", async () => {
    const { privateKey, jwks } = await makeKeys();
    const token = await signToken(privateKey, { aud: "some-other-application" });
    await expect(verifyAccessAssertion(token, jwks, { issuer: ISSUER, audience: AUDIENCE })).rejects.toThrow(
      AccessAuthError,
    );
  });

  it("rejects the wrong issuer", async () => {
    const { privateKey, jwks } = await makeKeys();
    const token = await signToken(privateKey, { iss: "https://someone-elses-team.cloudflareaccess.com" });
    await expect(verifyAccessAssertion(token, jwks, { issuer: ISSUER, audience: AUDIENCE })).rejects.toThrow(
      AccessAuthError,
    );
  });

  it("rejects a token signed by a different (forged) key", async () => {
    const { jwks } = await makeKeys();
    const forged = await generateKeyPair("RS256");
    // Signed with a key never published in `jwks` — simulates an attacker-forged assertion.
    const token = await new SignJWT({ email: "eve@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject("eve")
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime("5m")
      .sign(forged.privateKey);
    await expect(verifyAccessAssertion(token, jwks, { issuer: ISSUER, audience: AUDIENCE })).rejects.toThrow(
      AccessAuthError,
    );
  });

  it("rejects a token missing the email claim", async () => {
    const { privateKey, jwks } = await makeKeys();
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject("no-email-subject")
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime("5m")
      .sign(privateKey);
    await expect(verifyAccessAssertion(token, jwks, { issuer: ISSUER, audience: AUDIENCE })).rejects.toThrow(
      AccessAuthError,
    );
  });

  it("lowercases and trims the email claim", async () => {
    const { privateKey, jwks } = await makeKeys();
    const token = await signToken(privateKey, { email: "  Mia.Mentor@Example.com  ".trim() });
    const identity = await verifyAccessAssertion(token, jwks, { issuer: ISSUER, audience: AUDIENCE });
    expect(identity.email).toBe("mia.mentor@example.com");
  });
});
