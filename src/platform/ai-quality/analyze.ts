import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

import { resolveRepoRoot } from "../../utils/path.js";
import type { PlatformFinding } from "../types.js";

/**
 * Module M — AI code quality analysis over git diff (when available).
 * AI attribution is unknown unless provided.
 */
export async function analyzeAiChangeQuality(options: {
  root: string;
  aiAssisted?: boolean | "unknown";
}): Promise<PlatformFinding[]> {
  const root = resolveRepoRoot(options.root);
  const attribution = options.aiAssisted === true ? "ai-assisted" : "unknown";
  const findings: PlatformFinding[] = [];
  const diff = spawnSync("git", ["diff", "--unified=0"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (diff.status !== 0) {
    return [
      {
        id: "aiq_no_diff",
        module: "ai-quality",
        severity: "info",
        title: "No git diff available",
        message: "Cannot analyze working-tree changes",
        recommendation: "Run inside a git repo with local changes",
        confidence: 1,
        evidence: [{ kind: "unknown", detail: "git diff unavailable" }],
      },
    ];
  }
  const text = diff.stdout ?? "";
  const added = text
    .split(/\r?\n/)
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));

  const checks: Array<{ re: RegExp; title: string; severity: PlatformFinding["severity"] }> = [
    { re: /eval\s*\(/, title: "Added eval()", severity: "critical" },
    { re: /innerHTML\s*=/, title: "Added innerHTML assignment", severity: "high" },
    {
      re: /password\s*=\s*['"][^'"]+['"]/i,
      title: "Hardcoded password-like literal",
      severity: "critical",
    },
    { re: /TODO|FIXME/, title: "Added TODO/FIXME in change", severity: "low" },
    { re: /catch\s*\([^)]*\)\s*\{\s*\}/, title: "Added empty catch", severity: "medium" },
  ];

  for (const [i, line] of added.entries()) {
    for (const check of checks) {
      if (!check.re.test(line)) continue;
      findings.push({
        id: `aiq_${createHash("sha1").update(`${check.title}:${i}:${line}`).digest("hex").slice(0, 12)}`,
        module: "ai-quality",
        severity: check.severity,
        title: check.title,
        message: `In working-tree addition (attribution=${attribution}): ${line.slice(0, 120)}`,
        recommendation: "Review before commit; add tests for behavioral changes",
        confidence: 0.6,
        evidence: [{ kind: "inferred", detail: line.slice(0, 160) }],
        falsePositiveWarning: "Diff-line heuristic only",
      });
    }
  }

  return findings.sort((a, b) => a.id.localeCompare(b.id));
}
