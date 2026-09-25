import { spawnSync } from "node:child_process";

import { analyzeChanges } from "../../core/changes/analyze.js";
import { analyzeContextHealth } from "../../core/context-health/analyze.js";
import { resolveRepoRoot } from "../../utils/path.js";
import { scan } from "../../core/scanner/scan.js";

export interface PrReviewFinding {
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  file?: string;
  line?: number;
  confidence: "high" | "medium" | "low";
  source: "scan" | "context-health" | "changes";
}

export interface PrReviewReport {
  root: string;
  mode: "local" | "github-dry-run";
  baseRef: string | null;
  headRef: string | null;
  findings: PrReviewFinding[];
  commentMarkdown: string;
  limitations: string[];
  posted: false;
}

function redactSecretsInText(text: string): string {
  return text
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]")
    .replace(/\bghp_[A-Za-z0-9]{36}\b/g, "[REDACTED]")
    .replace(/-----BEGIN [^-]+PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]");
}

function buildComment(findings: PrReviewFinding[]): string {
  const lines = [
    "## AgentDoctor PR review (local)",
    "",
    "_Generated locally. Secrets are redacted. Nothing was posted to GitHub._",
    "",
  ];
  if (findings.length === 0) {
    lines.push("No actionable findings in local analysis.");
    return lines.join("\n");
  }
  for (const f of findings) {
    const loc = f.file ? ` \`${f.file}${f.line ? `:${f.line}` : ""}\`` : "";
    lines.push(
      `- **${f.severity}** (${f.confidence}) ${redactSecretsInText(f.title)}${loc}: ${redactSecretsInText(f.message)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Local PR review. Never posts to GitHub unless a future explicit command is added.
 * GitHub token is unused; dry-run is the only supported remote mode.
 */
export async function analyzePullRequest(options: {
  root: string;
  baseRef?: string;
  dryRun?: boolean;
}): Promise<PrReviewReport> {
  const root = resolveRepoRoot(options.root);
  const limitations: string[] = [
    "GitHub comment posting is disabled; use --dry-run / local mode only",
    "Optional GitHub API integration requires explicit future invocation with a token",
  ];

  const baseRef = options.baseRef ?? null;
  const changes = await analyzeChanges({
    root,
    ...(baseRef ? { since: baseRef } : {}),
  });
  const context = await analyzeContextHealth(root);
  const scanResult = await scan({ cwd: root });

  const findings: PrReviewFinding[] = [];

  for (const f of scanResult.findings.filter(
    (x) => x.severity === "critical" || x.severity === "warning",
  )) {
    findings.push({
      severity: f.severity,
      title: f.title,
      message: f.message,
      ...(f.evidence?.path ? { file: f.evidence.path } : {}),
      ...(typeof f.evidence?.line === "number" ? { line: f.evidence.line } : {}),
      confidence: "high",
      source: "scan",
    });
  }

  for (const c of context.conflicts) {
    findings.push({
      severity: c.severity === "warning" ? "warning" : "info",
      title: c.kind,
      message: c.message,
      ...(c.files[0] ? { file: c.files[0] } : {}),
      confidence: "medium",
      source: "context-health",
    });
  }

  if (changes.gitAvailable && changes.files.length > 0) {
    findings.push({
      severity: "info",
      title: "changed-files",
      message: `${changes.files.length} changed file(s) in working tree / range`,
      confidence: "high",
      source: "changes",
    });
  } else if (!changes.gitAvailable) {
    limitations.push(...changes.limitations);
  }

  let headRef: string | null = changes.head;
  if (!headRef) {
    const probe = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    });
    headRef = probe.status === 0 ? probe.stdout.trim() : null;
  }

  return {
    root,
    mode: options.dryRun === false ? "local" : "github-dry-run",
    baseRef,
    headRef,
    findings,
    commentMarkdown: buildComment(findings),
    limitations,
    posted: false,
  };
}
