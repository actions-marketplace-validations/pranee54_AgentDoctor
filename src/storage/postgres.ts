import type { Pool, PoolClient } from "pg";
import pg from "pg";

import type { StorageProvider } from "../contracts/index.js";

const { Pool: PgPool } = pg;

/**
 * Postgres-backed StorageProvider via the `pg` package.
 * Only usable when a real connection string works — not claimed as always-on enterprise storage.
 */
export class PostgresStorageProvider implements StorageProvider {
  readonly kind = "postgres" as const;
  private readonly pool: Pool;
  private ready: Promise<void>;

  constructor(pool: Pool) {
    this.pool = pool;
    this.ready = this.ensureSchema();
  }

  private async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS agentdoctor_kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  private async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async get(key: string): Promise<string | null> {
    return this.withClient(async (client) => {
      const result = await client.query<{ value: string }>(
        "SELECT value FROM agentdoctor_kv WHERE key = $1",
        [key],
      );
      return result.rows[0]?.value ?? null;
    });
  }

  async set(key: string, value: string): Promise<void> {
    await this.withClient(async (client) => {
      await client.query(
        `INSERT INTO agentdoctor_kv (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, value],
      );
    });
  }

  async delete(key: string): Promise<void> {
    await this.withClient(async (client) => {
      await client.query("DELETE FROM agentdoctor_kv WHERE key = $1", [key]);
    });
  }

  async list(prefix: string): Promise<string[]> {
    return this.withClient(async (client) => {
      const result = await client.query<{ key: string }>(
        "SELECT key FROM agentdoctor_kv WHERE key LIKE $1 ORDER BY key",
        [`${prefix}%`],
      );
      return result.rows.map((r) => r.key);
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Create Postgres storage when a connection string is provided and the server accepts it.
 * Returns `{ error }` on failure — do not claim Postgres is supported without a working URL.
 */
export async function tryCreatePostgresStorage(
  connectionString: string,
): Promise<PostgresStorageProvider | { error: string }> {
  if (!connectionString || typeof connectionString !== "string" || !connectionString.trim()) {
    return { error: "Postgres connection string is empty" };
  }
  const pool = new PgPool({
    connectionString: connectionString.trim(),
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
  });
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
    return new PostgresStorageProvider(pool);
  } catch (error) {
    await pool.end().catch(() => undefined);
    return {
      error: `Failed to connect to Postgres: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
