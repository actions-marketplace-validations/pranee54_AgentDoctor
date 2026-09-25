import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  getBrainStatus,
  initBrainStore,
  searchBrain,
  rebuildBrain,
} from "../../../src/core/brain-cli/service.js";
import { analyzeChanges } from "../../../src/core/changes/analyze.js";
import { analyzeContextHealth } from "../../../src/core/context-health/analyze.js";
import { scanSecrets } from "../../../src/core/secrets/scan.js";
import { createFixBackup, listFixAudits, undoFix } from "../../../src/core/fix/backup.js";
import {
  baselineFromScan,
  compareToBaseline,
  saveNamedBaseline,
  loadNamedBaseline,
} from "../../../src/core/baseline/store.js";
import { detectMonorepo } from "../../../src/core/monorepo/detect.js";
import { validatePluginManifest, discoverPlugins } from "../../../src/plugins/sdk.js";
import {
  createLocalAiProvider,
  redactForModel,
} from "../../../src/integrations/local-ai/provider.js";
import { analyzePullRequest } from "../../../src/integrations/github/pr-analyze.js";
import { scan } from "../../../src/core/scanner/scan.js";

async function tempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentdoctor-v2-"));
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "tmp-v2", private: true }, null, 2),
  );
  return dir;
}

describe("v2 brain CLI service", () => {
  it("inits store and reports status", async () => {
    const root = await tempRepo();
    try {
      const status = await initBrainStore(root);
      expect(status.storeRoot).toContain(".agentdoctor");
      const again = await getBrainStatus(root);
      expect(again.root).toBe(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rebuilds and searches brain", async () => {
    const root = await tempRepo();
    try {
      const brain = await rebuildBrain(root);
      expect(brain.snapshot.id).toBeTruthy();
      const hits = searchBrain(brain, brain.metadata.projectName.slice(0, 3) || "tmp");
      expect(Array.isArray(hits)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("v2 changes + context health", () => {
  it("handles non-git repos gracefully", async () => {
    const root = await tempRepo();
    try {
      const report = await analyzeChanges({ root });
      expect(report.gitAvailable).toBe(false);
      expect(report.files).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects empty instruction file", async () => {
    const root = await tempRepo();
    try {
      await writeFile(path.join(root, "AGENTS.md"), "");
      const report = await analyzeContextHealth(root);
      expect(report.instructionFiles).toContain("AGENTS.md");
      expect(report.conflicts.some((c) => c.kind === "empty-instruction-file")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("v2 secrets", () => {
  it("never returns raw secret values", async () => {
    const root = await tempRepo();
    try {
      await writeFile(path.join(root, "leak.txt"), "key=AKIAIOSFODNN7EXAMPLE\n");
      const report = await scanSecrets({ root, enabled: true });
      expect(report.findings.length).toBeGreaterThan(0);
      for (const f of report.findings) {
        expect(f.redactedSnippet).toContain("[REDACTED]");
        expect(f.redactedSnippet).not.toContain("AKIAIOSFODNN7EXAMPLE");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("is disabled by default", async () => {
    const root = await tempRepo();
    try {
      const report = await scanSecrets({ root, enabled: false });
      expect(report.enabled).toBe(false);
      expect(report.findings).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("v2 fix backup/undo", () => {
  it("backs up and restores a file", async () => {
    const root = await tempRepo();
    try {
      await writeFile(path.join(root, ".cursorignore"), "node_modules/\n");
      const audit = await createFixBackup({
        root,
        relativePaths: [".cursorignore"],
        note: "test",
      });
      expect(audit.id).toBeTruthy();
      await writeFile(path.join(root, ".cursorignore"), "changed\n");
      const undo = await undoFix({ root, auditId: audit.id });
      expect(undo.mode).toBe("undo");
      const { readFile } = await import("node:fs/promises");
      const restored = await readFile(path.join(root, ".cursorignore"), "utf8");
      expect(restored).toBe("node_modules/\n");
      const list = await listFixAudits(root);
      expect(list.length).toBeGreaterThanOrEqual(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("v2 baselines", () => {
  it("saves and diffs baselines", async () => {
    const root = await tempRepo();
    try {
      const result = await scan({ cwd: root });
      const baseline = baselineFromScan("main", result);
      await saveNamedBaseline(root, baseline);
      const loaded = await loadNamedBaseline(root, "main");
      expect(loaded?.name).toBe("main");
      const diff = compareToBaseline(loaded!, result.findings);
      expect(diff.added).toEqual([]);
      expect(diff.unchanged).toBe(result.findings.length);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("v2 monorepo", () => {
  it("detects npm workspaces", async () => {
    const root = await tempRepo();
    try {
      await writeFile(
        path.join(root, "package.json"),
        JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }, null, 2),
      );
      await mkdir(path.join(root, "packages", "a"), { recursive: true });
      await writeFile(
        path.join(root, "packages", "a", "package.json"),
        JSON.stringify({ name: "@tmp/a" }, null, 2),
      );
      const mono = await detectMonorepo(root);
      expect(mono.isMonorepo).toBe(true);
      expect(mono.packages.some((p) => p.name === "@tmp/a")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("v2 plugins + local ai + pr", () => {
  it("validates plugin manifests", () => {
    const ok = validatePluginManifest({
      id: "x",
      name: "X",
      version: "1.0.0",
      apiVersion: "2.0",
      capabilities: ["analyzer"],
    });
    expect(ok.ok).toBe(true);
    const bad = validatePluginManifest({ id: "x" });
    expect(bad.ok).toBe(false);
  });

  it("discovers plugins from fixture", async () => {
    const fixture = path.resolve(process.cwd(), "fixtures/plugin-example");
    const plugins = await discoverPlugins(fixture);
    expect(plugins.some((p) => p.manifest.id === "example-analyzer" && p.ok)).toBe(true);
  });

  it("redacts secrets for model and mock provider labels AI output", async () => {
    expect(redactForModel("tok=ghp_abcdefghijklmnopqrstuvwxyz0123456789")).toContain("[REDACTED]");
    const mock = createLocalAiProvider("mock");
    const res = await mock.generate({ prompt: "hi", context: [] });
    expect(res.aiGenerated).toBe(true);
    expect(res.text).toContain("AI-GENERATED");
  });

  it("pr review never posts", async () => {
    const root = await tempRepo();
    try {
      const report = await analyzePullRequest({ root, dryRun: true });
      expect(report.posted).toBe(false);
      expect(report.commentMarkdown).toContain("AgentDoctor");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
