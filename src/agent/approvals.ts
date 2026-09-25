import type { AgentRiskLevel, AgentToolName } from "./tools/types.js";
import { riskForTool } from "./tools/registry.js";

export type ApprovalDecision = "allow" | "deny" | "require-approval";

export interface ApprovalRequest {
  action: string;
  risk: AgentRiskLevel;
  toolName?: AgentToolName;
  detail?: string;
}

export interface ApprovalResult {
  decision: ApprovalDecision;
  risk: AgentRiskLevel;
  reason: string;
  /** True when a human must confirm before continuing */
  needsHumanApproval: boolean;
}

/**
 * Risk-based approval gate. The model cannot approve its own actions.
 * Human approval is represented by an explicit `approvedByHuman` flag from CLI/UI.
 */
export function evaluateApproval(
  request: ApprovalRequest,
  options?: { approvedByHuman?: boolean; allowAutoLow?: boolean },
): ApprovalResult {
  const risk = request.toolName ? riskForTool(request.toolName) : request.risk;
  const approved = options?.approvedByHuman === true;
  const autoLow = options?.allowAutoLow !== false;

  if (risk === "LOW" && autoLow) {
    return {
      decision: "allow",
      risk,
      reason: "LOW risk read/search action auto-allowed",
      needsHumanApproval: false,
    };
  }

  if (approved) {
    return {
      decision: "allow",
      risk,
      reason: "Explicit human approval granted",
      needsHumanApproval: false,
    };
  }

  if (risk === "CRITICAL") {
    return {
      decision: "require-approval",
      risk,
      reason: "CRITICAL actions always require explicit human approval",
      needsHumanApproval: true,
    };
  }

  if (risk === "HIGH") {
    return {
      decision: "require-approval",
      risk,
      reason: "HIGH risk actions require explicit human approval",
      needsHumanApproval: true,
    };
  }

  // MEDIUM
  return {
    decision: "require-approval",
    risk,
    reason: "MEDIUM risk actions require explicit human approval before mutation/execution",
    needsHumanApproval: true,
  };
}

export function formatApprovalPrompt(request: ApprovalRequest, result: ApprovalResult): string {
  return [
    "APPROVAL REQUIRED",
    `Action: ${request.action}`,
    `Risk: ${result.risk}`,
    `Reason: ${result.reason}`,
    request.detail ? `Detail: ${request.detail}` : "",
    "",
    "The model cannot approve this action.",
    "Confirm explicitly in the CLI/UI to continue.",
    "",
  ]
    .filter(Boolean)
    .join("\n");
}
