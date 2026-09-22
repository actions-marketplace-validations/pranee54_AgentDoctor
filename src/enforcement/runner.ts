import { createHash, randomUUID } from "node:crypto";
import { createHmac } from "node:crypto";

import type { PolicyDecisionContract } from "../contracts/index.js";
import { evaluateAgentAction, EVALUATE_ONLY } from "../platform/firewall/evaluate.js";
import type { AgentActionRequest } from "../platform/types.js";

export interface EnforcementResult {
  decision: PolicyDecisionContract;
  enforced: boolean;
  notice: string;
}

/**
 * AgentDoctor-controlled command runner.
 * Only this boundary can mark execution as blocked-by-enforcement when it refuses to run.
 */
export async function runControlledCommand(options: {
  root: string;
  command: string;
  failClosed?: boolean;
  /** When true, actually attempt execution only if policy allows — still default false. */
  executeIfAllowed?: boolean;
}): Promise<EnforcementResult> {
  const action: AgentActionRequest = {
    actionId: randomUUID(),
    agentId: "enforcement-runner",
    timestamp: new Date().toISOString(),
    type: "shell",
    params: { command: options.command },
    repositoryRoot: options.root,
  };
  const verdict = await evaluateAgentAction(options.root, action, {
    failClosed: options.failClosed === true,
  });

  const blocked = verdict.decision === "block" || verdict.decision === "deny-network";
  const decision: PolicyDecisionContract = {
    actionId: verdict.actionId,
    decision: verdict.decision,
    reason: verdict.reason,
    ...(verdict.policyId ? { policyId: verdict.policyId } : {}),
    policyVersion: "2.0",
    inputClassification: "shell",
    evidence: [{ id: "ev_policy", kind: "observed", detail: verdict.reason }],
    riskLevel: verdict.riskLevel,
    executionStatus: blocked
      ? "blocked-by-enforcement"
      : options.executeIfAllowed && verdict.decision === "allow"
        ? "not-executed"
        : "not-executed",
    approvalStatus: verdict.approvalStatus,
    timestamp: new Date().toISOString(),
  };

  return {
    decision,
    enforced: blocked,
    notice: blocked
      ? `Blocked by AgentDoctor-controlled runner. ${EVALUATE_ONLY}`
      : `Policy ${verdict.decision}; runner did not execute. ${EVALUATE_ONLY}`,
  };
}

/** Append-only tamper-evident audit chain (HMAC over previous hash). */
export function appendAuditChain(
  previousHash: string | null,
  record: unknown,
  secret = "local-dev-audit-key",
): { hash: string; payload: string } {
  const body = JSON.stringify(record);
  const hash = createHmac("sha256", secret)
    .update(`${previousHash ?? "GENESIS"}:${body}`)
    .digest("hex");
  return { hash, payload: body };
}

export function auditRecordId(parts: string): string {
  return `audit_${createHash("sha1").update(parts).digest("hex").slice(0, 12)}`;
}
