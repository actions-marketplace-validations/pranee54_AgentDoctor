import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { atomicWriteTextFile } from "../../utils/fs.js";
import { isPathInsideRoot, resolveRepoRoot } from "../../utils/path.js";

function resolveSafePath(root: string, relativePath: string): string {
  const absolute = path.resolve(root, relativePath);
  if (!isPathInsideRoot(root, absolute)) {
    throw new Error(`path escapes repository root: ${relativePath}`);
  }
  return absolute;
}

export interface FixBackupEntry {
  relativePath: string;
  existed: boolean;
  backupRelativePath: string | null;
  sha256Before: string | null;
  mtimeMsBefore: number | null;
}

export interface FixAuditRecord {
  id: string;
  createdAt: string;
  root: string;
  mode: "apply" | "undo";
  entries: FixBackupEntry[];
  note?: string;
}

function auditDir(root: string): string {
  return path.join(root, ".agentdoctor", "fix-audit");
}

function backupsDir(root: string, auditId: string): string {
  return path.join(auditDir(root), auditId, "backups");
}

async function sha256File(absolute: string): Promise<string | null> {
  try {
    const buf = await fs.readFile(absolute);
    return createHash("sha256").update(buf).digest("hex");
  } catch {
    return null;
  }
}

export async function createFixBackup(options: {
  root: string;
  relativePaths: string[];
  note?: string;
}): Promise<FixAuditRecord> {
  const root = resolveRepoRoot(options.root);
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const backupRoot = backupsDir(root, id);
  await fs.mkdir(backupRoot, { recursive: true });

  const entries: FixBackupEntry[] = [];
  for (const rel of options.relativePaths) {
    const absolute = resolveSafePath(root, rel);
    let existed = false;
    let backupRelativePath: string | null = null;
    let sha: string | null = null;
    let mtimeMsBefore: number | null = null;
    try {
      const st = await fs.lstat(absolute);
      if (st.isSymbolicLink()) {
        throw new Error(`refusing to backup symlink: ${rel}`);
      }
      if (st.isDirectory()) {
        throw new Error(`refusing to backup directory: ${rel}`);
      }
      existed = true;
      mtimeMsBefore = st.mtimeMs;
      sha = await sha256File(absolute);
      const dest = path.join(backupRoot, rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(absolute, dest);
      backupRelativePath = path.relative(root, dest).split(path.sep).join("/");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        existed = false;
      } else {
        throw error;
      }
    }
    entries.push({
      relativePath: rel,
      existed,
      backupRelativePath,
      sha256Before: sha,
      mtimeMsBefore,
    });
  }

  const record: FixAuditRecord = {
    id,
    createdAt,
    root,
    mode: "apply",
    entries,
    ...(options.note ? { note: options.note } : {}),
  };
  await atomicWriteTextFile(
    path.join(auditDir(root), id, "audit.json"),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  return record;
}

export async function listFixAudits(rootInput: string): Promise<FixAuditRecord[]> {
  const root = resolveRepoRoot(rootInput);
  const dir = auditDir(root);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const records: FixAuditRecord[] = [];
  for (const name of names) {
    try {
      const raw = await fs.readFile(path.join(dir, name, "audit.json"), "utf8");
      records.push(JSON.parse(raw) as FixAuditRecord);
    } catch {
      // skip corrupt
    }
  }
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function undoFix(options: { root: string; auditId: string }): Promise<FixAuditRecord> {
  const root = resolveRepoRoot(options.root);
  const auditPath = path.join(auditDir(root), options.auditId, "audit.json");
  const raw = await fs.readFile(auditPath, "utf8");
  const original = JSON.parse(raw) as FixAuditRecord;
  const undoEntries: FixBackupEntry[] = [];

  for (const entry of original.entries) {
    const target = resolveSafePath(root, entry.relativePath);
    if (entry.existed && entry.backupRelativePath) {
      const backupAbs = resolveSafePath(root, entry.backupRelativePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(backupAbs, target);
      undoEntries.push({
        relativePath: entry.relativePath,
        existed: true,
        backupRelativePath: entry.backupRelativePath,
        sha256Before: await sha256File(target),
        mtimeMsBefore: null,
      });
    } else if (!entry.existed) {
      try {
        await fs.unlink(target);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw error;
      }
      undoEntries.push({
        relativePath: entry.relativePath,
        existed: false,
        backupRelativePath: null,
        sha256Before: null,
        mtimeMsBefore: null,
      });
    }
  }

  const undoRecord: FixAuditRecord = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    root,
    mode: "undo",
    entries: undoEntries,
    note: `undo of ${original.id}`,
  };
  await fs.mkdir(path.join(auditDir(root), undoRecord.id), { recursive: true });
  await atomicWriteTextFile(
    path.join(auditDir(root), undoRecord.id, "audit.json"),
    `${JSON.stringify(undoRecord, null, 2)}\n`,
  );
  return undoRecord;
}

/**
 * Ensure a target still matches the backup snapshot (detect concurrent modification).
 * For files that did not exist at backup time, refuses if the path now exists.
 */
export async function assertTargetsUnchangedSinceBackup(
  rootInput: string,
  audit: FixAuditRecord,
  relativePaths: string[],
): Promise<void> {
  const root = resolveRepoRoot(rootInput);
  const byPath = new Map(audit.entries.map((e) => [e.relativePath, e]));
  for (const rel of relativePaths) {
    const entry = byPath.get(rel);
    if (!entry) continue;
    const absolute = resolveSafePath(root, rel);
    try {
      const st = await fs.lstat(absolute);
      if (st.isSymbolicLink() || st.isDirectory()) {
        throw new Error(`concurrent modification risk on non-file target: ${rel}`);
      }
      if (!entry.existed) {
        throw new Error(
          `concurrent modification detected: ${rel} was created after backup (refusing write)`,
        );
      }
      const sha = await sha256File(absolute);
      if (entry.sha256Before && sha !== entry.sha256Before) {
        throw new Error(
          `concurrent modification detected: ${rel} changed since backup (hash mismatch)`,
        );
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        if (entry.existed) {
          throw new Error(
            `concurrent modification detected: ${rel} deleted since backup (refusing write)`,
          );
        }
        continue;
      }
      throw error;
    }
  }
}
