import fs from "node:fs/promises";
import path from "node:path";

import { analyzeChanges } from "../../core/changes/analyze.js";
import { loadCoverage } from "../../coverage/load.js";
import type { CoverageFormat, NormalizedCoverage } from "../../coverage/types.js";
import { normalizeCoveragePath } from "../../coverage/types.js";
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

export interface CoverageImpactSummary {
  format: CoverageFormat;
  filesWithHits: number;
  changedCoveredLines: number;
  changedUncoveredLines: number;
  coverageHits: number;
  /** How recommended tests were attributed. */
  testAttribution: "coverage-map" | "hybrid-heuristic" | "none";
}

export interface TestImpactReport {
  root: string;
  gitAvailable: boolean;
  mode: "coverage-backed" | "heuristic";
  changedFiles: string[];
  recommendedTests: TestImpactItem[];
  relatedModules: string[];
  uncoveredAreas: string[];
  missingTestWarnings: MissingTestWarning[];
  skipRisk: string;
  coverage: CoverageImpactSummary | null;
  limitations: string[];
}

export interface AnalyzeTestImpactOptions {
  root?: string;
  coveragePath?: string;
  since?: string;
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

function isTestPath(file: string): boolean {
  return /\.(test|spec)\./i.test(file) || file.includes("__tests__");
}

function heuristicCandidates(file: string): string[] {
  const ext = path.extname(file);
  const base = ext ? file.slice(0, -ext.length) : file;
  return [
    `${base}.test${ext || ".ts"}`,
    `${base}.spec${ext || ".ts"}`,
    file.replace(/\/src\//, "/tests/"),
    file.replace(/^src\//, "tests/"),
  ].filter((c, i, arr) => c !== file && arr.indexOf(c) === i);
}

function coverageFileFor(changed: string, coverage: NormalizedCoverage): string | null {
  const norm = normalizeCoveragePath(changed);
  if (coverage.files[norm]) return norm;
  // Match by suffix (absolute paths in LCOV vs repo-relative changed paths)
  const keys = Object.keys(coverage.files);
  const suffixHit = keys.find(
    (k) => k === norm || k.endsWith(`/${norm}`) || norm.endsWith(`/${k}`),
  );
  return suffixHit ?? null;
}

function countLineHits(fileCov: { lines: Record<number, number> } | undefined): {
  covered: number;
  uncovered: number;
  hits: number;
} {
  if (!fileCov) return { covered: 0, uncovered: 0, hits: 0 };
  let covered = 0;
  let uncovered = 0;
  let hits = 0;
  for (const h of Object.values(fileCov.lines)) {
    if (h > 0) {
      covered += 1;
      hits += h;
    } else {
      uncovered += 1;
    }
  }
  return { covered, uncovered, hits };
}

function testsFromCoverageMap(coverage: NormalizedCoverage, sourceKey: string): string[] {
  const fileCov = coverage.files[sourceKey];
  const fromFile = fileCov?.coveredByTests ?? [];
  const fromMap: string[] = [];
  if (coverage.testToFiles) {
    for (const [test, sources] of Object.entries(coverage.testToFiles)) {
      if (
        sources.some(
          (s) => s === sourceKey || s.endsWith(`/${sourceKey}`) || sourceKey.endsWith(`/${s}`),
        )
      ) {
        fromMap.push(test);
      }
    }
  }
  return [...new Set([...fromFile, ...fromMap].map(normalizeCoveragePath))].sort();
}

/**
 * Module H — Test impact analysis.
 * Heuristic by default; coverage-backed when a coverage file is loaded and used
 * for changed-line evidence. Never claims tests passed.
 */
export async function analyzeTestImpact(
  rootInput: string | AnalyzeTestImpactOptions,
  maybeOptions?: AnalyzeTestImpactOptions,
): Promise<TestImpactReport> {
  // Support both analyzeTestImpact(root) and analyzeTestImpact({ root, ... })
  const options: AnalyzeTestImpactOptions =
    typeof rootInput === "string" ? { ...(maybeOptions ?? {}), root: rootInput } : rootInput;

  const root = resolveRepoRoot(options.root ?? process.cwd());
  const changes = await analyzeChanges({
    root,
    impact: true,
    ...(options.since ? { since: options.since } : {}),
  });
  const changed = changes.files.map((f) => f.path);
  const recommended: TestImpactItem[] = [];
  const uncovered: string[] = [];
  const missingTestWarnings: MissingTestWarning[] = [];
  const allModules = new Set<string>();
  const limitations: string[] = [
    "Does not execute tests; never claims pass/fail",
    ...changes.limitations,
  ];

  let coverage: NormalizedCoverage | null = null;
  let coverageSummary: CoverageImpactSummary | null = null;
  let mode: "coverage-backed" | "heuristic" = "heuristic";
  let testAttribution: CoverageImpactSummary["testAttribution"] = "none";

  if (options.coveragePath) {
    try {
      coverage = await loadCoverage(options.coveragePath);
      if (Object.keys(coverage.files).length === 0) {
        limitations.push(
          `Coverage path provided but no file hits loaded (${coverage.format}): ${options.coveragePath}`,
        );
        limitations.push(...coverage.limitations);
        coverage = null;
      } else {
        limitations.push(...coverage.limitations);
      }
    } catch (error) {
      limitations.push(
        `Failed to load coverage from ${options.coveragePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
      coverage = null;
    }
  }

  if (!changes.gitAvailable) {
    return {
      root,
      gitAvailable: false,
      mode: "heuristic",
      changedFiles: [],
      recommendedTests: [],
      relatedModules: [],
      uncoveredAreas: [],
      missingTestWarnings: [],
      skipRisk: "Git not available — cannot infer changed files",
      coverage: null,
      limitations: ["Requires a git working tree to detect changes", ...limitations],
    };
  }

  let changedCoveredLines = 0;
  let changedUncoveredLines = 0;
  let coverageHits = 0;
  let filesWithHits = 0;
  let usedCoverageForChangedLines = false;
  let usedCoverageTestMap = false;
  let usedHeuristicForTests = false;

  for (const fileEntry of changes.files) {
    const file = fileEntry.path;
    const relatedModules = modulesForPath(file, fileEntry.modules);
    for (const m of relatedModules) allModules.add(m);

    if (isTestPath(file)) {
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

    // Coverage-backed changed-line evidence
    if (coverage) {
      const covKey = coverageFileFor(file, coverage);
      if (covKey) {
        const counts = countLineHits(coverage.files[covKey]);
        changedCoveredLines += counts.covered;
        changedUncoveredLines += counts.uncovered;
        coverageHits += counts.hits;
        if (counts.covered + counts.uncovered > 0) {
          usedCoverageForChangedLines = true;
          filesWithHits += 1;
        }

        const mappedTests = testsFromCoverageMap(coverage, covKey);
        if (mappedTests.length > 0) {
          usedCoverageTestMap = true;
          for (const testPath of mappedTests) {
            const exists = await fileExists(root, testPath);
            recommended.push({
              testPath,
              reason: `Coverage map links test to changed source ${file}`,
              confidence: exists ? 0.9 : 0.75,
              evidence: "verified",
              exists,
              relatedModules,
            });
          }
        } else {
          // Hybrid: coverage proves line hits; tests from naming heuristic
          usedHeuristicForTests = true;
          const candidates = heuristicCandidates(file);
          let anyExists = false;
          for (const c of candidates) {
            const exists = await fileExists(root, c);
            if (exists) anyExists = true;
            recommended.push({
              testPath: c,
              reason: exists
                ? `Heuristic test candidate for coverage-touched file ${file} (no test→source map)`
                : `Suggested test path for coverage-touched file ${file} (not found; no test→source map)`,
              confidence: exists ? 0.65 : 0.35,
              evidence: "inferred",
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
        continue;
      }
    }

    // Pure heuristic path (no coverage for this file, or no coverage loaded)
    const candidates = heuristicCandidates(file);
    let anyExists = false;
    for (const c of candidates) {
      const exists = await fileExists(root, c);
      if (exists) anyExists = true;
      recommended.push({
        testPath: c,
        reason: exists
          ? `Existing test candidate for changed file ${file} (naming heuristic)`
          : `Suggested test path for changed file ${file} (file not found; naming heuristic)`,
        confidence: exists ? 0.7 : 0.4,
        evidence: "inferred",
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

  if (usedCoverageForChangedLines) {
    mode = "coverage-backed";
    if (usedCoverageTestMap && usedHeuristicForTests) {
      testAttribution = "hybrid-heuristic";
      limitations.push(
        "mode=coverage-backed: changed-line evidence from coverage; some tests attributed via naming heuristic (hybrid)",
      );
    } else if (usedCoverageTestMap) {
      testAttribution = "coverage-map";
      limitations.push("mode=coverage-backed: test attribution from coverage test→source map");
    } else {
      testAttribution = "hybrid-heuristic";
      limitations.push(
        "mode=coverage-backed: coverage used for changed-line hits; test list uses naming heuristics because coverage lacks test→source map",
      );
    }
    coverageSummary = {
      format: coverage!.format,
      filesWithHits,
      changedCoveredLines,
      changedUncoveredLines,
      coverageHits,
      testAttribution,
    };
  } else {
    mode = "heuristic";
    limitations.push(
      "Impact mapping is path/naming heuristic — not coverage-backed (no usable coverage intersection with changed files)",
    );
    if (coverage) {
      limitations.push(
        "Coverage file was loaded but did not intersect changed source paths for line evidence",
      );
      coverageSummary = {
        format: coverage.format,
        filesWithHits: Object.keys(coverage.files).length,
        changedCoveredLines: 0,
        changedUncoveredLines: 0,
        coverageHits: 0,
        testAttribution: "none",
      };
    }
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
    mode,
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
    coverage: coverageSummary,
    limitations,
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
    `  mode: ${report.mode}`,
    `  git: ${report.gitAvailable ? "available" : "unavailable"}`,
    `  changed files: ${report.changedFiles.length}`,
    `  recommended tests: ${report.recommendedTests.length}`,
    `  missing-test warnings: ${report.missingTestWarnings.length}`,
    `  related modules: ${report.relatedModules.slice(0, 12).join(", ") || "(none)"}`,
    `  skip risk: ${report.skipRisk}`,
  ];
  if (report.coverage) {
    lines.push(
      `  coverage: format=${report.coverage.format} filesWithHits=${report.coverage.filesWithHits} coveredLines=${report.coverage.changedCoveredLines} uncoveredLines=${report.coverage.changedUncoveredLines} hits=${report.coverage.coverageHits} testAttribution=${report.coverage.testAttribution}`,
    );
  }
  if (report.recommendedTests.length) {
    lines.push("  affected tests:");
    for (const t of report.recommendedTests.slice(0, 20)) {
      lines.push(
        `    - ${t.testPath} (exists=${t.exists}, confidence=${t.confidence}, evidence=${t.evidence}, ${t.reason})`,
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
