import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import type { StorageProvider } from "../contracts/index.js";
import { FilesystemStorageProvider } from "../storage/provider.js";

export type TeamRole = "owner" | "admin" | "member" | "viewer";

export interface TeamUser {
  id: string;
  username: string;
  passwordHash: string;
  salt: string;
  role: TeamRole;
  createdAt: string;
  /** Development-only local auth — not enterprise SSO. */
  authMode: "local-dev";
}

export interface SessionToken {
  token: string;
  userId: string;
  expiresAt: string;
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString("hex");
}

export async function registerLocalDevUser(options: {
  root: string;
  username: string;
  password: string;
  role?: TeamRole;
  storage?: StorageProvider;
}): Promise<TeamUser> {
  if (options.password.length < 8) throw new Error("password must be at least 8 characters");
  const storage =
    options.storage ?? new FilesystemStorageProvider(options.root, ".agentdoctor/team");
  const salt = randomBytes(16).toString("hex");
  const user: TeamUser = {
    id: `user_${createHash("sha256").update(options.username).digest("hex").slice(0, 10)}`,
    username: options.username,
    passwordHash: hashPassword(options.password, salt),
    salt,
    role: options.role ?? "member",
    createdAt: new Date().toISOString(),
    authMode: "local-dev",
  };
  await storage.set(`users/${user.id}.json`, `${JSON.stringify(user, null, 2)}\n`);
  return {
    ...user,
    passwordHash: "[REDACTED]",
    salt: "[REDACTED]",
  };
}

export async function authenticateLocalDev(options: {
  root: string;
  username: string;
  password: string;
  storage?: StorageProvider;
}): Promise<SessionToken> {
  const storage =
    options.storage ?? new FilesystemStorageProvider(options.root, ".agentdoctor/team");
  const keys = await storage.list("users");
  for (const key of keys) {
    const raw = await storage.get(key.startsWith("users/") ? key : `users/${key}`);
    if (!raw) continue;
    const user = JSON.parse(raw) as TeamUser;
    if (user.username !== options.username) continue;
    const next = hashPassword(options.password, user.salt);
    const a = Buffer.from(next, "hex");
    const b = Buffer.from(user.passwordHash, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) break;
    const token = randomBytes(24).toString("hex");
    const session: SessionToken = {
      token,
      userId: user.id,
      expiresAt: new Date(Date.now() + 8 * 3600_000).toISOString(),
    };
    await storage.set(`sessions/${token}.json`, `${JSON.stringify(session, null, 2)}\n`);
    return session;
  }
  throw new Error("invalid credentials");
}

export async function authorize(
  root: string,
  token: string,
  minRole: TeamRole,
  storage?: StorageProvider,
): Promise<{ ok: boolean; user?: TeamUser; reason: string }> {
  const store = storage ?? new FilesystemStorageProvider(root, ".agentdoctor/team");
  const raw = await store.get(`sessions/${token}.json`);
  if (!raw) return { ok: false, reason: "missing session" };
  const session = JSON.parse(raw) as SessionToken;
  if (Date.parse(session.expiresAt) < Date.now()) return { ok: false, reason: "expired session" };
  const userRaw = await store.get(`users/${session.userId}.json`);
  if (!userRaw) return { ok: false, reason: "missing user" };
  const user = JSON.parse(userRaw) as TeamUser;
  const rank: Record<TeamRole, number> = { viewer: 1, member: 2, admin: 3, owner: 4 };
  if ((rank[user.role] ?? 0) < (rank[minRole] ?? 99)) {
    return { ok: false, reason: "insufficient role", user };
  }
  return { ok: true, user, reason: "authorized" };
}
