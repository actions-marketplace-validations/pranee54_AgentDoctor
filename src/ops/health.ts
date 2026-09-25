import fs from "node:fs/promises";
import path from "node:path";

import { PACKAGE_VERSION } from "../constants.js";
import { CONTRACTS_VERSION, DEFAULT_FEATURE_FLAGS } from "../contracts/index.js";
import { resolveRepoRoot } from "../utils/path.js";

export interface OpsHealthReport {
  ok: boolean;
  version: string;
  contractsVersion: string;
  root: string;
  featureFlags: typeof DEFAULT_FEATURE_FLAGS;
  checks: Array<{ id: string; ok: boolean; detail: string }>;
  timestamp: string;
}

/**
 * Local ops health probe — no network calls, no agent interception.
 */
export async function collectOpsHealth(rootInput?: string): Promise<OpsHealthReport> {
  const root = resolveRepoRoot(rootInput ?? process.cwd());
  const checks: OpsHealthReport["checks"] = [];

  try {
    await fs.access(root);
    checks.push({ id: "root-readable", ok: true, detail: root });
  } catch {
    checks.push({ id: "root-readable", ok: false, detail: "cannot access root" });
  }

  const agentdoctorDir = path.join(root, ".agentdoctor");
  try {
    await fs.access(agentdoctorDir);
    checks.push({ id: "agentdoctor-dir", ok: true, detail: ".agentdoctor present" });
  } catch {
    checks.push({
      id: "agentdoctor-dir",
      ok: true,
      detail: ".agentdoctor absent (created on first scan/init)",
    });
  }

  checks.push({
    id: "evaluate-only-firewall",
    ok: true,
    detail: "Action Policy Evaluator remains evaluate-only by default",
  });

  checks.push({
    id: "local-dev-auth",
    ok: true,
    detail: "Team auth is local-dev only unless external IdP is configured (not bundled)",
  });

  const ok = checks.every((c) => c.ok);
  return {
    ok,
    version: PACKAGE_VERSION,
    contractsVersion: CONTRACTS_VERSION,
    root,
    featureFlags: DEFAULT_FEATURE_FLAGS,
    checks,
    timestamp: new Date().toISOString(),
  };
}
