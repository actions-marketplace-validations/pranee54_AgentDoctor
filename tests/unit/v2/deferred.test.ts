import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { analyzeChanges } from "../../../src/core/changes/analyze.js";
import { analyzeContextHealth } from "../../../src/core/context-health/analyze.js";
import {
  baselineFromScan,
  compareToBaseline,
  computeBaselineTrends,
  deleteNamedBaseline,
  loadNamedBaseline,
  saveNamedBaseline,
} from "../../../src/core/baseline/store.js";
import {
  assertTargetsUnchangedSinceBackup,
  createFixBackup,
} from "../../../src/core/fix/backup.js";
import { runPluginAnalyzers } from "../../../src/plugins/runtime.js";
import { startDashboardServer } from "../../../src/dashboard/server.js";
import { validateAgainstSchema } from "../../../src/core/schemas/validate.js";
import { scan } from "../../../src/core/scanner/scan.js";

async function tempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentdoctor-deferred-"));
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "tmp-deferred", private: true }, null, 2),
  );
  return dir;
}

describe("deferred: changes --impact", () => {
  it("returns UNKNOWN impact without brain edges", async () => {
    const root = await tempRepo();
    try {
      const report = await analyzeChanges({ root, impact: true });
      expect(report.gitAvailable).toBe(false);
      expect(report.impact?.status).toBe("unknown");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("deferred: baseline delete/trends/corrupt", () => {
  it("saves, trends, deletes, and fails closed on corrupt", async () => {
    const root = await tempRepo();
    try {
      const result = await scan({ cwd: root });
      await saveNamedBaseline(root, baselineFromScan("a", result));
      await saveNamedBaseline(root, {
        ...baselineFromScan("b", result),
        createdAt: new Date(Date.now() + 1000).toISOString(),
      });
      const trends = await computeBaselineTrends(root);
      expect(trends.points.length).toBe(2);
      expect(trends.deltas.length).toBe(1);

      await deleteNamedBaseline(root, "a");
      await expect(deleteNamedBaseline(root, "a")).rejects.toThrow(/not found/);

      await writeFile(
        path.join(root, ".agentdoctor", "baselines", "bad.json"),
        "{not-json",
        "utf8",
      );
      await expect(loadNamedBaseline(root, "bad")).rejects.toThrow(/corrupt/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("compare includes recurring fingerprints", async () => {
    const root = await tempRepo();
    try {
      const result = await scan({ cwd: root });
      const baseline = baselineFromScan("main", result);
      const diff = compareToBaseline(baseline, result.findings);
      expect(diff.recurring.length).toBe(result.findings.length);
      expect(diff.unchanged).toBe(diff.recurring.length);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("deferred: expanded context-health", () => {
  it("flags ambiguous, invalid refs, and empty ignore", async () => {
    const root = await tempRepo();
    try {
      await writeFile(path.join(root, "AGENTS.md"), `TODO fix docs/nope.md forever\n`);
      await writeFile(path.join(root, ".cursorignore"), "");
      const report = await analyzeContextHealth(root);
      expect(report.conflicts.some((c) => c.kind === "ambiguous-marker")).toBe(true);
      expect(report.conflicts.some((c) => c.kind === "invalid-path-reference")).toBe(true);
      expect(report.conflicts.some((c) => c.kind === "unused-ignore-candidate")).toBe(true);
      expect(report.conflicts.every((c) => c.confidence)).toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("deferred: Safe Fix concurrent modification", () => {
  it("detects hash change after backup", async () => {
    const root = await tempRepo();
    try {
      await writeFile(path.join(root, ".cursorignore"), "node_modules/\n");
      const audit = await createFixBackup({
        root,
        relativePaths: [".cursorignore"],
      });
      expect(audit.entries[0]?.mtimeMsBefore).not.toBeNull();
      await writeFile(path.join(root, ".cursorignore"), "changed/\n");
      await expect(
        assertTargetsUnchangedSinceBackup(root, audit, [".cursorignore"]),
      ).rejects.toThrow(/concurrent modification/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("deferred: plugin runtime hooks", () => {
  it("runs declarative analyzer and isolates hostile throw", async () => {
    const example = path.resolve(process.cwd(), "fixtures/plugin-example");
    const ok = await runPluginAnalyzers(example);
    expect(ok.some((r) => r.pluginId === "example-analyzer" && r.ok && r.notes.length > 0)).toBe(
      true,
    );

    const hostile = path.resolve(process.cwd(), "fixtures/plugin-hostile");
    const bad = await runPluginAnalyzers(hostile);
    expect(bad.some((r) => r.pluginId === "hostile-throw" && r.ok === false)).toBe(true);
    expect(bad.every((r) => r.ok || typeof r.error === "string")).toBe(true);
  });
});

describe("deferred: dashboard HTTP e2e", () => {
  it("serves read-only APIs and rejects POST", async () => {
    const root = await tempRepo();
    const server = await startDashboardServer({
      root,
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const status = await fetch(`${base}/api/status`);
      expect(status.ok).toBe(true);
      const body = (await status.json()) as { readOnly: boolean };
      expect(body.readOnly).toBe(true);

      const scanRes = await fetch(`${base}/api/scan`);
      expect(scanRes.ok).toBe(true);

      const post = await fetch(`${base}/api/status`, { method: "POST" });
      expect(post.status).toBe(405);
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("deferred: JSON schemas", () => {
  it("validates live reports against shipped schemas", async () => {
    const root = await tempRepo();
    try {
      const schemaDir = path.resolve(process.cwd(), "schemas/v2");
      const changeSchema = JSON.parse(
        await readFile(path.join(schemaDir, "change-report.json"), "utf8"),
      ) as Record<string, unknown>;
      const contextSchema = JSON.parse(
        await readFile(path.join(schemaDir, "context-health.json"), "utf8"),
      ) as Record<string, unknown>;
      const baselineSchema = JSON.parse(
        await readFile(path.join(schemaDir, "baseline.json"), "utf8"),
      ) as Record<string, unknown>;
      const diffSchema = JSON.parse(
        await readFile(path.join(schemaDir, "baseline-diff.json"), "utf8"),
      ) as Record<string, unknown>;

      const changes = await analyzeChanges({ root, impact: true });
      expect(validateAgainstSchema(changeSchema, changes)).toEqual([]);

      const context = await analyzeContextHealth(root);
      expect(validateAgainstSchema(contextSchema, context)).toEqual([]);

      const result = await scan({ cwd: root });
      const baseline = baselineFromScan("schema", result);
      expect(validateAgainstSchema(baselineSchema, baseline)).toEqual([]);
      const diff = compareToBaseline(baseline, result.findings);
      expect(validateAgainstSchema(diffSchema, diff)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
