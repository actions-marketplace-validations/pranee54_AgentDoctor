import { ensurePlatformDir, writeJsonArtifact, writeTextArtifact } from "../store.js";
import type { PlatformFinding, PlatformSnapshot, ReadinessReport } from "../types.js";
import { resolveRepoRoot } from "../../utils/path.js";
import { sanitizeFindingsForExport } from "../security/redact.js";

/**
 * Module O — Security & compliance reporting exports.
 * Findings are secret-redacted before any format is written.
 */
export async function exportReports(options: {
  root: string;
  findings: PlatformFinding[];
  readiness: ReadinessReport;
  snapshot?: PlatformSnapshot;
}): Promise<Record<string, string>> {
  const root = resolveRepoRoot(options.root);
  await ensurePlatformDir(root);
  const findings = sanitizeFindingsForExport(options.findings);
  const snapshot = options.snapshot
    ? { ...options.snapshot, findings: sanitizeFindingsForExport(options.snapshot.findings) }
    : null;
  const outputs: Record<string, string> = {};

  outputs.json = await writeJsonArtifact(root, "reports/findings.json", {
    findings,
    readiness: options.readiness,
    snapshot,
  });

  const md = [
    "# AgentDoctor 2.0 Report",
    "",
    "## Executive summary",
    "",
    `Findings: ${findings.length}`,
    `Critical/High: ${findings.filter((f) => f.severity === "critical" || f.severity === "high").length}`,
    "",
    options.readiness.overallNote,
    "",
    "## Findings",
    "",
    ...findings.map(
      (f) =>
        `### ${f.title}\n- Severity: ${f.severity}\n- Module: ${f.module}\n- ${f.message}\n- Recommendation: ${f.recommendation}\n- Evidence: ${f.evidence.map((e) => e.detail).join(" | ")}\n`,
    ),
  ].join("\n");
  outputs.markdown = await writeTextArtifact(root, "reports/findings.md", md);

  const csv = [
    "id,module,severity,title,confidence,evidence",
    ...findings.map(
      (f) =>
        `${csvEscape(f.id)},${csvEscape(f.module)},${f.severity},${csvEscape(f.title)},${f.confidence},${csvEscape(f.evidence.map((e) => e.detail).join("; "))}`,
    ),
  ].join("\n");
  outputs.csv = await writeTextArtifact(root, "reports/findings.csv", `${csv}\n`);

  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>AgentDoctor Report</title></head><body><h1>AgentDoctor 2.0</h1><pre>${escapeHtml(md)}</pre></body></html>`;
  outputs.html = await writeTextArtifact(root, "reports/findings.html", html);

  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "AgentDoctor",
            informationUri: "https://github.com/pranee54/AgentDoctor",
          },
        },
        results: findings.map((f) => ({
          ruleId: f.module,
          level: f.severity === "critical" || f.severity === "high" ? "error" : "warning",
          message: { text: f.message },
          properties: {
            evidence: f.evidence.map((e) => e.detail),
          },
          locations: f.evidence[0]?.path
            ? [
                {
                  physicalLocation: {
                    artifactLocation: { uri: f.evidence[0].path },
                    ...(typeof f.evidence[0].line === "number"
                      ? { region: { startLine: f.evidence[0].line } }
                      : {}),
                  },
                },
              ]
            : [],
        })),
      },
    ],
  };
  outputs.sarif = await writeJsonArtifact(root, "reports/findings.sarif.json", sarif);

  return outputs;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
