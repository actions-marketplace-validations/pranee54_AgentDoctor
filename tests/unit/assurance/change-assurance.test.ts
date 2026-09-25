import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import {
  analyzeChange,
  deriveGraphChangeImpact,
  derivePackageImpact,
  inspectEvidence,
  verifyChange,
  verifyEvidence,
} from "../../../src/assurance/change.js";

async function tempGitRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentdoctor-change-"));
  await fs.chmod(root, 0o700);
  const run = (args: string[]) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (r.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
    }
  };
  run(["init"]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "Test"]);
  await fs.mkdir(path.join(root, "packages", "alpha"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "root", version: "0.0.0", workspaces: ["packages/*"] }),
  );
  await fs.writeFile(
    path.join(root, "packages", "alpha", "package.json"),
    JSON.stringify({ name: "alpha", version: "0.0.0" }),
  );
  await fs.writeFile(path.join(root, "src-a.ts"), "export const a = 1;\n");
  await fs.writeFile(path.join(root, "packages", "alpha", "x.ts"), "export const x = 1;\n");
  run(["add", "."]);
  run(["commit", "-m", "init"]);
  await fs.writeFile(path.join(root, "src-a.ts"), "export const a = 2;\n");
  await fs.writeFile(path.join(root, "packages", "alpha", "x.ts"), "export const x = 2;\n");
  await fs.writeFile(path.join(root, "added.ts"), "export const n = 1;\n");
  return root;
}

describe("change assurance", () => {
  it("analyzes without claiming verified", async () => {
    const root = await tempGitRepo();
    try {
      const assessment = await analyzeChange({ root });
      expect(assessment.changeId.startsWith("chg_")).toBe(true);
      expect(assessment.verificationStatus).toBe("not-run");
      expect(assessment.changedFiles.length).toBeGreaterThan(0);
      expect(assessment.testImpact.mode).toBe("heuristic");
      expect(assessment.limitations.length).toBeGreaterThan(0);
      expect(Array.isArray(assessment.callers)).toBe(true);
      expect(Array.isArray(assessment.callees)).toBe(true);
      expect(Array.isArray(assessment.reverseDependencies)).toBe(true);
      expect(Array.isArray(assessment.packageImpact)).toBe(true);
      expect(assessment.packageImpact).toContain("packages/alpha");
      expect(
        assessment.changedFiles.some(
          (f) => f.kind === "modified" || f.kind === "untracked" || f.kind === "added",
        ),
      ).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("produces evidence and hash-verifies", async () => {
    const root = await tempGitRepo();
    try {
      const { assessment, manifest } = await verifyChange({ root });
      expect(assessment.verificationStatus).toBe("evidence-produced");
      expect(manifest.files.length).toBeGreaterThan(5);
      expect(assessment.evidence.directory?.split(path.sep).join("/")).toContain(
        ".agentdoctor/evidence/",
      );

      const inspected = await inspectEvidence({ root, changeId: assessment.changeId });
      expect(inspected.ok).toBe(true);
      expect(inspected.presentFiles).toContain("manifest.json");

      const verified = await verifyEvidence({ root, changeId: assessment.changeId });
      expect(verified.ok).toBe(true);
      expect(verified.verificationStatus).toBe("verified");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("derives callers/callees from graph edges and package impact from workspaces", async () => {
    const impact = deriveGraphChangeImpact(
      {
        nodes: [
          { id: "file:a", kind: "file", label: "a.ts", path: "a.ts" },
          { id: "file:b", kind: "file", label: "b.ts", path: "b.ts" },
          { id: "fn:a", kind: "function", label: "fa", path: "a.ts" },
        ],
        edges: [
          { from: "file:b", to: "file:a", kind: "imports" },
          { from: "file:a", to: "fn:a", kind: "calls" },
        ],
      },
      [{ path: "a.ts", kind: "modified" }],
      ["fn:a"],
    );
    expect(impact.callers).toContain("b.ts");
    expect(impact.reverseDependencies).toContain("b.ts");
    expect(impact.callees.length).toBeGreaterThan(0);

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ad-pkg-"));
    try {
      await fs.writeFile(
        path.join(root, "package.json"),
        JSON.stringify({ name: "mono", workspaces: ["packages/*"] }),
      );
      const pkgs = await derivePackageImpact(root, [
        { path: "packages/alpha/src/x.ts" },
        { path: "README.md" },
      ]);
      expect(pkgs).toEqual(["packages/alpha"]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
