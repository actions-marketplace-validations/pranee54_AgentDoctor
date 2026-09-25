import fs from "node:fs/promises";
import path from "node:path";

import type { StorageProvider } from "../contracts/index.js";
import { resolveRepoRoot } from "../utils/path.js";

type DatabaseSyncCtor = new (path: string) => {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
};

/**
 * SQLite-backed StorageProvider using Node's built-in `node:sqlite` (DatabaseSync).
 * Available on Node 22+; feature-detected at runtime.
 */
export class SqliteStorageProvider implements StorageProvider {
  readonly kind = "sqlite" as const;
  private readonly db: InstanceType<DatabaseSyncCtor>;
  private readonly dbPath: string;

  constructor(db: InstanceType<DatabaseSyncCtor>, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  get path(): string {
    return this.dbPath;
  }

  async get(key: string): Promise<string | null> {
    const row = this.db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as
      { value: string } | undefined;
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.db
      .prepare(
        "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  async delete(key: string): Promise<void> {
    this.db.prepare("DELETE FROM kv WHERE key = ?").run(key);
  }

  async list(prefix: string): Promise<string[]> {
    const rows = this.db
      .prepare("SELECT key FROM kv WHERE key LIKE ? ORDER BY key")
      .all(`${prefix}%`) as Array<{ key: string }>;
    return rows.map((r) => r.key);
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Create SQLite storage at `.agentdoctor/storage.sqlite` when `node:sqlite` is available.
 */
export async function tryCreateSqliteStorage(
  rootInput: string,
): Promise<SqliteStorageProvider | { error: string }> {
  let DatabaseSync: DatabaseSyncCtor;
  try {
    const mod = await import("node:sqlite");
    if (!mod || typeof (mod as { DatabaseSync?: unknown }).DatabaseSync !== "function") {
      return { error: "node:sqlite DatabaseSync is not available in this Node runtime" };
    }
    DatabaseSync = (mod as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch (error) {
    return {
      error: `SQLite storage requires Node.js with node:sqlite (typically Node 22+): ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  try {
    const root = resolveRepoRoot(rootInput);
    const dir = path.join(root, ".agentdoctor");
    await fs.mkdir(dir, { recursive: true });
    const dbPath = path.join(dir, "storage.sqlite");
    const db = new DatabaseSync(dbPath);
    return new SqliteStorageProvider(db, dbPath);
  } catch (error) {
    return {
      error: `Failed to open SQLite storage: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
