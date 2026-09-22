import { buildRepositoryGraph } from "./graph/build.js";
import { analyzeCodeHealth } from "./health/analyze.js";
import { analyzeContextSecurity } from "./context-security/analyze.js";
import { analyzeKnowledgeGovernance } from "./knowledge/analyze.js";
import { analyzeArchitectureDrift } from "./architecture/drift.js";
import { analyzeAiChangeQuality } from "./ai-quality/analyze.js";
import {
  analyzeTestImpact,
  persistTestImpactReport,
  type TestImpactReport,
} from "./test-impact/analyze.js";
import { buildReadinessScorecard } from "./readiness/scorecard.js";
import { exportReports } from "./reports/export.js";
import { ensurePlatformDir, writeJsonArtifact } from "./store.js";
import { ensureAuthConfig } from "./auth/local.js";
import { loadFirewallPolicy } from "./firewall/evaluate.js";
import { sanitizeFindingsForExport } from "./security/redact.js";
import type { PlatformFinding, PlatformSnapshot, TestImpactSnapshot } from "./types.js";
import { resolveRepoRoot } from "../utils/path.js";

export interface PlatformScanResult {
  snapshot: PlatformSnapshot;
  reportPaths: Record<string, string>;
  testImpact: TestImpactReport;
  knowledge: Awaited<ReturnType<typeof analyzeKnowledgeGovernance>>;
}

function toTestImpactSnapshot(report: TestImpactReport): TestImpactSnapshot {
  return {
    gitAvailable: report.gitAvailable,
    changedFiles: report.changedFiles,
    recommendedTests: report.recommendedTests,
    relatedModules: report.relatedModules,
    missingTestWarnings: report.missingTestWarnings,
    uncoveredAreas: report.uncoveredAreas,
    skipRisk: report.skipRisk,
    limitations: report.limitations,
  };
}

/**
 * Orchestrate AgentDoctor 2.0 local platform scan (Modules A–O subset).
 */
export async function runPlatformScan(rootInput: string): Promise<PlatformScanResult> {
  const root = resolveRepoRoot(rootInput);
  await ensurePlatformDir(root);
  await ensureAuthConfig(root);
  await loadFirewallPolicy(root);

  const graph = await buildRepositoryGraph(root);
  const health = await analyzeCodeHealth(root, graph);
  const ctxsec = await analyzeContextSecurity(root);
  const knowledge = await analyzeKnowledgeGovernance(root);
  const drift = await analyzeArchitectureDrift(root, graph);
  const aiq = await analyzeAiChangeQuality({ root, aiAssisted: "unknown" });
  const testImpact = await analyzeTestImpact(root);

  const findings: PlatformFinding[] = sanitizeFindingsForExport([
    ...health,
    ...ctxsec,
    ...knowledge.findings,
    ...drift,
    ...aiq,
  ]).sort((a, b) => a.id.localeCompare(b.id));

  const readiness = await buildReadinessScorecard(root, findings);
  const testImpactSnapshot = toTestImpactSnapshot(testImpact);

  const snapshot: PlatformSnapshot = {
    version: "2.0",
    root,
    generatedAt: new Date().toISOString(),
    graph,
    findings,
    readiness,
    testImpact: testImpactSnapshot,
    limitations: [
      ...graph.limitations,
      ...knowledge.limitations,
      ...readiness.limitations,
      ...testImpact.limitations,
      "Action Policy Evaluator is evaluate-only — no commands executed and no agents intercepted",
      "Local ?user= roles are not authentication; cloud SSO/RBAC are out of scope",
    ],
  };

  await writeJsonArtifact(root, `snapshots/latest.json`, snapshot);
  const testImpactPath = await persistTestImpactReport(root, testImpact);
  const reportPaths = await exportReports({ root, findings, readiness, snapshot });
  reportPaths.testImpact = testImpactPath;

  return { snapshot, reportPaths, testImpact, knowledge };
}

export * from "./types.js";
export { buildRepositoryGraph } from "./graph/build.js";
export {
  evaluateAgentAction,
  loadFirewallPolicy,
  validateFirewallPolicy,
  EVALUATE_ONLY,
} from "./firewall/evaluate.js";
export {
  createSession,
  appendSessionEvent,
  endSession,
  loadSession,
  listSessions,
  exportSessionMarkdown,
} from "./sessions/store.js";
export { buildProvenance, saveProvenance } from "./provenance/build.js";
export { planContext } from "./tokens/plan.js";
export { analyzeRenameImpact } from "./refactor/impact.js";
export { compareCommits, listRecentCommits } from "./time-machine/compare.js";
export { canAccess, resolveRole, loadLocalAuthConfig } from "./auth/local.js";
export {
  analyzeTestImpact,
  persistTestImpactReport,
  formatTestImpactHuman,
} from "./test-impact/analyze.js";
export {
  redactSecrets,
  redactEvidenceDetail,
  sanitizeFindingsForExport,
  SECRET_REDACTION_MARKER,
} from "./security/redact.js";
export { analyzeKnowledgeGovernance } from "./knowledge/analyze.js";
export { analyzeContextSecurity } from "./context-security/analyze.js";
export { exportReports } from "./reports/export.js";
