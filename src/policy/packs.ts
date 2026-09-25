import type { FirewallPolicyDocument } from "../platform/firewall/evaluate.js";

/**
 * Named policy packs for local evaluation. Packs are declarative documents —
 * loading a pack does not enable runtime interception unless an AgentDoctor
 * enforcement boundary (controlled runner / CI wrapper) is used.
 */
export const POLICY_PACKS: Record<string, FirewallPolicyDocument> = {
  "baseline-safe": {
    version: "2.0",
    defaultDecision: "require-approval",
    failClosed: false,
    shellAllowlist: ["npm test", "npm run test", "vitest", "eslint", "tsc", "prettier"],
    rules: [
      {
        id: "pack-block-secrets",
        actionTypes: ["file-modify", "file-delete", "secret-access"],
        match: { pathContains: [".env", "id_rsa", "credentials", ".pem"] },
        decision: "block",
        reason: "baseline-safe: secret-sensitive path",
        riskLevel: "critical",
      },
      {
        id: "pack-block-destructive",
        actionTypes: ["shell"],
        // Force-push is gated as require-approval (human gate), not a hard block —
        // builtin shell blocks already cover rm -rf; keep drop table here.
        match: { commandContains: ["rm -rf", "drop table"] },
        decision: "block",
        reason: "baseline-safe: destructive operation",
        riskLevel: "critical",
      },
      {
        id: "pack-force-push-approval",
        actionTypes: ["shell"],
        match: { commandContains: ["git push --force", "git push -f"] },
        decision: "require-approval",
        reason: "baseline-safe: force-push requires approval",
        riskLevel: "high",
      },
      {
        id: "pack-allow-safe-dev-paths",
        actionTypes: ["file-modify", "file-create"],
        match: { pathPrefix: ["src/", "tests/", "docs/"] },
        decision: "allow",
        reason: "baseline-safe: allowlisted development paths",
        riskLevel: "low",
      },
      {
        id: "pack-deny-prod-deploy",
        actionTypes: ["deploy", "infra"],
        decision: "block",
        reason: "baseline-safe: production/infra changes require out-of-band process",
        riskLevel: "critical",
      },
      {
        id: "pack-network-default-deny",
        actionTypes: ["network"],
        decision: "deny-network",
        reason: "baseline-safe: network access denied by default",
        riskLevel: "high",
      },
    ],
  },
  "fail-closed-ci": {
    version: "2.0",
    defaultDecision: "block",
    failClosed: true,
    shellAllowlist: ["npm test", "npm run verify", "vitest"],
    rules: [
      {
        id: "ci-deny-network",
        actionTypes: ["network"],
        decision: "block",
        reason: "fail-closed-ci: network blocked",
        riskLevel: "high",
      },
      {
        id: "ci-deny-deploy",
        actionTypes: ["deploy", "infra"],
        decision: "block",
        reason: "fail-closed-ci: deploy blocked",
        riskLevel: "critical",
      },
    ],
  },
};

export function listPolicyPacks(): string[] {
  return Object.keys(POLICY_PACKS);
}

export function getPolicyPack(name: string): FirewallPolicyDocument | null {
  return POLICY_PACKS[name] ?? null;
}
