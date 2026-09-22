import path from "node:path";

import { platformDir, readJsonIfExists, writeJsonArtifact } from "../store.js";
import type { LocalRole } from "../types.js";
import { resolveRepoRoot } from "../../utils/path.js";

export interface LocalAuthConfig {
  /** Local-only roles map. Not a cloud IdP. */
  users: Array<{ id: string; role: LocalRole }>;
  defaultRole: LocalRole;
}

const DEFAULT_CONFIG: LocalAuthConfig = {
  defaultRole: "readonly",
  users: [
    { id: "local-admin", role: "admin" },
    { id: "local-developer", role: "developer" },
    { id: "local-reviewer", role: "reviewer" },
    { id: "local-auditor", role: "auditor" },
  ],
};

const ROLE_RANK: Record<LocalRole, number> = {
  readonly: 0,
  auditor: 1,
  developer: 2,
  reviewer: 3,
  admin: 4,
};

export async function loadLocalAuthConfig(root: string): Promise<LocalAuthConfig> {
  const file = path.join(platformDir(root), "auth.json");
  const existing = await readJsonIfExists<LocalAuthConfig>(file);
  if (existing?.users && existing.defaultRole) return existing;
  await writeJsonArtifact(resolveRepoRoot(root), "auth.json", DEFAULT_CONFIG);
  return DEFAULT_CONFIG;
}

export function resolveRole(config: LocalAuthConfig, userId?: string): LocalRole {
  if (!userId) return config.defaultRole;
  return config.users.find((u) => u.id === userId)?.role ?? config.defaultRole;
}

export function roleAtLeast(role: LocalRole, required: LocalRole): boolean {
  return (ROLE_RANK[role] ?? 0) >= (ROLE_RANK[required] ?? 0);
}

/** Permission matrix for local dashboard/API (no network auth; spoofable via local config). */
export function canAccess(
  role: LocalRole,
  resource:
    | "read-findings"
    | "manage-policies"
    | "approve-actions"
    | "read-audit"
    | "export-reports"
    | "admin-settings",
): boolean {
  switch (resource) {
    case "read-findings":
      return roleAtLeast(role, "readonly");
    case "read-audit":
      return roleAtLeast(role, "auditor");
    case "export-reports":
      return roleAtLeast(role, "developer");
    case "approve-actions":
      return roleAtLeast(role, "reviewer");
    case "manage-policies":
      return roleAtLeast(role, "admin");
    case "admin-settings":
      return role === "admin";
    default:
      return false;
  }
}

export async function ensureAuthConfig(root: string): Promise<string> {
  await loadLocalAuthConfig(root);
  return path.join(platformDir(root), "auth.json");
}
