import fs from "node:fs/promises";
import path from "node:path";

import { platformDir, writeJsonArtifact } from "../store.js";
import type {
  AgentActionRequest,
  FirewallDecision,
  FirewallVerdict,
  PlatformSeverity,
} from "../types.js";
import { resolveRepoRoot } from "../../utils/path.js";
import { composePolicy } from "../../policy/compose.js";

export interface FirewallPolicyRule {
  id: string;
  actionTypes?: AgentActionRequest["type"][];
  match?: {
    commandContains?: string[];
    commandPatterns?: string[];
    pathPrefix?: string[];
    pathContains?: string[];
  };
  decision: FirewallDecision;
  reason: string;
  riskLevel: PlatformSeverity;
}

export interface FirewallPolicyDocument {
  version: "2.0";
  defaultDecision: FirewallDecision;
  /** When true and policy file is invalid, deny all actions instead of falling back to defaults. */
  failClosed?: boolean;
  /**
   * When set, shell actions that are not already blocked must match at least one allowlist entry
   * (substring match, case-insensitive) or they receive require-approval.
   */
  shellAllowlist?: string[];
  rules: FirewallPolicyRule[];
}

export interface PolicyLoadResult {
  policy: FirewallPolicyDocument;
  source: "file" | "default" | "fail-closed-deny" | "composed";
  validationError?: string;
  composeSources?: Array<"builtin" | "repo">;
}

const EVALUATE_ONLY = "Evaluate-only: no commands are executed and no agents are intercepted.";

const DEFAULT_POLICY: FirewallPolicyDocument = {
  version: "2.0",
  defaultDecision: "require-approval",
  failClosed: false,
  shellAllowlist: [
    "npm test",
    "npm run test",
    "npm --version",
    "npm -v",
    "vitest",
    "eslint",
    "tsc",
    "prettier",
  ],
  rules: [
    {
      id: "block-secret-paths",
      actionTypes: ["file-modify", "file-delete", "file-create", "secret-access"],
      match: {
        pathContains: [
          ".env",
          "id_rsa",
          "id_ed25519",
          "credentials",
          "secrets/",
          ".pem",
          "service-account",
        ],
      },
      decision: "block",
      reason: "Secret-sensitive path",
      riskLevel: "critical",
    },
    {
      id: "deny-prod-deploy",
      actionTypes: ["deploy", "infra"],
      decision: "block",
      reason: "Production/infra changes require out-of-band process",
      riskLevel: "critical",
    },
    {
      id: "network-default-deny",
      actionTypes: ["network"],
      decision: "deny-network",
      reason: "Network access denied by default",
      riskLevel: "high",
    },
    {
      id: "package-install-approval",
      actionTypes: ["package-install"],
      decision: "require-approval",
      reason: "Package installs change supply chain",
      riskLevel: "high",
    },
    {
      id: "allow-safe-dev-paths",
      actionTypes: ["file-modify", "file-create"],
      match: { pathPrefix: ["src/", "tests/", "docs/"] },
      decision: "allow",
      reason: "Allowlisted development paths",
      riskLevel: "low",
    },
  ],
};

const BUILTIN_SHELL_BLOCKS: Array<{
  id: string;
  patterns: RegExp[];
  reason: string;
}> = [
  {
    id: "builtin-rm-recursive",
    patterns: [
      /\brm\s+(-[^\s]*f[^\s]*r|-[^\s]*r[^\s]*f|--recursive)\b/i,
      /\brm\s+-rf\b/i,
      /\brm\s+-fr\b/i,
    ],
    reason: "Recursive deletion pattern",
  },
  {
    id: "builtin-disk-format",
    patterns: [/\bmkfs(\.\w+)?\b/i, /\bdd\s+if=/i, /\bshred\b/i],
    reason: "Disk-formatting / destructive device write pattern",
  },
  {
    id: "builtin-fork-bomb",
    patterns: [/:\(\)\s*\{\s*:\|:&\s*\}\s*;?\s*:/, /\bfork\s*\(\s*\)\s*while/i],
    reason: "Fork-bomb pattern",
  },
  {
    id: "builtin-deploy",
    patterns: [
      /\b(kubectl\s+apply|helm\s+upgrade|terraform\s+apply|pulumi\s+up)\b/i,
      /\b(aws\s+s3\s+sync|gcloud\s+deploy|az\s+deployment)\b/i,
      /\bdocker\s+push\b/i,
      /\bnpm\s+publish\b/i,
    ],
    reason: "Deployment / publish command pattern",
  },
  {
    id: "builtin-network-exfil",
    patterns: [
      /\bcurl\b.*\b(-d|--data|--upload-file|-T)\b/i,
      /\bwget\b.*\b(--post-data|--body-data)\b/i,
      /\bnc\s+-l\b/i,
      /\bcurl\b.*\bhttps?:\/\/[^\s]*(webhook|exfil|pastebin|evil)/i,
    ],
    reason: "Network exfiltration-style pattern",
  },
];

function isFirewallDecision(value: unknown): value is FirewallDecision {
  return (
    value === "allow" ||
    value === "block" ||
    value === "require-approval" ||
    value === "sandbox-only" ||
    value === "deny-network" ||
    value === "deny-secrets"
  );
}

export function validateFirewallPolicy(raw: unknown): {
  ok: boolean;
  policy?: FirewallPolicyDocument;
  error?: string;
} {
  if (!raw || typeof raw !== "object") return { ok: false, error: "policy must be an object" };
  const doc = raw as Record<string, unknown>;
  if (doc.version !== "2.0") return { ok: false, error: 'policy.version must be "2.0"' };
  if (!Array.isArray(doc.rules)) return { ok: false, error: "policy.rules must be an array" };
  if (!isFirewallDecision(doc.defaultDecision)) {
    return { ok: false, error: "policy.defaultDecision is invalid" };
  }
  for (const [i, rule] of doc.rules.entries()) {
    if (!rule || typeof rule !== "object") {
      return { ok: false, error: `rules[${i}] must be an object` };
    }
    const r = rule as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id) return { ok: false, error: `rules[${i}].id required` };
    if (!isFirewallDecision(r.decision)) {
      return { ok: false, error: `rules[${i}].decision invalid` };
    }
  }
  if (doc.shellAllowlist !== undefined && !Array.isArray(doc.shellAllowlist)) {
    return { ok: false, error: "shellAllowlist must be an array of strings" };
  }
  return {
    ok: true,
    policy: {
      version: "2.0",
      defaultDecision: doc.defaultDecision,
      failClosed: Boolean(doc.failClosed),
      ...(Array.isArray(doc.shellAllowlist)
        ? { shellAllowlist: doc.shellAllowlist.filter((s): s is string => typeof s === "string") }
        : {}),
      rules: doc.rules as FirewallPolicyRule[],
    },
  };
}

function denyAllPolicy(reason: string): FirewallPolicyDocument {
  return {
    version: "2.0",
    defaultDecision: "block",
    failClosed: true,
    rules: [
      {
        id: "fail-closed-deny-all",
        decision: "block",
        reason,
        riskLevel: "critical",
      },
    ],
  };
}

/**
 * Load local action-policy document.
 * Layers: composed builtin pack + `.agentdoctor/policy.json` (fail-closed on malformed repo policy),
 * then optional platform `firewall-policy.json` overlay (highest precedence when valid).
 * Invalid platform file + failClosed → deny-all.
 * Invalid platform file + default → composed policy (or DEFAULT_POLICY when compose unavailable).
 */
export async function loadFirewallPolicy(
  root: string,
  options?: { failClosed?: boolean },
): Promise<PolicyLoadResult> {
  const resolved = resolveRepoRoot(root);
  const composed = await composePolicy({ root: resolved });
  if (composed.validationError && composed.failClosed) {
    return {
      policy: composed.policy,
      source: "fail-closed-deny",
      validationError: composed.validationError,
      composeSources: composed.sources,
    };
  }

  const file = path.join(platformDir(resolved), "firewall-policy.json");
  try {
    const raw = await fs.readFile(file, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const failClosed = options?.failClosed === true || composed.failClosed;
      if (failClosed) {
        return {
          policy: denyAllPolicy("Malformed policy JSON; fail-closed deny"),
          source: "fail-closed-deny",
          validationError: "Malformed JSON",
          composeSources: composed.sources,
        };
      }
      return {
        policy: composed.policy,
        source: "composed",
        validationError: "Malformed platform firewall-policy.json; using composed policy",
        composeSources: composed.sources,
      };
    }
    const validated = validateFirewallPolicy(parsed);
    if (!validated.ok || !validated.policy) {
      const fileWantsFailClosed =
        parsed &&
        typeof parsed === "object" &&
        (parsed as { failClosed?: unknown }).failClosed === true;
      const failClosed = options?.failClosed === true || fileWantsFailClosed || composed.failClosed;
      if (failClosed) {
        return {
          policy: denyAllPolicy(`Invalid policy: ${validated.error}`),
          source: "fail-closed-deny",
          ...(validated.error ? { validationError: validated.error } : {}),
          composeSources: composed.sources,
        };
      }
      return {
        policy: composed.policy,
        source: "composed",
        ...(validated.error
          ? { validationError: `Invalid platform policy; using composed (${validated.error})` }
          : {}),
        composeSources: composed.sources,
      };
    }
    // Platform file rules first (highest precedence), then composed builtin+repo rules.
    const merged: FirewallPolicyDocument = {
      version: "2.0",
      defaultDecision: validated.policy.defaultDecision,
      failClosed: validated.policy.failClosed === true || composed.policy.failClosed === true,
      ...(validated.policy.shellAllowlist
        ? { shellAllowlist: validated.policy.shellAllowlist }
        : composed.policy.shellAllowlist
          ? { shellAllowlist: composed.policy.shellAllowlist }
          : {}),
      rules: [...validated.policy.rules, ...composed.policy.rules],
    };
    return {
      policy: merged,
      source: "file",
      composeSources: composed.sources,
    };
  } catch {
    // No platform file: prefer repo-composed policy when `.agentdoctor/policy.json` exists.
    // Otherwise seed DEFAULT_POLICY (includes allow-safe-dev-paths). Do not treat packName
    // alone as a reason to skip DEFAULT_POLICY — compose always names a builtin pack.
    if (composed.sources.includes("repo")) {
      return {
        policy: composed.policy,
        source: "composed",
        composeSources: composed.sources,
      };
    }
    await writeJsonArtifact(resolved, "firewall-policy.json", DEFAULT_POLICY);
    return { policy: DEFAULT_POLICY, source: "default", composeSources: composed.sources };
  }
}

function ruleMatches(rule: FirewallPolicyRule, action: AgentActionRequest): boolean {
  if (rule.actionTypes && !rule.actionTypes.includes(action.type)) return false;
  const cmd = action.params.command ?? "";
  const target = action.params.path ?? action.params.target ?? "";
  const match = rule.match;
  if (!match) return true;
  if (match.commandContains?.length) {
    if (!match.commandContains.some((p) => cmd.toLowerCase().includes(p.toLowerCase()))) {
      return false;
    }
  }
  if (match.commandPatterns?.length) {
    if (
      !match.commandPatterns.some((p) => {
        try {
          return new RegExp(p, "i").test(cmd);
        } catch {
          return false;
        }
      })
    ) {
      return false;
    }
  }
  if (match.pathPrefix?.length) {
    if (!match.pathPrefix.some((p) => target.startsWith(p))) return false;
  }
  if (match.pathContains?.length) {
    if (!match.pathContains.some((p) => target.toLowerCase().includes(p.toLowerCase()))) {
      return false;
    }
  }
  return true;
}

function matchBuiltinShell(cmd: string): { id: string; reason: string } | null {
  for (const rule of BUILTIN_SHELL_BLOCKS) {
    if (rule.patterns.some((re) => re.test(cmd))) {
      return { id: rule.id, reason: rule.reason };
    }
  }
  return null;
}

function verdict(
  actionId: string,
  decision: FirewallDecision,
  reason: string,
  riskLevel: PlatformSeverity,
  policyId?: string,
): FirewallVerdict {
  return {
    actionId,
    decision,
    reason: `${reason}. ${EVALUATE_ONLY}`,
    riskLevel,
    ...(policyId ? { policyId } : {}),
    approvalStatus: decision === "require-approval" ? "pending" : "not-required",
    executionResult: "not-executed",
  };
}

/**
 * Module C — Action Policy Evaluator (compatibility: firewall).
 * Evaluates policies only; never executes the requested action and does not intercept agents.
 */
export async function evaluateAgentAction(
  root: string,
  action: AgentActionRequest,
  options?: { failClosed?: boolean },
): Promise<FirewallVerdict> {
  const loaded = await loadFirewallPolicy(root, options);

  if (action.type === "shell") {
    const cmd = action.params.command ?? "";
    const builtin = matchBuiltinShell(cmd);
    if (builtin) {
      return verdict(action.actionId, "block", builtin.reason, "critical", builtin.id);
    }
  }

  for (const rule of loaded.policy.rules) {
    if (!ruleMatches(rule, action)) continue;
    return verdict(action.actionId, rule.decision, rule.reason, rule.riskLevel, rule.id);
  }

  if (action.type === "shell" && loaded.policy.shellAllowlist?.length) {
    const cmd = (action.params.command ?? "").toLowerCase();
    const allowed = loaded.policy.shellAllowlist.some((entry) => cmd.includes(entry.toLowerCase()));
    if (!allowed) {
      return verdict(
        action.actionId,
        "require-approval",
        "Shell command not on local allowlist",
        "medium",
        "shell-allowlist",
      );
    }
    return verdict(
      action.actionId,
      "allow",
      "Shell command matches local allowlist",
      "low",
      "shell-allowlist",
    );
  }

  const reason =
    loaded.source === "fail-closed-deny"
      ? `Fail-closed deny (${loaded.validationError ?? "invalid policy"})`
      : loaded.source === "default" && loaded.validationError
        ? `No specific rule matched; default policy applied (fallback after: ${loaded.validationError})`
        : "No specific rule matched; default policy applied";

  return verdict(
    action.actionId,
    loaded.policy.defaultDecision,
    reason,
    loaded.source === "fail-closed-deny" ? "critical" : "medium",
    loaded.source === "fail-closed-deny" ? "fail-closed-deny-all" : "default",
  );
}

export { DEFAULT_POLICY, EVALUATE_ONLY };
