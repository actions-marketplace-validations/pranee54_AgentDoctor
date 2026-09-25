import fs from "node:fs/promises";
import path from "node:path";

import { getPolicyPack, POLICY_PACKS } from "./packs.js";
import type { FirewallPolicyDocument, FirewallPolicyRule } from "../platform/firewall/evaluate.js";
import { resolveRepoRoot } from "../utils/path.js";

export interface ComposedPolicyResult {
  policy: FirewallPolicyDocument;
  sources: Array<"builtin" | "repo">;
  packName: string | null;
  validationError?: string;
  failClosed: boolean;
}

const REPO_POLICY_PATH = ".agentdoctor/policy.json";

function denyAll(reason: string): FirewallPolicyDocument {
  return {
    version: "2.0",
    defaultDecision: "block",
    failClosed: true,
    rules: [
      {
        id: "compose-fail-closed",
        decision: "block",
        reason,
        riskLevel: "critical",
      },
    ],
  };
}

function isFirewallPolicyDocument(value: unknown): value is FirewallPolicyDocument {
  if (!value || typeof value !== "object") return false;
  const doc = value as Record<string, unknown>;
  if (doc.version !== "2.0") return false;
  if (typeof doc.defaultDecision !== "string") return false;
  if (!Array.isArray(doc.rules)) return false;
  return true;
}

/**
 * Merge builtin (global pack) + repo `.agentdoctor/policy.json`.
 * Precedence: repo rules are prepended (evaluated first); repo defaultDecision /
 * failClosed / shellAllowlist override builtin when present.
 * Malformed repo policy → fail-closed deny-all (never silently ignore).
 */
export async function composePolicy(options: {
  root: string;
  packName?: string;
}): Promise<ComposedPolicyResult> {
  const root = resolveRepoRoot(options.root);
  const packName = options.packName ?? "baseline-safe";
  const builtin = getPolicyPack(packName) ?? POLICY_PACKS["baseline-safe"]!;
  const sources: Array<"builtin" | "repo"> = ["builtin"];

  const repoPath = path.join(root, REPO_POLICY_PATH);
  let raw: string | null = null;
  try {
    raw = await fs.readFile(repoPath, "utf8");
  } catch {
    raw = null;
  }

  if (raw === null) {
    return {
      policy: structuredClone(builtin),
      sources,
      packName,
      failClosed: Boolean(builtin.failClosed),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      policy: denyAll("Malformed repo .agentdoctor/policy.json; fail-closed"),
      sources: ["builtin", "repo"],
      packName,
      validationError: "Malformed JSON",
      failClosed: true,
    };
  }

  if (!isFirewallPolicyDocument(parsed)) {
    return {
      policy: denyAll("Invalid repo .agentdoctor/policy.json shape; fail-closed"),
      sources: ["builtin", "repo"],
      packName,
      validationError: "Invalid policy document",
      failClosed: true,
    };
  }

  sources.push("repo");
  const repoRules = Array.isArray(parsed.rules) ? (parsed.rules as FirewallPolicyRule[]) : [];
  const merged: FirewallPolicyDocument = {
    version: "2.0",
    defaultDecision: parsed.defaultDecision ?? builtin.defaultDecision,
    failClosed: parsed.failClosed === true || builtin.failClosed === true,
    ...(parsed.shellAllowlist
      ? { shellAllowlist: parsed.shellAllowlist }
      : builtin.shellAllowlist
        ? { shellAllowlist: builtin.shellAllowlist }
        : {}),
    // Repo rules first (higher precedence), then builtin.
    rules: [...repoRules, ...builtin.rules],
  };

  return {
    policy: merged,
    sources,
    packName,
    failClosed: Boolean(merged.failClosed),
  };
}

export function explainComposedDecision(options: {
  command: string;
  decision: string;
  reason: string;
  policyId?: string | null;
  sources: Array<"builtin" | "repo">;
  failClosed: boolean;
}): {
  command: string;
  decision: string;
  reason: string;
  policyId: string | null;
  sources: Array<"builtin" | "repo">;
  failClosed: boolean;
  meaning: string;
} {
  const meaning =
    options.decision === "allow"
      ? "Allowlisted or matched an allow rule — still evaluate-only unless agentdoctor run executes it."
      : options.decision === "block" || options.decision === "deny-network"
        ? "Would be blocked by the AgentDoctor-controlled runner if executed through it."
        : "Requires human approval or further policy before controlled execution.";
  return {
    command: options.command,
    decision: options.decision,
    reason: options.reason,
    policyId: options.policyId ?? null,
    sources: options.sources,
    failClosed: options.failClosed,
    meaning,
  };
}
