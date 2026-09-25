import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { atomicWriteTextFile } from "../utils/fs.js";
import { isPathInsideRoot, resolveRepoRoot } from "../utils/path.js";

export const WORKSPACE_SCHEMA_VERSION = "1.0.0" as const;

export interface WorkspaceModel {
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  id: string;
  name: string;
  /** Absolute, resolved repository roots that belong to this workspace. */
  repositoryRoots: string[];
  /**
   * When false (default), operations scoped to repo A must not read paths under repo B
   * even if both are members of the same workspace.
   */
  allowCrossRead: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspacePathAccess {
  allowed: boolean;
  reason: string;
  workspaceId?: string;
  requestedRoot?: string;
  targetRoot?: string;
}

function workspacesDir(controlRoot: string): string {
  return path.join(resolveRepoRoot(controlRoot), ".agentdoctor", "workspaces");
}

function workspaceFile(controlRoot: string, id: string): string {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
    throw new Error("invalid workspace id");
  }
  return path.join(workspacesDir(controlRoot), `${id}.json`);
}

function normalizeRoot(rootInput: string): string {
  return resolveRepoRoot(rootInput);
}

export async function initWorkspace(options: {
  controlRoot: string;
  name: string;
  repositoryRoot?: string;
  id?: string;
  allowCrossRead?: boolean;
}): Promise<WorkspaceModel> {
  const controlRoot = resolveRepoRoot(options.controlRoot);
  const id =
    options.id ??
    `ws_${createHash("sha256").update(`${options.name}:${randomUUID()}`).digest("hex").slice(0, 12)}`;
  const now = new Date().toISOString();
  const roots: string[] = [];
  if (options.repositoryRoot) {
    roots.push(normalizeRoot(options.repositoryRoot));
  }
  const model: WorkspaceModel = {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    id,
    name: options.name.trim() || id,
    repositoryRoots: roots,
    allowCrossRead: options.allowCrossRead === true,
    createdAt: now,
    updatedAt: now,
  };
  await fs.mkdir(workspacesDir(controlRoot), { recursive: true });
  const target = workspaceFile(controlRoot, id);
  try {
    await fs.access(target);
    throw new Error(`workspace already exists: ${id}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("workspace already exists")) {
      throw error;
    }
  }
  await atomicWriteTextFile(target, `${JSON.stringify(model, null, 2)}\n`);
  return model;
}

export async function loadWorkspace(
  controlRoot: string,
  id: string,
): Promise<WorkspaceModel | null> {
  try {
    const raw = await fs.readFile(workspaceFile(controlRoot, id), "utf8");
    const parsed = JSON.parse(raw) as WorkspaceModel;
    if (
      !parsed ||
      parsed.schemaVersion !== WORKSPACE_SCHEMA_VERSION ||
      !Array.isArray(parsed.repositoryRoots)
    ) {
      return null;
    }
    return {
      ...parsed,
      allowCrossRead: parsed.allowCrossRead === true,
      repositoryRoots: parsed.repositoryRoots.map((r) => normalizeRoot(r)),
    };
  } catch {
    return null;
  }
}

export async function listWorkspaces(controlRoot: string): Promise<WorkspaceModel[]> {
  const dir = workspacesDir(controlRoot);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: WorkspaceModel[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
    const ws = await loadWorkspace(controlRoot, id);
    if (ws) out.push(ws);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export async function addRepositoryToWorkspace(options: {
  controlRoot: string;
  workspaceId: string;
  repositoryRoot: string;
}): Promise<WorkspaceModel> {
  const ws = await loadWorkspace(options.controlRoot, options.workspaceId);
  if (!ws) throw new Error(`workspace not found: ${options.workspaceId}`);
  const root = normalizeRoot(options.repositoryRoot);
  if (!ws.repositoryRoots.includes(root)) {
    ws.repositoryRoots.push(root);
    ws.updatedAt = new Date().toISOString();
    await atomicWriteTextFile(
      workspaceFile(options.controlRoot, ws.id),
      `${JSON.stringify(ws, null, 2)}\n`,
    );
  }
  return ws;
}

export async function removeWorkspace(controlRoot: string, id: string): Promise<boolean> {
  try {
    await fs.unlink(workspaceFile(controlRoot, id));
    return true;
  } catch {
    return false;
  }
}

export async function workspaceStatus(
  controlRoot: string,
  id: string,
): Promise<{
  ok: boolean;
  workspace?: WorkspaceModel;
  missingRoots: string[];
  error?: string;
}> {
  const ws = await loadWorkspace(controlRoot, id);
  if (!ws) return { ok: false, missingRoots: [], error: "workspace not found" };
  const missingRoots: string[] = [];
  for (const root of ws.repositoryRoots) {
    try {
      const st = await fs.stat(root);
      if (!st.isDirectory()) missingRoots.push(root);
    } catch {
      missingRoots.push(root);
    }
  }
  return { ok: missingRoots.length === 0, workspace: ws, missingRoots };
}

/**
 * Isolation gate: a path may be read only when it is inside the operation's own
 * repositoryRoot, OR (allowCrossRead && both roots are members of the same workspace).
 */
export function assertWorkspacePathAccess(options: {
  workspace: WorkspaceModel | null;
  operationRoot: string;
  targetPath: string;
}): WorkspacePathAccess {
  const operationRoot = normalizeRoot(options.operationRoot);
  const target = path.resolve(options.targetPath);
  if (isPathInsideRoot(operationRoot, target)) {
    return {
      allowed: true,
      reason: "inside operation repository root",
      requestedRoot: operationRoot,
      targetRoot: operationRoot,
      ...(options.workspace ? { workspaceId: options.workspace.id } : {}),
    };
  }

  if (!options.workspace) {
    return {
      allowed: false,
      reason: "path outside operation root and no workspace context",
      requestedRoot: operationRoot,
    };
  }

  const members = options.workspace.repositoryRoots.map(normalizeRoot);
  if (!members.includes(operationRoot)) {
    return {
      allowed: false,
      reason: "operation root is not a member of the workspace",
      workspaceId: options.workspace.id,
      requestedRoot: operationRoot,
    };
  }

  const targetMember = members.find((root) => isPathInsideRoot(root, target));
  if (!targetMember) {
    return {
      allowed: false,
      reason: "target path is not under any workspace member root",
      workspaceId: options.workspace.id,
      requestedRoot: operationRoot,
    };
  }

  if (targetMember === operationRoot) {
    return {
      allowed: true,
      reason: "inside operation repository root",
      workspaceId: options.workspace.id,
      requestedRoot: operationRoot,
      targetRoot: targetMember,
    };
  }

  if (!options.workspace.allowCrossRead) {
    return {
      allowed: false,
      reason:
        "cross-repo read denied: target is under another workspace member and allowCrossRead=false",
      workspaceId: options.workspace.id,
      requestedRoot: operationRoot,
      targetRoot: targetMember,
    };
  }

  return {
    allowed: true,
    reason: "allowCrossRead enabled for same-workspace member",
    workspaceId: options.workspace.id,
    requestedRoot: operationRoot,
    targetRoot: targetMember,
  };
}

/**
 * Read a file only when workspace isolation allows it.
 */
export async function readFileWithinWorkspace(options: {
  workspace: WorkspaceModel | null;
  operationRoot: string;
  targetPath: string;
  maxBytes?: number;
}): Promise<
  | { ok: true; content: string; access: WorkspacePathAccess }
  | { ok: false; access: WorkspacePathAccess; error: string }
> {
  const access = assertWorkspacePathAccess({
    workspace: options.workspace,
    operationRoot: options.operationRoot,
    targetPath: options.targetPath,
  });
  if (!access.allowed) {
    return { ok: false, access, error: access.reason };
  }
  try {
    const buf = await fs.readFile(path.resolve(options.targetPath));
    const max = options.maxBytes ?? 1024 * 1024;
    const content = buf.subarray(0, max).toString("utf8");
    return { ok: true, content, access };
  } catch (error) {
    return {
      ok: false,
      access,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
