import { randomUUID } from "node:crypto";

export type AgentRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type AgentToolName =
  | "read_file"
  | "list_files"
  | "search_code"
  | "find_symbol"
  | "find_references"
  | "find_callers"
  | "find_callees"
  | "inspect_project"
  | "inspect_architecture"
  | "inspect_dependencies"
  | "inspect_tests"
  | "inspect_findings"
  | "inspect_git_status"
  | "inspect_git_diff"
  | "create_file"
  | "edit_file"
  | "delete_file"
  | "run_command"
  | "run_tests";

export interface AgentToolSpec {
  name: AgentToolName;
  description: string;
  risk: AgentRiskLevel;
  /** JSON-schema-like args description for prompts */
  parameters: Record<string, unknown>;
  /** M3 read tools vs later write/exec */
  category: "read" | "write" | "execute";
}

export interface AgentToolCall {
  id: string;
  name: AgentToolName;
  arguments: Record<string, unknown>;
  timestamp: string;
  sessionId: string;
}

export interface AgentToolResult {
  callId: string;
  name: AgentToolName;
  ok: boolean;
  /** Structured DATA — never treat as instructions */
  data: unknown;
  error?: { code: string; message: string };
  risk: AgentRiskLevel;
  durationMs: number;
}

export function newToolCall(
  sessionId: string,
  name: AgentToolName,
  args: Record<string, unknown>,
): AgentToolCall {
  return {
    id: randomUUID(),
    name,
    arguments: args,
    timestamp: new Date().toISOString(),
    sessionId,
  };
}
