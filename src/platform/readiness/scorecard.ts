import fs from "node:fs/promises";
import path from "node:path";

import { scan } from "../../core/scanner/scan.js";
import { resolveRepoRoot } from "../../utils/path.js";
import type { PlatformFinding, ReadinessCategory, ReadinessReport } from "../types.js";

/**
 * Module N — Agent readiness scorecard (evidence-backed categories).
 */
export async function buildReadinessScorecard(
  rootInput: string,
  extraFindings: PlatformFinding[] = [],
): Promise<ReadinessReport> {
  const root = resolveRepoRoot(rootInput);
  const result = await scan({ cwd: root });
  const categories: ReadinessCategory[] = [];

  const hasReadme = await exists(path.join(root, "README.md"));
  categories.push({
    id: "documentation",
    title: "Documentation quality",
    score: hasReadme ? 70 : 30,
    evidence: [
      {
        kind: hasReadme ? "verified" : "unknown",
        path: "README.md",
        detail: hasReadme ? "README present" : "README missing",
      },
    ],
    gaps: hasReadme ? [] : ["Add a README with agent setup guidance"],
    recommendations: ["Keep AGENTS.md/CLAUDE.md aligned with Safety scan findings"],
  });

  const hasTests =
    (await exists(path.join(root, "tests"))) || (await exists(path.join(root, "test")));
  categories.push({
    id: "tests",
    title: "Test quality",
    score: hasTests ? 75 : 25,
    evidence: [
      {
        kind: hasTests ? "verified" : "unknown",
        detail: hasTests ? "tests/ or test/ directory present" : "no tests directory",
      },
    ],
    gaps: hasTests ? [] : ["Add automated tests before enabling autonomous agents"],
    recommendations: ["Wire CI to fail on critical Safety findings"],
  });

  const securityFindings = result.findings.filter((f) => f.category === "security");
  const secScore = Math.max(0, 100 - securityFindings.length * 15);
  categories.push({
    id: "security",
    title: "Security controls",
    score: secScore,
    evidence: securityFindings.slice(0, 5).map((f) => {
      const ref: { kind: "verified"; detail: string; path?: string } = {
        kind: "verified",
        detail: f.title,
      };
      if (f.evidence?.path) ref.path = f.evidence.path;
      return ref;
    }),
    gaps: securityFindings.map((f) => f.title),
    recommendations: ["Run agentdoctor secrets --json for opt-in content hygiene"],
  });

  const criticalExtra = extraFindings.filter(
    (f) => f.severity === "critical" || f.severity === "high",
  );
  categories.push({
    id: "agent-policies",
    title: "Agent policies & context security",
    score: Math.max(0, 100 - criticalExtra.length * 20),
    evidence: criticalExtra.slice(0, 5).map((f) => {
      const ref: { kind: "inferred"; detail: string; path?: string } = {
        kind: "inferred",
        detail: f.title,
      };
      if (f.evidence[0]?.path) ref.path = f.evidence[0].path;
      return ref;
    }),
    gaps: criticalExtra.map((f) => f.title),
    recommendations: [
      "Configure .agentdoctor/platform/firewall-policy.json (Action Policy Evaluator)",
    ],
  });

  const overallNote =
    "Scores are category evidence summaries — not a single unexplained rating. " +
    "Improve gaps before expanding agent autonomy.";

  return {
    root,
    categories,
    overallNote,
    limitations: [
      "CI/CD maturity and observability are only partially assessed in this MVP",
      "Ownership metadata requires CODEOWNERS for higher confidence",
    ],
  };
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
