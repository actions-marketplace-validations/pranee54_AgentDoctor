import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  FilesystemStorageProvider,
  MemoryStorageProvider,
  tryCreateSqliteStorage,
} from "../../../src/storage/provider.js";
import type { StorageProvider } from "../../../src/contracts/index.js";
import type { SqliteStorageProvider } from "../../../src/storage/sqlite.js";

async function contractSuite(
  name: string,
  create: () => Promise<{
    storage: StorageProvider;
    cleanup: () => Promise<void>;
  }>,
): Promise<void> {
  describe(`StorageProvider contract: ${name}`, () => {
    it("get/set/delete/list", async () => {
      const { storage, cleanup } = await create();
      try {
        expect(await storage.get("missing")).toBeNull();
        await storage.set("a/b", "hello");
        expect(await storage.get("a/b")).toBe("hello");
        await storage.set("a/c", "world");
        const listed = await storage.list("a/");
        expect(listed.some((k) => k.includes("b") || k === "a/b")).toBe(true);
        await storage.delete("a/b");
        expect(await storage.get("a/b")).toBeNull();
      } finally {
        await cleanup();
      }
    });
  });
}

await contractSuite("memory", async () => ({
  storage: new MemoryStorageProvider(),
  cleanup: async () => undefined,
}));

await contractSuite("filesystem", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ad-fs-store-"));
  return {
    storage: new FilesystemStorageProvider(root),
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
});

describe("SQLite storage", () => {
  it("creates .agentdoctor/storage.sqlite when node:sqlite is available", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ad-sqlite-"));
    try {
      const result = await tryCreateSqliteStorage(root);
      if ("error" in result) {
        // Skip soft when runtime lacks node:sqlite (Node < 22)
        expect(result.error).toMatch(/sqlite|Node/i);
        return;
      }
      const storage = result as SqliteStorageProvider;
      expect(storage.kind).toBe("sqlite");
      await storage.set("k1", "v1");
      expect(await storage.get("k1")).toBe("v1");
      expect(await storage.list("k")).toEqual(["k1"]);
      await storage.delete("k1");
      expect(await storage.get("k1")).toBeNull();
      const dbFile = path.join(root, ".agentdoctor", "storage.sqlite");
      const st = await fs.stat(dbFile);
      expect(st.isFile()).toBe(true);
      storage.close();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("Postgres storage", () => {
  it("runs get/set/delete/list contract when AGENTDOCTOR_POSTGRES_URL is set", async () => {
    const url = process.env.AGENTDOCTOR_POSTGRES_URL;
    if (!url) {
      // Honest skip — do not claim Postgres supported without a live env test path.
      expect(url).toBeUndefined();
      return;
    }
    const { tryCreatePostgresStorage } = await import("../../../src/storage/postgres.js");
    const result = await tryCreatePostgresStorage(url);
    if ("error" in result) {
      throw new Error(`AGENTDOCTOR_POSTGRES_URL set but connect failed: ${result.error}`);
    }
    const prefix = `test_${Date.now()}_`;
    try {
      expect(await result.get(`${prefix}missing`)).toBeNull();
      await result.set(`${prefix}a/b`, "hello");
      expect(await result.get(`${prefix}a/b`)).toBe("hello");
      await result.set(`${prefix}a/c`, "world");
      const listed = await result.list(`${prefix}a/`);
      expect(listed.some((k) => k.includes("b") || k.endsWith("a/b"))).toBe(true);
      await result.delete(`${prefix}a/b`);
      expect(await result.get(`${prefix}a/b`)).toBeNull();
    } finally {
      await result.delete(`${prefix}a/b`).catch(() => undefined);
      await result.delete(`${prefix}a/c`).catch(() => undefined);
      await result.close();
    }
  });
});
