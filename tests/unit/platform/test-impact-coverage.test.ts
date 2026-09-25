import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { analyzeTestImpact } from "../../../src/platform/test-impact/analyze.js";

async function tempGitRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ad-impact-"));
  const run = (args: string[]) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  };
  run(["init"]);
  run(["config", "user.email", "t@example.com"]);
  run(["config", "user.name", "T"]);
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "tests"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "util.ts"), "export const x = 1;\n");
  await fs.writeFile(
    path.join(root, "tests", "util.test.ts"),
    "import { x } from '../src/util.js';\n",
  );
  run(["add", "."]);
  run(["commit", "-m", "init"]);
  await fs.writeFile(path.join(root, "src", "util.ts"), "export const x = 2;\n");
  return root;
}

describe("test impact coverage-backed mode", () => {
  it("stays heuristic without coverage", async () => {
    const root = await tempGitRepo();
    try {
      const report = await analyzeTestImpact({ root });
      expect(report.mode).toBe("heuristic");
      expect(report.coverage).toBeNull();
      expect(
        report.recommendedTests.every((t) => t.evidence !== "verified" || isTestPath(t.testPath)),
      ).toBe(true);
      // naming heuristics must not claim verified mapping
      const heuristicItems = report.recommendedTests.filter((t) =>
        /heuristic|Suggested|candidate/i.test(t.reason),
      );
      expect(heuristicItems.every((t) => t.evidence === "inferred")).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("uses coverage-backed mode with LCOV line hits and hybrid test attribution", async () => {
    const root = await tempGitRepo();
    try {
      const lcov = path.join(root, "coverage.lcov");
      await fs.writeFile(
        lcov,
        ["SF:src/util.ts", "DA:1,4", "DA:2,0", "end_of_record", ""].join("\n"),
      );
      const report = await analyzeTestImpact({ root, coveragePath: lcov });
      expect(report.mode).toBe("coverage-backed");
      expect(report.coverage?.format).toBe("lcov");
      expect(report.coverage?.changedCoveredLines).toBeGreaterThan(0);
      expect(report.coverage?.testAttribution).toBe("hybrid-heuristic");
      expect(report.limitations.some((l) => /coverage-backed/i.test(l))).toBe(true);
      expect(report.limitations.some((l) => /heuristic/i.test(l))).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("attributes tests from Istanbul test map as verified coverage evidence", async () => {
    const root = await tempGitRepo();
    try {
      const coveragePath = path.join(root, "coverage-final.json");
      await fs.writeFile(
        coveragePath,
        JSON.stringify({
          "src/util.ts": {
            path: "src/util.ts",
            statementMap: { "0": { start: { line: 1 } } },
            s: { "0": 2 },
            coveredByTests: ["tests/util.test.ts"],
          },
          testMap: { "tests/util.test.ts": ["src/util.ts"] },
        }),
      );
      const report = await analyzeTestImpact({ root, coveragePath });
      expect(report.mode).toBe("coverage-backed");
      expect(report.coverage?.testAttribution).toBe("coverage-map");
      const mapped = report.recommendedTests.find((t) => t.testPath === "tests/util.test.ts");
      expect(mapped?.evidence).toBe("verified");
      expect(mapped?.reason).toMatch(/Coverage map/i);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

function isTestPath(file: string): boolean {
  return /\.(test|spec)\./i.test(file) || file.includes("__tests__");
}
