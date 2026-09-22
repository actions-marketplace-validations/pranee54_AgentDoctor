import { createHash, randomUUID } from "node:crypto";
import { createHmac } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { realpathSync } from "node:fs";

import type { PolicyDecisionContract } from "../contracts/index.js";
import { evaluateAgentAction, EVALUATE_ONLY } from "../platform/firewall/evaluate.js";
import type { AgentActionRequest } from "../platform/types.js";
import { resolveRepoRoot } from "../utils/path.js";
import { PathEscapeError, assertInsideRepo } from "../security/paths.js";

const execFileAsync = promisify(execFile);

export type ExecutionStatus =
  "executed" | "blocked-by-enforcement" | "not-executed" | "execution-failed";

export interface EnforcementResult {
  decision: PolicyDecisionContract;
  enforced: boolean;
  notice: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  durationMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFER = 1024 * 1024;
const OUTPUT_TRUNCATE = 32_768;

const ENV_ALLOWLIST = new Set(["PATH", "NODE_ENV", "HOME", "LANG"]);

/**
 * Parse a command string into argv without invoking a shell.
 * Supports simple double/single quotes; rejects unclosed quotes.
 */
export function parseArgv(command: string): string[] {
  const trimmed = command.trim();
  if (!trimmed) return [];
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i]!;
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (quote) {
    throw new Error("unclosed quote in command");
  }
  if (current.length > 0) args.push(current);
  return args;
}

export function buildAllowlistedEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) {
    const value = source[key];
    if (typeof value === "string") env[key] = value;
  }
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith("AGENTDOCTOR_") && typeof value === "string") {
      env[key] = value;
    }
  }
  return env;
}

/**
 * Reject path-like args that resolve outside the repository root.
 */
export function assertArgsInsideRoot(args: string[], root: string): void {
  for (const arg of args) {
    if (arg.startsWith("-")) continue;
    const looksLikePath =
      arg.includes("..") || arg.includes("/") || arg.includes("\\") || path.isAbsolute(arg);
    if (!looksLikePath) continue;
    try {
      assertInsideRepo(root, arg);
    } catch (error) {
      if (error instanceof PathEscapeError) {
        throw new Error("path escape rejected");
      }
      throw new Error("path escape rejected");
    }
  }
}

function truncate(text: string, max = OUTPUT_TRUNCATE): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

function resolveRealRoot(rootInput: string): string {
  const resolved = resolveRepoRoot(rootInput);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

async function appendExecutionAudit(root: string, record: Record<string, unknown>): Promise<void> {
  const auditPath = path.join(root, ".agentdoctor", "audit", "execution.jsonl");
  await fs.mkdir(path.dirname(auditPath), { recursive: true });
  let previousHash: string | null = null;
  try {
    const existing = await fs.readFile(auditPath, "utf8");
    const lines = existing.trim().split("\n").filter(Boolean);
    const last = lines[lines.length - 1];
    if (last) {
      const parsed = JSON.parse(last) as { hash?: string };
      previousHash = typeof parsed.hash === "string" ? parsed.hash : null;
    }
  } catch {
    previousHash = null;
  }
  const { hash, payload } = appendAuditChain(previousHash, record);
  const line = `${JSON.stringify({ hash, previousHash, record: JSON.parse(payload) })}\n`;
  await fs.appendFile(auditPath, line, "utf8");
}

async function executeArgv(options: {
  root: string;
  argv: string[];
  timeoutMs: number;
  maxBuffer: number;
  useShell: boolean;
}): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  failed: boolean;
  error?: string;
}> {
  const start = Date.now();
  const env = buildAllowlistedEnv();
  const cwd = options.root;

  if (options.useShell) {
    const command = options.argv.join(" ");
    return await new Promise((resolve) => {
      const child = spawn(command, {
        cwd,
        env,
        shell: true,
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        if (!settled) {
          settled = true;
          resolve({
            stdout: truncate(stdout),
            stderr: truncate(stderr || "timeout"),
            exitCode: null,
            durationMs: Date.now() - start,
            failed: true,
            error: `timeout after ${options.timeoutMs}ms`,
          });
        }
      }, options.timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        if (stdout.length > options.maxBuffer) {
          child.kill("SIGKILL");
        }
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
        if (stderr.length > options.maxBuffer) {
          child.kill("SIGKILL");
        }
      });
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          stdout: truncate(stdout),
          stderr: truncate(stderr),
          exitCode: null,
          durationMs: Date.now() - start,
          failed: true,
          error: err.message,
        });
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          stdout: truncate(stdout),
          stderr: truncate(stderr),
          exitCode: code,
          durationMs: Date.now() - start,
          failed: code !== 0,
        });
      });
    });
  }

  const [file, ...args] = options.argv;
  if (!file) {
    return {
      stdout: "",
      stderr: "empty command",
      exitCode: null,
      durationMs: Date.now() - start,
      failed: true,
      error: "empty command",
    };
  }

  try {
    const result = await execFileAsync(file, args, {
      cwd,
      env,
      timeout: options.timeoutMs,
      maxBuffer: options.maxBuffer,
      windowsHide: true,
      shell: false,
    });
    return {
      stdout: truncate(typeof result.stdout === "string" ? result.stdout : String(result.stdout)),
      stderr: truncate(typeof result.stderr === "string" ? result.stderr : String(result.stderr)),
      exitCode: 0,
      durationMs: Date.now() - start,
      failed: false,
    };
  } catch (error) {
    const err = error as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: number | string;
      killed?: boolean;
      message?: string;
    };
    const exitCode = typeof err.code === "number" ? err.code : null;
    return {
      stdout: truncate(
        typeof err.stdout === "string" ? err.stdout : err.stdout ? String(err.stdout) : "",
      ),
      stderr: truncate(
        typeof err.stderr === "string" ? err.stderr : err.stderr ? String(err.stderr) : "",
      ),
      exitCode,
      durationMs: Date.now() - start,
      failed: true,
      error: err.killed
        ? `timeout after ${options.timeoutMs}ms`
        : (err.message ?? "execution failed"),
    };
  }
}

/**
 * AgentDoctor-controlled command runner.
 * Executes only when executeIfAllowed===true AND policy decision===allow.
 * Default path uses shell:false with argv parsing (no shell metacharacters).
 */
export async function runControlledCommand(options: {
  root: string;
  command?: string;
  argv?: string[];
  failClosed?: boolean;
  /** When true, execute only if policy allows. */
  executeIfAllowed?: boolean;
  /** Explicit high-risk shell mode — requires policy allow as well. */
  useShell?: boolean;
  timeoutMs?: number;
  maxBuffer?: number;
}): Promise<EnforcementResult> {
  const root = resolveRealRoot(options.root);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const useShell = options.useShell === true;

  let argv: string[];
  try {
    argv =
      options.argv && options.argv.length > 0 ? options.argv : parseArgv(options.command ?? "");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildFailedResult(root, message, "not-executed");
  }

  const commandStr = argv.join(" ");
  if (!commandStr) {
    return buildFailedResult(root, "empty command", "not-executed");
  }

  const action: AgentActionRequest = {
    actionId: randomUUID(),
    agentId: "enforcement-runner",
    timestamp: new Date().toISOString(),
    type: "shell",
    params: { command: commandStr },
    repositoryRoot: root,
  };
  const verdict = await evaluateAgentAction(root, action, {
    failClosed: options.failClosed === true,
  });

  const blocked = verdict.decision === "block" || verdict.decision === "deny-network";

  if (blocked) {
    const decision = toDecision(verdict, "blocked-by-enforcement");
    await appendExecutionAudit(root, {
      id: auditRecordId(`${commandStr}:${Date.now()}`),
      command: commandStr,
      argv,
      executionStatus: "blocked-by-enforcement",
      decision: verdict.decision,
      reason: verdict.reason,
      at: new Date().toISOString(),
    });
    return {
      decision,
      enforced: true,
      notice: `Blocked by AgentDoctor-controlled runner. ${verdict.reason}`,
    };
  }

  if (!options.executeIfAllowed || verdict.decision !== "allow") {
    const decision = toDecision(verdict, "not-executed");
    return {
      decision,
      enforced: false,
      notice:
        verdict.decision === "allow"
          ? `Policy allow; runner did not execute (executeIfAllowed=false). ${EVALUATE_ONLY}`
          : `Policy ${verdict.decision}; runner did not execute. ${EVALUATE_ONLY}`,
    };
  }

  if (!useShell) {
    try {
      assertArgsInsideRoot(argv, root);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const decision = toDecision(verdict, "execution-failed", message);
      await appendExecutionAudit(root, {
        id: auditRecordId(`${commandStr}:${Date.now()}`),
        command: commandStr,
        argv,
        executionStatus: "execution-failed",
        reason: message,
        at: new Date().toISOString(),
      });
      return {
        decision,
        enforced: false,
        notice: `Execution failed: ${message}`,
      };
    }
  }

  const execResult = await executeArgv({
    root,
    argv,
    timeoutMs,
    maxBuffer,
    useShell,
  });

  const executionStatus: ExecutionStatus = execResult.failed ? "execution-failed" : "executed";
  const decision = toDecision(
    verdict,
    executionStatus,
    execResult.error,
    useShell ? "HIGH RISK: executed via shell=true (explicit --shell flag)" : undefined,
  );

  await appendExecutionAudit(root, {
    id: auditRecordId(`${commandStr}:${Date.now()}`),
    command: commandStr,
    argv,
    useShell,
    executionStatus,
    exitCode: execResult.exitCode,
    durationMs: execResult.durationMs,
    stdout: execResult.stdout,
    stderr: execResult.stderr,
    ...(execResult.error ? { error: execResult.error } : {}),
    at: new Date().toISOString(),
  });

  return {
    decision,
    enforced: false,
    notice: execResult.failed
      ? `Execution failed${execResult.error ? `: ${execResult.error}` : ""}`
      : useShell
        ? "Executed under AgentDoctor control with shell=true (HIGH RISK)."
        : "Executed under AgentDoctor control (shell=false).",
    stdout: execResult.stdout,
    stderr: execResult.stderr,
    exitCode: execResult.exitCode,
    durationMs: execResult.durationMs,
  };
}

function toDecision(
  verdict: Awaited<ReturnType<typeof evaluateAgentAction>>,
  executionStatus: ExecutionStatus,
  extraReason?: string,
  riskNote?: string,
): PolicyDecisionContract {
  return {
    actionId: verdict.actionId,
    decision: verdict.decision,
    reason: [verdict.reason, extraReason, riskNote].filter(Boolean).join(" | "),
    ...(verdict.policyId ? { policyId: verdict.policyId } : {}),
    policyVersion: "2.0",
    inputClassification: "shell",
    evidence: [{ id: "ev_policy", kind: "observed", detail: verdict.reason }],
    riskLevel: verdict.riskLevel,
    executionStatus,
    approvalStatus: verdict.approvalStatus,
    timestamp: new Date().toISOString(),
  };
}

function buildFailedResult(
  _root: string,
  message: string,
  executionStatus: ExecutionStatus,
): EnforcementResult {
  return {
    decision: {
      actionId: randomUUID(),
      decision: "block",
      reason: message,
      policyVersion: "2.0",
      inputClassification: "shell",
      evidence: [{ id: "ev_parse", kind: "observed", detail: message }],
      riskLevel: "high",
      executionStatus,
      approvalStatus: "not-required",
      timestamp: new Date().toISOString(),
    },
    enforced: executionStatus === "blocked-by-enforcement",
    notice: message,
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

/**
 * Explain what the controlled runner would do for a command (evaluate-only).
 * Does not execute.
 */
export async function explainControlledRun(options: {
  root: string;
  command?: string;
  argv?: string[];
  failClosed?: boolean;
  useShell?: boolean;
}): Promise<{
  command: string;
  argv: string[];
  useShell: boolean;
  decision: string;
  reason: string;
  policyId: string | null;
  riskLevel: string;
  wouldExecute: boolean;
  executionResult: "not-executed";
  notice: string;
  meaning: string;
}> {
  const root = resolveRealRoot(options.root);
  let argv: string[];
  try {
    argv =
      options.argv && options.argv.length > 0 ? options.argv : parseArgv(options.command ?? "");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      command: options.command ?? "",
      argv: [],
      useShell: options.useShell === true,
      decision: "block",
      reason: message,
      policyId: null,
      riskLevel: "high",
      wouldExecute: false,
      executionResult: "not-executed",
      notice: EVALUATE_ONLY,
      meaning: "Command could not be parsed for controlled execution.",
    };
  }
  const commandStr = argv.join(" ");
  const action: AgentActionRequest = {
    actionId: randomUUID(),
    agentId: "enforcement-explain",
    timestamp: new Date().toISOString(),
    type: "shell",
    params: { command: commandStr },
    repositoryRoot: root,
  };
  const verdict = await evaluateAgentAction(root, action, {
    failClosed: options.failClosed === true,
  });
  const wouldExecute = verdict.decision === "allow";
  return {
    command: commandStr,
    argv,
    useShell: options.useShell === true,
    decision: verdict.decision,
    reason: verdict.reason,
    policyId: verdict.policyId ?? null,
    riskLevel: verdict.riskLevel,
    wouldExecute,
    executionResult: "not-executed",
    notice: EVALUATE_ONLY,
    meaning: wouldExecute
      ? "Policy allow — `agentdoctor run` would execute under AgentDoctor control (still not claimed as enterprise interception)."
      : "Policy would block or require approval — controlled runner will not execute.",
  };
}
