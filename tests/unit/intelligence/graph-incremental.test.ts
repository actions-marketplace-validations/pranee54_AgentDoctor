import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import {
  graphBuild,
  graphRebuild,
  graphStatus,
  graphUpdate,
} from "../../../src/intelligence/graph/incremental.js";

async function tempTsRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ad-graph-inc-"));
  await fs.chmod(root, 0o700);
  const run = (args: string[]) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (r.status !== 0) throw new Error(String(r.stderr));
  };
  run(["init"]);
  run(["config", "user.email", "t@example.com"]);
  run(["config", "user.name", "T"]);
  await fs.writeFile(path.join(root, "one.ts"), "export function one() { return 1; }\n");
  run(["add", "."]);
  run(["commit", "-m", "init"]);
  return root;
}

describe("incremental graph", () => {
  it("builds, skips update when unchanged, updates when file changes", async () => {
    const root = await tempTsRepo();
    try {
      const built = await graphBuild({ root, mode: "auto" });
      expect(built.snapshot.nodes.length).toBeGreaterThan(0);
      expect(built.path).toContain(path.join(".agentdoctor", "graph", "index.json"));

      const status1 = await graphStatus({ root });
      expect(status1.present).toBe(true);
      expect(status1.staleFiles).toEqual([]);

      const noop = await graphUpdate({ root, mode: "auto" });
      expect(noop.rebuilt).toBe(false);
      expect(noop.reason).toMatch(/unchanged/i);

      await fs.writeFile(path.join(root, "one.ts"), "export function one() { return 2; }\n");
      const updated = await graphUpdate({ root, mode: "auto" });
      expect(updated.rebuilt).toBe(true);
      expect(updated.changedFiles.some((f) => f.includes("one.ts"))).toBe(true);

      const rebuilt = await graphRebuild({ root, mode: "regex" });
      expect(rebuilt.rebuilt).toBe(true);
      expect(rebuilt.snapshot.builder).toBeTruthy();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rebuilds on corrupt index", async () => {
    const root = await tempTsRepo();
    try {
      await graphBuild({ root });
      const index = path.join(root, ".agentdoctor", "graph", "index.json");
      await fs.writeFile(index, "{not-json");
      const updated = await graphUpdate({ root });
      expect(updated.rebuilt).toBe(true);
      expect(updated.reason).toMatch(/corrupt/i);
      const status = await graphStatus({ root });
      expect(status.present).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
