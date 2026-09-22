/**
 * Role-based access control for AgentDoctor surfaces.
 * Not enterprise SSO — roles are applied after a verified identity (local session or OIDC JWT).
 */

export type RbacRole = "viewer" | "developer" | "reviewer" | "policy-admin" | "admin";

export type RbacPermission =
  | "read-findings"
  | "read-audit"
  | "export-reports"
  | "approve-actions"
  | "manage-policies"
  | "admin-settings";

export const RBAC_ROLE_RANK: Record<RbacRole, number> = {
  viewer: 1,
  developer: 2,
  reviewer: 3,
  "policy-admin": 4,
  admin: 5,
};

const PERMISSION_MIN_ROLE: Record<RbacPermission, RbacRole> = {
  "read-findings": "viewer",
  "read-audit": "viewer",
  "export-reports": "developer",
  "approve-actions": "reviewer",
  "manage-policies": "policy-admin",
  "admin-settings": "admin",
};

export function hasRbacPermission(role: RbacRole, permission: RbacPermission): boolean {
  const required = PERMISSION_MIN_ROLE[permission];
  return (RBAC_ROLE_RANK[role] ?? 0) >= (RBAC_ROLE_RANK[required] ?? 99);
}

export function roleAtLeast(role: RbacRole, required: RbacRole): boolean {
  return (RBAC_ROLE_RANK[role] ?? 0) >= (RBAC_ROLE_RANK[required] ?? 99);
}
