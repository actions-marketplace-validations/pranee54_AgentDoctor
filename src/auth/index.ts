/**
 * Auth providers for AgentDoctor.
 *
 * Honesty:
 * - LocalIdentityProvider wraps local-dev team auth (scrypt) — not enterprise SSO.
 * - OidcIdentityProvider validates bearer JWTs (iss/aud/exp/nbf + JWKS) — IMPLEMENTED for the
 *   token-validation path. Full browser OAuth redirect / callback server is EXPERIMENTAL /
 *   incomplete and must not be claimed as production SSO.
 */

import {
  createRemoteJWKSet,
  jwtVerify,
  createLocalJWKSet,
  type JWTPayload,
  type JSONWebKeySet,
} from "jose";

import {
  authenticateLocalDev,
  authorize,
  registerLocalDevUser,
  type SessionToken,
  type TeamRole,
  type TeamUser,
} from "../team/auth.js";
import type { StorageProvider } from "../contracts/index.js";
import { hasRbacPermission, type RbacPermission, type RbacRole } from "./rbac.js";

export interface IdentityClaims {
  subject: string;
  email?: string;
  name?: string;
  roles: RbacRole[];
  issuer?: string;
  raw?: JWTPayload;
}

export interface IdentityProvider {
  readonly kind: "local" | "oidc";
  resolveIdentity(input: Record<string, unknown>): Promise<IdentityClaims | null>;
}

export class LocalIdentityProvider implements IdentityProvider {
  readonly kind = "local" as const;
  private readonly root: string;
  private readonly storage: StorageProvider | undefined;

  constructor(options: { root: string; storage?: StorageProvider }) {
    this.root = options.root;
    this.storage = options.storage;
  }

  async register(options: {
    username: string;
    password: string;
    role?: TeamRole;
  }): Promise<TeamUser> {
    return registerLocalDevUser({
      root: this.root,
      username: options.username,
      password: options.password,
      ...(options.role ? { role: options.role } : {}),
      ...(this.storage ? { storage: this.storage } : {}),
    });
  }

  async login(options: { username: string; password: string }): Promise<SessionToken> {
    return authenticateLocalDev({
      root: this.root,
      username: options.username,
      password: options.password,
      ...(this.storage ? { storage: this.storage } : {}),
    });
  }

  async authorizeSession(
    token: string,
    minRole: TeamRole,
  ): Promise<{ ok: boolean; user?: TeamUser; reason: string }> {
    return authorize(this.root, token, minRole, this.storage);
  }

  async resolveIdentity(input: Record<string, unknown>): Promise<IdentityClaims | null> {
    const token = typeof input.token === "string" ? input.token : null;
    if (!token) return null;
    const auth = await authorize(this.root, token, "viewer", this.storage);
    if (!auth.ok || !auth.user) return null;
    return {
      subject: auth.user.id,
      name: auth.user.username,
      roles: mapTeamRoleToRbac(auth.user.role),
    };
  }
}

function mapTeamRoleToRbac(role: TeamRole): RbacRole[] {
  switch (role) {
    case "owner":
    case "admin":
      return ["admin"];
    case "member":
      return ["developer"];
    case "viewer":
      return ["viewer"];
    default:
      return ["viewer"];
  }
}

export interface OidcIdentityProviderOptions {
  issuer: string;
  audience: string | string[];
  /**
   * Inject JWKS for unit tests / air-gapped validation.
   * When omitted, discovery/JWKS fetch is used (requires network / full_network).
   */
  jwks?: JSONWebKeySet;
  /** Override JWKS URI when not using discovery (optional). */
  jwksUri?: string;
  /** Map token claim (default: "roles") to RbacRole[]. */
  rolesClaim?: string;
  clockToleranceSec?: number;
}

/**
 * OIDC/JWT validation provider (jose).
 * IMPLEMENTED: signature + iss + aud + exp + nbf validation.
 * EXPERIMENTAL: browser OAuth authorization-code redirect / local callback server
 * is not a complete production SSO product in this package.
 */
export class OidcIdentityProvider implements IdentityProvider {
  readonly kind = "oidc" as const;
  private readonly issuer: string;
  private readonly audience: string | string[];
  private readonly rolesClaim: string;
  private readonly clockToleranceSec: number;
  private readonly getKey:
    ReturnType<typeof createLocalJWKSet> | ReturnType<typeof createRemoteJWKSet>;

  constructor(options: OidcIdentityProviderOptions) {
    this.issuer = options.issuer;
    this.audience = options.audience;
    this.rolesClaim = options.rolesClaim ?? "roles";
    this.clockToleranceSec = options.clockToleranceSec ?? 5;
    if (options.jwks) {
      this.getKey = createLocalJWKSet(options.jwks);
    } else {
      const uri =
        options.jwksUri ??
        new URL(
          "/.well-known/jwks.json",
          options.issuer.endsWith("/") ? options.issuer : `${options.issuer}/`,
        ).toString();
      this.getKey = createRemoteJWKSet(new URL(uri));
    }
  }

  async resolveIdentity(input: Record<string, unknown>): Promise<IdentityClaims | null> {
    const token = typeof input.token === "string" ? input.token : null;
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.getKey, {
        issuer: this.issuer,
        audience: this.audience,
        clockTolerance: this.clockToleranceSec,
      });
      const roles = normalizeRoles(payload[this.rolesClaim]);
      return {
        subject: String(payload.sub ?? ""),
        ...(typeof payload.email === "string" ? { email: payload.email } : {}),
        ...(typeof payload.name === "string" ? { name: payload.name } : {}),
        roles: roles.length > 0 ? roles : ["viewer"],
        issuer: typeof payload.iss === "string" ? payload.iss : this.issuer,
        raw: payload,
      };
    } catch {
      return null;
    }
  }

  async authorizePermission(claims: IdentityClaims, permission: RbacPermission): Promise<boolean> {
    return claims.roles.some((role) => hasRbacPermission(role, permission));
  }
}

function normalizeRoles(value: unknown): RbacRole[] {
  const allowed = new Set<RbacRole>(["viewer", "developer", "reviewer", "policy-admin", "admin"]);
  const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return list
    .map((v) => String(v).toLowerCase() as RbacRole)
    .filter((r): r is RbacRole => allowed.has(r));
}

export { hasRbacPermission, RBAC_ROLE_RANK, type RbacPermission, type RbacRole } from "./rbac.js";
