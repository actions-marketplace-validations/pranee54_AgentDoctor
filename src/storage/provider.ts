import fs from "node:fs/promises";
import path from "node:path";

import type { StorageProvider } from "../contracts/index.js";
import { resolveRepoRoot, isPathInsideRoot } from "../utils/path.js";
import { atomicWriteTextFile } from "../utils/fs.js";

export class FilesystemStorageProvider implements StorageProvider {
  readonly kind = "filesystem" as const;
  private readonly root: string;

  constructor(rootInput: string, subdir = ".agentdoctor/storage") {
    this.root = path.join(resolveRepoRoot(rootInput), subdir);
  }

  private resolveKey(key: string): string {
    if (key.includes("\0") || key.split(/[/\\]/).includes("..") || path.isAbsolute(key)) {
      throw new Error(`unsafe storage key: ${key}`);
    }
    const target = path.resolve(this.root, key);
    if (!isPathInsideRoot(this.root, target)) throw new Error("storage path escape");
    return target;
  }

  async get(key: string): Promise<string | null> {
    try {
      return await fs.readFile(this.resolveKey(key), "utf8");
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    const target = this.resolveKey(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await atomicWriteTextFile(target, value);
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolveKey(key));
    } catch {
      // ignore
    }
  }

  async list(prefix: string): Promise<string[]> {
    const base = this.resolveKey(prefix || ".");
    const out: string[] = [];
    async function walk(dir: string, rel: string): Promise<void> {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const nextRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(path.join(dir, e.name), nextRel);
        else out.push(nextRel);
      }
    }
    const st = await fs.stat(base).catch(() => null);
    if (!st) return [];
    if (st.isFile()) return [prefix];
    await walk(base, prefix === "." ? "" : prefix);
    return out.sort();
  }
}

/** In-memory provider for tests and optional ephemeral mode. */
export class MemoryStorageProvider implements StorageProvider {
  readonly kind = "memory" as const;
  private readonly map = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async list(prefix: string): Promise<string[]> {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}

/**
 * SQLite provider — optional. Requires better-sqlite3 when enabled.
 * Without the dependency, construction throws a documented error (no fake DB).
 */
export async function tryCreateSqliteStorage(
  _root: string,
): Promise<StorageProvider | { error: string }> {
  return {
    error:
      "SQLite storage is feature-flagged and requires optional dependency better-sqlite3 (not bundled). Use filesystem provider for local-first default.",
  };
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  repositoryRoots: string[];
  createdAt: string;
}

export async function saveWorkspace(
  storage: StorageProvider,
  workspace: WorkspaceRecord,
): Promise<void> {
  await storage.set(`workspaces/${workspace.id}.json`, `${JSON.stringify(workspace, null, 2)}\n`);
}

export async function loadWorkspace(
  storage: StorageProvider,
  id: string,
): Promise<WorkspaceRecord | null> {
  const raw = await storage.get(`workspaces/${id}.json`);
  if (!raw) return null;
  return JSON.parse(raw) as WorkspaceRecord;
}
