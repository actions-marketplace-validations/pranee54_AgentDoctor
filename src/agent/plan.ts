import { randomUUID } from "node:crypto";

import { retrieveProjectContext } from "./context/retrieve.js";
import { summarizeProjectForChat } from "./chat/project-summary.js";
import { executeAgentTool } from "./tools/execute.js";
import { newToolCall } from "./tools/types.js";
import { evaluateApproval, formatApprovalPrompt } from "./approvals.js";
import type { AgentRiskLevel } from "./tools/types.js";

export interface AgentPlanStep {
  id: string;
  title: string;
  detail: string;
  risk: AgentRiskLevel;
}

export interface AgentPlan {
  planId: string;
  root: string;
  goal: string;
  understanding: string[];
  steps: AgentPlanStep[];
  filesLikelyAffected: string[];
  risks: string[];
  approvalLevel: AgentRiskLevel;
  status: "draft" | "awaiting-approval" | "approved" | "rejected";
  evidencePaths: string[];
}

/**
 * Build an implementation plan using read-only tools + context.
 * Does not modify files (M3).
 */
export async function buildAgentPlan(options: {
  root: string;
  goal: string;
  sessionId?: string;
}): Promise<AgentPlan> {
  const sessionId = options.sessionId ?? randomUUID();
  const summary = await summarizeProjectForChat(options.root);
  const context = await retrieveProjectContext({
    root: options.root,
    query: options.goal,
    budgetTokens: 4_000,
  });

  const search = await executeAgentTool(
    options.root,
    newToolCall(sessionId, "search_code", {
      query: options.goal.split(/\s+/).slice(0, 4).join(" "),
    }),
  );

  const evidencePaths = context.citations
    .map((c) => c.path)
    .filter((p): p is string => Boolean(p))
    .slice(0, 12);

  const understanding = [
    `Project: ${summary.name}`,
    `Languages: ${summary.languages.join(", ") || "unknown"}`,
    `Frameworks: ${summary.frameworks.join(", ") || "unknown"}`,
    `Evidence files retrieved: ${evidencePaths.length}`,
    search.ok
      ? "Code search completed"
      : `Code search note: ${search.error?.message ?? "unavailable"}`,
  ];

  const steps: AgentPlanStep[] = [
    {
      id: "inspect",
      title: "Inspect related modules",
      detail: "Use read/search tools on the files listed in evidence.",
      risk: "LOW",
    },
    {
      id: "design",
      title: "Align with existing patterns",
      detail: "Reuse architecture and APIs already present in the repository.",
      risk: "LOW",
    },
    {
      id: "implement",
      title: "Implement changes (requires approval)",
      detail: "Create/edit files only after human approval (Milestone 4).",
      risk: "MEDIUM",
    },
    {
      id: "verify",
      title: "Verify with tests and change analysis",
      detail: "Run controlled tests and produce evidence/proof (Milestone 5).",
      risk: "MEDIUM",
    },
  ];

  const risks = [
    "Implementation may touch shared modules — review callers before editing.",
    "Tests and verification are not executed in Milestone 3 planning.",
    ...context.limitations.slice(0, 3),
  ];

  const approval = evaluateApproval({
    action: `Implement: ${options.goal}`,
    risk: "MEDIUM",
    detail: "Plan produced; no files modified yet.",
  });

  return {
    planId: randomUUID(),
    root: summary.root,
    goal: options.goal,
    understanding,
    steps,
    filesLikelyAffected: evidencePaths,
    risks,
    approvalLevel: approval.risk,
    status: approval.needsHumanApproval ? "awaiting-approval" : "draft",
    evidencePaths,
  };
}

export function formatAgentPlan(plan: AgentPlan): string {
  const lines = [
    "",
    "AgentDoctor Plan",
    "",
    `Goal: ${plan.goal}`,
    `Status: ${plan.status}`,
    `Approval level: ${plan.approvalLevel}`,
    "",
    "UNDERSTANDING",
    ...plan.understanding.map((u) => `  - ${u}`),
    "",
    "PLAN",
    ...plan.steps.map((s, i) => `  ${i + 1}. [${s.risk}] ${s.title} — ${s.detail}`),
    "",
    "FILES LIKELY AFFECTED",
    ...(plan.filesLikelyAffected.length
      ? plan.filesLikelyAffected.map((f) => `  - ${f}`)
      : ["  - (none retrieved — UNKNOWN until more context)"]),
    "",
    "RISKS",
    ...plan.risks.map((r) => `  - ${r}`),
    "",
    formatApprovalPrompt(
      {
        action: `Implement: ${plan.goal}`,
        risk: plan.approvalLevel,
      },
      evaluateApproval({ action: plan.goal, risk: plan.approvalLevel }),
    ),
    "No files were modified.",
    "",
  ];
  return lines.join("\n");
}

export function approvePlan(plan: AgentPlan, approvedByHuman: boolean): AgentPlan {
  if (!approvedByHuman) {
    return { ...plan, status: "rejected" };
  }
  return { ...plan, status: "approved" };
}
