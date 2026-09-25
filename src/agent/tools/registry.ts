import type { AgentRiskLevel, AgentToolName, AgentToolSpec } from "./types.js";

const READ_SPECS: AgentToolSpec[] = [
  {
    name: "read_file",
    description: "READ: Read a UTF-8 text file inside the workspace (path-safe).",
    risk: "LOW",
    category: "read",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, maxBytes: { type: "number" } },
      required: ["path"],
    },
  },
  {
    name: "list_files",
    description: "READ: List repository files (bounded discovery).",
    risk: "LOW",
    category: "read",
    parameters: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
  },
  {
    name: "search_code",
    description: "READ: Search graph nodes by label/path substring.",
    risk: "LOW",
    category: "read",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "find_symbol",
    description: "READ: Lookup symbols by name.",
    risk: "LOW",
    category: "read",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "find_references",
    description: "READ: Refactor/rename impact for a symbol (best-effort references).",
    risk: "LOW",
    category: "read",
    parameters: {
      type: "object",
      properties: { symbol: { type: "string" } },
      required: ["symbol"],
    },
  },
  {
    name: "find_callers",
    description: "READ: Call-graph callers for a symbol/path.",
    risk: "LOW",
    category: "read",
    parameters: {
      type: "object",
      properties: { target: { type: "string" } },
      required: ["target"],
    },
  },
  {
    name: "find_callees",
    description: "READ: Call-graph callees for a symbol/path.",
    risk: "LOW",
    category: "read",
    parameters: {
      type: "object",
      properties: { target: { type: "string" } },
      required: ["target"],
    },
  },
  {
    name: "inspect_project",
    description: "READ: Project fingerprint summary.",
    risk: "LOW",
    category: "read",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "inspect_architecture",
    description: "READ: Architecture contract check + C4 overview.",
    risk: "LOW",
    category: "read",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "inspect_dependencies",
    description: "READ: Dependency edges for a target path/symbol.",
    risk: "LOW",
    category: "read",
    parameters: {
      type: "object",
      properties: { target: { type: "string" } },
      required: ["target"],
    },
  },
  {
    name: "inspect_tests",
    description: "READ: Test-impact analysis for current changes (heuristic).",
    risk: "LOW",
    category: "read",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "inspect_findings",
    description: "READ: AgentDoctor safety scan findings.",
    risk: "LOW",
    category: "read",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "inspect_git_status",
    description: "READ: Git change status (staged/unstaged/untracked).",
    risk: "LOW",
    category: "read",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "inspect_git_diff",
    description: "READ: Change set summary (not full patch dump).",
    risk: "LOW",
    category: "read",
    parameters: { type: "object", properties: { since: { type: "string" } } },
  },
];

const WRITE_SPECS: AgentToolSpec[] = [
  {
    name: "create_file",
    description: "WRITE: Create a new file inside the workspace (requires approval).",
    risk: "MEDIUM",
    category: "write",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "WRITE: Edit a file (exact replace, line range, or full content) with diff.",
    risk: "MEDIUM",
    category: "write",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        oldContent: { type: "string" },
        startLine: { type: "number" },
        endLine: { type: "number" },
        replacement: { type: "string" },
      },
      required: ["path"],
    },
  },
  {
    name: "delete_file",
    description: "WRITE: Delete a file inside the workspace (HIGH risk).",
    risk: "HIGH",
    category: "write",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
];

const EXEC_SPECS: AgentToolSpec[] = [
  {
    name: "run_command",
    description: "EXECUTE: Run a controlled argv command (policy + shell=false).",
    risk: "MEDIUM",
    category: "execute",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        argv: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "run_tests",
    description: "EXECUTE: Run project tests via controlled runner.",
    risk: "MEDIUM",
    category: "execute",
    parameters: {
      type: "object",
      properties: { command: { type: "string" } },
    },
  },
];

export function listAgentToolSpecs(options?: {
  includeWrite?: boolean;
  includeExecute?: boolean;
}): AgentToolSpec[] {
  const out = [...READ_SPECS];
  if (options?.includeWrite) out.push(...WRITE_SPECS);
  if (options?.includeExecute) out.push(...EXEC_SPECS);
  return out;
}

export function getToolSpec(name: AgentToolName): AgentToolSpec | undefined {
  return listAgentToolSpecs({ includeWrite: true, includeExecute: true }).find(
    (t) => t.name === name,
  );
}

export function riskForTool(name: AgentToolName): AgentRiskLevel {
  return getToolSpec(name)?.risk ?? "CRITICAL";
}
