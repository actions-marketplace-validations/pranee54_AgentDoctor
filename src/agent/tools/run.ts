import { runControlledCommand } from "../../enforcement/runner.js";
import { resolveRepoRoot } from "../../utils/path.js";

export interface AgentCommandResult {
  ok: boolean;
  blocked: boolean;
  command: string;
  notice: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  durationMs?: number;
  decision: string;
  reason: string;
}

/**
 * Execute a project command only via the existing controlled runner (shell=false by default).
 */
export async function runAgentCommand(options: {
  root: string;
  command?: string;
  argv?: string[];
  execute?: boolean;
  timeoutMs?: number;
}): Promise<AgentCommandResult> {
  const root = resolveRepoRoot(options.root);
  const result = await runControlledCommand({
    root,
    ...(options.command !== undefined ? { command: options.command } : {}),
    ...(options.argv !== undefined ? { argv: options.argv } : {}),
    executeIfAllowed: options.execute !== false,
    useShell: false,
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });

  const decision = result.decision.decision;
  const blocked = decision === "block" || decision === "deny-network";
  const exitOk = result.exitCode === 0;
  const executed = result.decision.executionStatus === "executed";
  const allowed = decision === "allow";

  return {
    ok: allowed && executed && exitOk,
    blocked,
    command: options.command ?? (options.argv ?? []).join(" "),
    notice: result.notice,
    ...(result.stdout !== undefined ? { stdout: result.stdout } : {}),
    ...(result.stderr !== undefined ? { stderr: result.stderr } : {}),
    ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
    ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
    decision,
    reason: result.decision.reason,
  };
}

/** Detect common project test runners from package manifests / markers (best-effort). */
export function inferTestArgv(packageJson: unknown): string[] | null {
  if (!packageJson || typeof packageJson !== "object") return null;
  const scripts = (packageJson as { scripts?: Record<string, string> }).scripts;
  if (scripts?.test) {
    // Prefer npm test when package.json present — argv form for shell=false
    return ["npm", "test"];
  }
  return null;
}
