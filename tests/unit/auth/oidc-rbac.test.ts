import { describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

import {
  LocalIdentityProvider,
  OidcIdentityProvider,
  hasRbacPermission,
} from "../../../src/auth/index.js";
import { MemoryStorageProvider } from "../../../src/storage/provider.js";

describe("auth OIDC + RBAC", () => {
  it("RBAC separates viewer from policy-admin", () => {
    expect(hasRbacPermission("viewer", "read-findings")).toBe(true);
    expect(hasRbacPermission("viewer", "manage-policies")).toBe(false);
    expect(hasRbacPermission("policy-admin", "manage-policies")).toBe(true);
    expect(hasRbacPermission("admin", "admin-settings")).toBe(true);
  });

  it("LocalIdentityProvider wraps team auth", async () => {
    const storage = new MemoryStorageProvider();
    const local = new LocalIdentityProvider({ root: "/tmp/ad-auth-local", storage });
    await local.register({ username: "alice", password: "password123", role: "admin" });
    const session = await local.login({ username: "alice", password: "password123" });
    const identity = await local.resolveIdentity({ token: session.token });
    expect(identity?.roles).toContain("admin");
    const bad = await local.resolveIdentity({ token: "nope" });
    expect(bad).toBeNull();
  });

  it("OidcIdentityProvider validates JWT with injected JWKS", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    jwk.kid = "test-key";
    jwk.alg = "RS256";
    jwk.use = "sig";
    const issuer = "https://idp.example.test/";
    const audience = "agentdoctor";
    const token = await new SignJWT({ roles: ["developer", "reviewer"], email: "dev@example.test" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject("user-1")
      .setIssuedAt()
      .setExpirationTime("2h")
      .setNotBefore("0s")
      .sign(privateKey);

    const oidc = new OidcIdentityProvider({
      issuer,
      audience,
      jwks: { keys: [jwk] },
    });
    const claims = await oidc.resolveIdentity({ token });
    expect(claims?.subject).toBe("user-1");
    expect(claims?.roles).toEqual(expect.arrayContaining(["developer", "reviewer"]));
    expect(await oidc.authorizePermission(claims!, "export-reports")).toBe(true);

    const bad = await oidc.resolveIdentity({ token: "not.a.jwt" });
    expect(bad).toBeNull();
  });

  it("rejects expired OIDC tokens", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    jwk.kid = "exp-key";
    jwk.alg = "RS256";
    const issuer = "https://idp.example.test/";
    const token = await new SignJWT({ roles: ["admin"] })
      .setProtectedHeader({ alg: "RS256", kid: "exp-key" })
      .setIssuer(issuer)
      .setAudience("agentdoctor")
      .setSubject("user-exp")
      .setExpirationTime("-1h")
      .sign(privateKey);
    const oidc = new OidcIdentityProvider({
      issuer,
      audience: "agentdoctor",
      jwks: { keys: [jwk] },
    });
    expect(await oidc.resolveIdentity({ token })).toBeNull();
  });
});
