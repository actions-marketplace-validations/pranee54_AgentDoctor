import fs from "node:fs/promises";
import path from "node:path";

import { analyzeChanges } from "../../core/changes/analyze.js";
import { resolveRepoRoot } from "../../utils/path.js";
import type { EvidenceKind } from "../types.js";
import { writeJsonArtifact } from "../store.js";

export interface TestImpactItem {
  testPath: string;
  reason: string;
  confidence: number;
  evidence: EvidenceKind;
  exists: boolean;
  relatedModules: string[];
}

export interface MissingTestWarning {
  sourceFile: string;
  message: string;
  relatedModules: string[];
}

export interface TestImpactReport {
  root: string;
  gitAvailable: boolean;
  changedFiles: string[];
  recommendedTests: TestImpactItem[];
  relatedModules: string[];
  uncoveredAreas: string[];
  missingTestWarnings: MissingTestWarning[];
  skipRisk: string;
  limitations: string[];
}

function modulesForPath(file: string, attributed?: string[]): string[] {
  const mods = new Set<string>(attributed ?? []);
  const parts = file.split("/");
  if (parts[0] === "src" && parts[1]) mods.add(parts[1]);
  if (parts[0] === "tests" && parts[1]) mods.add(parts[1]);
  const base = path.basename(file, path.extname(file));
  if (base && !base.startsWith(".")) mods.add(base);
  return [...mods].sort();
}

async function fileExists(root: string, rel: string): Promise<boolean> {
  try {
    await fs.access(path.join(root, rel));
    return true;
  } catch {
    return false;
  }
}

/**
 * Module H — Test impact analysis (naming + path heuristics).
 * Never claims tests passed unless actually executed elsewhere.
 */
export async function analyzeTestImpact(rootInput: string): Promise<TestImpactReport> {
  const root = resolveRepoRoot(rootInput);
  const changes = await analyzeChanges({ root, impact: true });
  const changed = changes.files.map((f) => f.path);
  const recommended: TestImpactItem[] = [];
  const uncovered: string[] = [];
  const missingTestWarnings: MissingTestWarning[] = [];
  const allModules = new Set<string>();

  if (!changes.gitAvailable) {
    return {
      root,
      gitAvailable: false,
      changedFiles: [],
      recommendedTests: [],
      relatedModules: [],
      uncoveredAreas: [],
      missingTestWarnings: [],
      skipRisk: "Git not available — cannot infer changed files",
      limitations: [
        "Requires a git working tree to detect changes",
        "Does not execute tests; never claims pass/fail",
        ...changes.limitations,
      ],
    };
  }

  for (const fileEntry of changes.files) {
    const file = fileEntry.path;
    const relatedModules = modulesForPath(file, fileEntry.modules);
    for (const m of relatedModules) allModules.add(m);

    if (/\.(test|spec)\./i.test(file) || file.includes("__tests__")) {
      recommended.push({
        testPath: file,
        reason: "Changed file is itself a test",
        confidence: 0.95,
        evidence: "verified",
        exists: true,
        relatedModules,
      });
      continue;
    }

    const ext = path.extname(file);
    const base = ext ? file.slice(0, -ext.length) : file;
    const candidates = [
      `${base}.test${ext || ".ts"}`,
      `${base}.spec${ext || ".ts"}`,
      file.replace(/\/src\//, "/tests/"),
      file.replace(/^src\//, "tests/"),
    ].filter((c, i, arr) => c !== file && arr.indexOf(c) === i);

    let anyExists = false;
    for (const c of candidates) {
      const exists = await fileExists(root, c);
      if (exists) anyExists = true;
      recommended.push({
        testPath: c,
        reason: exists
          ? `Existing test candidate for changed file ${file}`
          : `Suggested test path for changed file ${file} (file not found)`,
        confidence: exists ? 0.7 : 0.4,
        evidence: exists ? "verified" : "inferred",
        exists,
        relatedModules,
      });
    }

    if (candidates.length === 0) {
      uncovered.push(file);
    } else if (!anyExists) {
      missingTestWarnings.push({
        sourceFile: file,
        message: `No co-located or tests/ counterpart found for ${file}`,
        relatedModules,
      });
    }
  }

  for (const rel of changes.impact?.relatedPaths ?? []) {
    for (const m of modulesForPath(rel)) allModules.add(m);
  }

  const seen = new Set<string>();
  const deduped = recommended.filter((r) => {
    if (seen.has(r.testPath)) return false;
    seen.add(r.testPath);
    return true;
  });

  return {
    root,
    gitAvailable: true,
    changedFiles: changed,
    recommendedTests: deduped,
    relatedModules: [...allModules].sort(),
    uncoveredAreas: uncovered,
    missingTestWarnings,
    skipRisk:
      changed.length === 0
        ? "No changes detected"
        : missingTestWarnings.length > 0
          ? "Changed source files lack matching tests — skipping tests risks regressions"
          : "Skipping recommended tests may miss regressions in changed modules",
    limitations: [
      "Impact mapping is path/naming heuristic — not a full coverage DB",
      "Does not execute tests; never claims pass/fail",
      ...changes.limitations,
    ],
  };
}

export async function persistTestImpactReport(
  root: string,
  report: TestImpactReport,
): Promise<string> {
  return writeJsonArtifact(root, "reports/test-impact.json", report);
}

export function formatTestImpactHuman(report: TestImpactReport): string {
  const lines = [
    "AgentDoctor 2.0 test-impact",
    `  git: ${report.gitAvailable ? "available" : "unavailable"}`,
    `  changed files: ${report.changedFiles.length}`,
    `  recommended tests: ${report.recommendedTests.length}`,
    `  missing-test warnings: ${report.missingTestWarnings.length}`,
    `  related modules: ${report.relatedModules.slice(0, 12).join(", ") || "(none)"}`,
    `  skip risk: ${report.skipRisk}`,
  ];
  if (report.recommendedTests.length) {
    lines.push("  affected tests:");
    for (const t of report.recommendedTests.slice(0, 20)) {
      lines.push(
        `    - ${t.testPath} (exists=${t.exists}, confidence=${t.confidence}, ${t.reason})`,
      );
    }
  }
  if (report.missingTestWarnings.length) {
    lines.push("  missing tests:");
    for (const w of report.missingTestWarnings.slice(0, 10)) {
      lines.push(`    - ${w.sourceFile}: ${w.message}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
