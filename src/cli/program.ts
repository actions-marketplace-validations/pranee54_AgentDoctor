import { Command, InvalidArgumentError } from "commander";

import { PACKAGE_VERSION } from "../constants.js";
import { parseFailOnRules, parseSeverityGate } from "../core/policy/evaluate.js";
import { EXIT_CODES } from "../types/index.js";
import { runBrainMcpCommand } from "./commands/brain-mcp.js";
import { runBrainCommand } from "./commands/brain.js";
import { runDoctorCommand } from "./commands/doctor.js";
import { runExplainCommand } from "./commands/explain.js";
import { runFixCommand } from "./commands/fix.js";
import { resolveTargetArgument, runScanCommand } from "./commands/scan.js";
import { runVerifyCommand } from "./commands/verify.js";
import {
  runBaselineCommand,
  runChangesCommand,
  runContextHealthCommand,
  runDashboardCommand,
  runFixHistoryCommand,
  runFixUndoCommand,
  runLocalAiCommand,
  runPackagesCommand,
  runPluginsCommand,
  runPrReviewCommand,
  runSecretsCommand,
} from "./commands/v2.js";
import { runPlatformCommand } from "./commands/platform.js";
import { runInitCommand, runV2SurfaceCommand } from "./commands/complete.js";
import { runMcpCommand } from "./commands/mcp.js";
import { collectOpsHealth } from "../ops/health.js";
import { listSessions, loadSession } from "../platform/sessions/store.js";
import { exportReports } from "../platform/reports/export.js";
import { runPlatformScan } from "../platform/index.js";

function parseMinScore(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new InvalidArgumentError("--min-score must be a number between 0 and 100");
  }
  return parsed;
}

function readMinScore(options: { minScore?: unknown }): number | undefined {
  if (typeof options.minScore === "number") {
    return options.minScore;
  }
  if (typeof options.minScore === "string") {
    return parseMinScore(options.minScore);
  }
  return undefined;
}

function collectFailOnRules(value: string, previous: string[]): string[] {
  return [...previous, ...parseFailOnRules(value)];
}

function readFailOnSeverity(options: {
  failOnSeverity?: unknown;
}): ReturnType<typeof parseSeverityGate> | undefined {
  if (typeof options.failOnSeverity !== "string" || options.failOnSeverity.length === 0) {
    return undefined;
  }
  return parseSeverityGate(options.failOnSeverity);
}

function readFailOnRules(options: { failOnRule?: unknown }): string[] {
  if (Array.isArray(options.failOnRule)) {
    return options.failOnRule.filter((item): item is string => typeof item === "string");
  }
  if (typeof options.failOnRule === "string") {
    return parseFailOnRules(options.failOnRule);
  }
  return [];
}

/**
 * Scan flags are declared on both the root program and the `scan` subcommand
 * so `--help` stays accurate. Commander stores overlapping flags on the parent
 * when `scan` is invoked, so callers must read `optsWithGlobals()`.
 */
function addScanOptions(command: Command): Command {
  return command
    .option("--json", "Emit machine-readable JSON (no decorative output)", false)
    .option(
      "--ci",
      "CI mode: exit 1 when any critical finding exists (override with --fail-on-severity)",
      false,
    )
    .option("--verbose", "Show timing and extra diagnostics", false)
    .option(
      "--min-score <number>",
      "Exit 1 when overall readiness score is below this (0-100)",
      parseMinScore,
    )
    .option(
      "--fail-on-severity <level>",
      "Exit 1 when any finding has this severity or higher (critical|warning|info)",
      parseSeverityGate,
    )
    .option(
      "--fail-on-rule <id>",
      "Exit 1 when a finding matches this rule id (repeatable or comma-separated)",
      collectFailOnRules,
      [],
    )
    .option(
      "--summary",
      "Write a GitHub Actions step summary when GITHUB_STEP_SUMMARY is set",
      false,
    )
    .option("--annotations", "Emit GitHub Actions annotations for findings (stderr)", false);
}

async function runScanFromCli(pathArg: string | undefined, command: Command): Promise<void> {
  const options = command.optsWithGlobals() as {
    json?: boolean;
    ci?: boolean;
    verbose?: boolean;
    minScore?: unknown;
    failOnSeverity?: unknown;
    failOnRule?: unknown;
    summary?: boolean;
    annotations?: boolean;
  };
  const minScore = readMinScore(options);
  const failOnSeverity = readFailOnSeverity(options);
  const failOnRules = readFailOnRules(options);
  const code = await runScanCommand({
    targetPath: resolveTargetArgument(pathArg),
    json: Boolean(options.json),
    ci: Boolean(options.ci),
    verbose: Boolean(options.verbose),
    summary: Boolean(options.summary),
    annotations: Boolean(options.annotations),
    ...(minScore !== undefined ? { minScore } : {}),
    ...(failOnSeverity !== undefined ? { failOnSeverity } : {}),
    ...(failOnRules.length > 0 ? { failOnRules } : {}),
  });
  process.exitCode = code;
}

export function createProgram(): Command {
  const program = new Command();

  addScanOptions(
    program
      .name("agentdoctor")
      .description(
        "Engineering intelligence and safety for AI coding agents — scan, knowledge, MCP, and verification (local, deterministic; no API key required for core flows).",
      )
      .version(PACKAGE_VERSION, "-V, --version", "Print AgentDoctor version")
      .argument("[path]", "Repository path to scan (default: current directory)"),
  ).action(async (pathArg: string | undefined, _options, command: Command) => {
    await runScanFromCli(pathArg, command);
  });

  addScanOptions(
    program
      .command("scan")
      .description("Scan a repository for AI coding agent configuration issues (default command)")
      .argument("[path]", "Repository path to scan"),
  ).action(async (pathArg: string | undefined, _options, command: Command) => {
    await runScanFromCli(pathArg, command);
  });

  program
    .command("fix")
    .description(
      "Apply safe automatic fixes (.cursorignore, Claude Code Read deny, Codex filesystem deny, .geminiignore, .aiderignore for safe context findings)",
    )
    .argument("[path]", "Repository path (default: current directory)")
    .option("--dry-run", "Show proposed fixes without writing files", false)
    .option("-y, --yes", "Skip confirmation prompts", false)
    .action(async (pathArg: string | undefined, options) => {
      const code = await runFixCommand({
        targetPath: resolveTargetArgument(pathArg),
        dryRun: Boolean(options.dryRun),
        yes: Boolean(options.yes),
      });
      process.exitCode = code;
    });

  program
    .command("fix-undo")
    .description("Restore files from a Safe Fix audit backup")
    .argument("<auditId>", "Audit id from fix-history")
    .argument("[path]", "Repository path (default: current directory)")
    .action(async (auditId: string, pathArg: string | undefined) => {
      process.exitCode = await runFixUndoCommand({
        auditId,
        root: resolveTargetArgument(pathArg),
      });
    });

  program
    .command("fix-history")
    .description("List Safe Fix audit / backup records")
    .argument("[path]", "Repository path (default: current directory)")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, options: { json?: boolean }) => {
      process.exitCode = await runFixHistoryCommand({
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });

  const brain = program.command("brain").description("Project Brain CLI (local, deterministic)");
  brain
    .command("init")
    .description("Ensure Project Brain store directories exist")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { json?: boolean };
      process.exitCode = await runBrainCommand({
        action: "init",
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });
  brain
    .command("status")
    .description("Show Project Brain store status")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { json?: boolean };
      process.exitCode = await runBrainCommand({
        action: "status",
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });
  brain
    .command("inspect")
    .description("Inspect latest Project Brain summary")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { json?: boolean };
      process.exitCode = await runBrainCommand({
        action: "inspect",
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });
  brain
    .command("rebuild")
    .description("Compile and save a new Project Brain snapshot")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { json?: boolean };
      process.exitCode = await runBrainCommand({
        action: "rebuild",
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });
  brain
    .command("history")
    .description("List Project Brain snapshots")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { json?: boolean };
      process.exitCode = await runBrainCommand({
        action: "history",
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });
  brain
    .command("search")
    .description("Search claims/components in the latest brain")
    .argument("<query>", "Search text")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (query: string, pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { json?: boolean };
      process.exitCode = await runBrainCommand({
        action: "search",
        query,
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });
  brain
    .command("export")
    .description("Export a redacted brain snapshot to JSON")
    .requiredOption("--file <path>", "Output file")
    .option("--snapshot <id>", "Snapshot id (default: latest)")
    .argument("[path]", "Repository path")
    .action(async (pathArg: string | undefined, options: { file: string; snapshot?: string }) => {
      process.exitCode = await runBrainCommand({
        action: "export",
        file: options.file,
        ...(options.snapshot ? { snapshotId: options.snapshot } : {}),
        root: resolveTargetArgument(pathArg),
      });
    });
  brain
    .command("import")
    .description("Import a brain JSON snapshot into the local store")
    .requiredOption("--file <path>", "Input file")
    .argument("[path]", "Repository path")
    .action(async (pathArg: string | undefined, options: { file: string }) => {
      process.exitCode = await runBrainCommand({
        action: "import",
        file: options.file,
        root: resolveTargetArgument(pathArg),
      });
    });
  brain
    .command("snapshot")
    .description("Create Brain + Repository Brain product snapshots")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { json?: boolean };
      process.exitCode = await runBrainCommand({
        action: "snapshot",
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });
  brain
    .command("update")
    .description("Rebuild Project Brain and write product snapshot")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { json?: boolean };
      process.exitCode = await runBrainCommand({
        action: "update",
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });
  brain
    .command("review")
    .description("Human review of Repository Brain proposals (never auto-approves)")
    .requiredOption("--artifact <id>", "Proposal artifact id")
    .requiredOption("--decision <status>", "approved|rejected|pending-review|deprecated")
    .option("--note <text>", "Review note")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as {
        artifact: string;
        decision: "approved" | "rejected" | "pending-review" | "deprecated";
        note?: string;
        json?: boolean;
      };
      process.exitCode = await runBrainCommand({
        action: "review",
        artifactId: options.artifact,
        decision: options.decision,
        ...(options.note ? { note: options.note } : {}),
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });
  brain
    .command("proposals")
    .description("List Repository Brain proposal artifacts")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { json?: boolean };
      process.exitCode = await runBrainCommand({
        action: "proposals",
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });

  program
    .command("init")
    .description("Repository Brain initializer — PROPOSED artifacts only (not approved facts)")
    .argument("[path]", "Repository path")
    .option("--name <name>", "Project name")
    .option("--domain <domain>", "Business domain")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as {
        name?: string;
        domain?: string;
        json?: boolean;
      };
      process.exitCode = await runInitCommand({
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
        ...(options.name ? { name: options.name } : {}),
        ...(options.domain ? { domain: options.domain } : {}),
      });
    });

  program
    .command("graph")
    .description("Build intelligence graph (TypeScript AST when available; regex fallback)")
    .argument("[path]", "Repository path")
    .option("--mode <mode>", "auto|regex|typescript-ast", "auto")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { mode?: string; json?: boolean };
      process.exitCode = await runV2SurfaceCommand({
        action: "graph-ast",
        root: resolveTargetArgument(pathArg),
        mode: options.mode ?? "auto",
        json: Boolean(options.json),
      });
    });

  program
    .command("health")
    .description("Git hotspot / engineering intelligence report")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { json?: boolean };
      process.exitCode = await runV2SurfaceCommand({
        action: "health",
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });

  program
    .command("impact")
    .description("Change/test impact analysis")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { json?: boolean };
      process.exitCode = await runV2SurfaceCommand({
        action: "impact",
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });

  program
    .command("test-impact")
    .description("Test-impact analysis (alias of impact)")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { json?: boolean };
      process.exitCode = await runV2SurfaceCommand({
        action: "impact",
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });

  program
    .command("refactor-impact")
    .description("Refactor/rename blast-radius analysis")
    .requiredOption("--symbol <name>", "Symbol to analyze")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { symbol: string; json?: boolean };
      process.exitCode = await runV2SurfaceCommand({
        action: "refactor-impact",
        root: resolveTargetArgument(pathArg),
        symbol: options.symbol,
        json: Boolean(options.json),
      });
    });

  program
    .command("session")
    .description("List or show agent sessions")
    .argument("[path]", "Repository path")
    .option("--id <id>", "Session id to show")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { id?: string; json?: boolean };
      const root = resolveTargetArgument(pathArg);
      try {
        if (options.id) {
          const session = await loadSession(root, options.id);
          if (options.json) process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
          else process.stdout.write(`${session?.id ?? "not-found"}\n`);
        } else {
          const sessions = await listSessions(root);
          if (options.json) process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
          else for (const id of sessions) process.stdout.write(`${id}\n`);
        }
        process.exitCode = EXIT_CODES.SUCCESS;
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = EXIT_CODES.INTERNAL_ERROR;
      }
    });

  program
    .command("report")
    .description("Run platform scan and export local reports")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { json?: boolean };
      const root = resolveTargetArgument(pathArg);
      try {
        const result = await runPlatformScan(root);
        const paths = await exportReports({
          root,
          findings: result.snapshot.findings,
          readiness: result.snapshot.readiness,
          snapshot: result.snapshot,
        });
        if (options.json)
          process.stdout.write(`${JSON.stringify({ ...result.reportPaths, ...paths }, null, 2)}\n`);
        else process.stdout.write(`Reports written under .agentdoctor/platform/\n`);
        process.exitCode = EXIT_CODES.SUCCESS;
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = EXIT_CODES.INTERNAL_ERROR;
      }
    });

  program
    .command("c4")
    .description("C4-style architecture views from graph evidence")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { json?: boolean };
      process.exitCode = await runV2SurfaceCommand({
        action: "c4",
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });

  program
    .command("knowledge")
    .description("List governed knowledge records")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { json?: boolean };
      process.exitCode = await runV2SurfaceCommand({
        action: "knowledge-list",
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });

  program
    .command("knowledge-create")
    .description("Create a draft knowledge record")
    .requiredOption("--title <title>", "Title")
    .requiredOption("--content <text>", "Content")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as {
        title: string;
        content: string;
        json?: boolean;
      };
      process.exitCode = await runV2SurfaceCommand({
        action: "knowledge-create",
        root: resolveTargetArgument(pathArg),
        title: options.title,
        content: options.content,
        json: Boolean(options.json),
      });
    });

  program
    .command("knowledge-approve")
    .description("Transition knowledge record (explicit human approval)")
    .requiredOption("--id <id>", "Record id")
    .requiredOption("--decision <status>", "approved|rejected|pending-review|deprecated|draft")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { id: string; decision: string; json?: boolean };
      process.exitCode = await runV2SurfaceCommand({
        action: "knowledge-transition",
        root: resolveTargetArgument(pathArg),
        id: options.id,
        decision: options.decision,
        json: Boolean(options.json),
      });
    });

  program
    .command("enforce")
    .description("AgentDoctor-controlled runner policy check (does not execute by default)")
    .requiredOption("--command <cmd>", "Command string")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { command: string; json?: boolean };
      process.exitCode = await runV2SurfaceCommand({
        action: "enforce-check",
        root: resolveTargetArgument(pathArg),
        command: options.command,
        json: Boolean(options.json),
      });
    });

  program
    .command("team-register")
    .description("Register local-dev team user (NOT enterprise SSO)")
    .requiredOption("--username <name>", "Username")
    .requiredOption("--password <password>", "Password (min 8)")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as {
        username: string;
        password: string;
        json?: boolean;
      };
      process.exitCode = await runV2SurfaceCommand({
        action: "team-register",
        root: resolveTargetArgument(pathArg),
        username: options.username,
        password: options.password,
        json: Boolean(options.json),
      });
    });

  program
    .command("team-login")
    .description("Authenticate local-dev team user (NOT enterprise SSO)")
    .requiredOption("--username <name>", "Username")
    .requiredOption("--password <password>", "Password")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as {
        username: string;
        password: string;
        json?: boolean;
      };
      process.exitCode = await runV2SurfaceCommand({
        action: "team-login",
        root: resolveTargetArgument(pathArg),
        username: options.username,
        password: options.password,
        json: Boolean(options.json),
      });
    });

  program
    .command("changes")
    .description("Analyze git working-tree / range changes")
    .argument("[path]", "Repository path")
    .option("--since <ref>", "Diff since git ref (e.g. main)")
    .option(
      "--impact",
      "Compute dependency impact from Project Brain (UNKNOWN when edges are missing)",
      false,
    )
    .option("--json", "Emit JSON", false)
    .action(
      async (
        pathArg: string | undefined,
        options: { since?: string; impact?: boolean; json?: boolean },
      ) => {
        process.exitCode = await runChangesCommand({
          root: resolveTargetArgument(pathArg),
          ...(options.since ? { since: options.since } : {}),
          impact: Boolean(options.impact),
          json: Boolean(options.json),
        });
      },
    );
  program
    .command("context-health")
    .description("Detect instruction / ignore surface conflicts")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, options: { json?: boolean }) => {
      process.exitCode = await runContextHealthCommand({
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });

  program
    .command("secrets")
    .description("Opt-in content secret scan (findings are always redacted)")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, options: { json?: boolean }) => {
      process.exitCode = await runSecretsCommand({
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });

  const baseline = program.command("baseline").description("Named scan baselines");
  baseline
    .command("save")
    .description("Save current scan as a named baseline")
    .requiredOption("--name <name>", "Baseline name")
    .argument("[path]", "Repository path")
    .action(async (pathArg: string | undefined, options: { name: string }) => {
      process.exitCode = await runBaselineCommand({
        action: "save",
        name: options.name,
        root: resolveTargetArgument(pathArg),
      });
    });
  baseline
    .command("list")
    .description("List named baselines")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, options: { json?: boolean }) => {
      process.exitCode = await runBaselineCommand({
        action: "list",
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });
  baseline
    .command("diff")
    .description("Compare current scan to a named baseline")
    .requiredOption("--name <name>", "Baseline name")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, options: { name: string; json?: boolean }) => {
      process.exitCode = await runBaselineCommand({
        action: "diff",
        name: options.name,
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });
  baseline
    .command("delete")
    .description("Delete a named baseline (fails if missing)")
    .requiredOption("--name <name>", "Baseline name")
    .argument("[path]", "Repository path")
    .action(async (pathArg: string | undefined, options: { name: string }) => {
      process.exitCode = await runBaselineCommand({
        action: "delete",
        name: options.name,
        root: resolveTargetArgument(pathArg),
      });
    });
  baseline
    .command("trends")
    .description("Show baseline count trends over time (no causality claimed)")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, options: { json?: boolean }) => {
      process.exitCode = await runBaselineCommand({
        action: "trends",
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });

  program
    .command("packages")
    .description("Detect workspace packages / optional per-package scan")
    .argument("[path]", "Repository path")
    .option("--scan", "Run a scan per package", false)
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, options: { scan?: boolean; json?: boolean }) => {
      process.exitCode = await runPackagesCommand({
        root: resolveTargetArgument(pathArg),
        scan: Boolean(options.scan),
        json: Boolean(options.json),
      });
    });

  program
    .command("pr-review")
    .description("Local PR review dry-run (never posts to GitHub)")
    .argument("[path]", "Repository path")
    .option("--base <ref>", "Base git ref")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, options: { base?: string; json?: boolean }) => {
      process.exitCode = await runPrReviewCommand({
        root: resolveTargetArgument(pathArg),
        ...(options.base ? { base: options.base } : {}),
        json: Boolean(options.json),
      });
    });

  program
    .command("dashboard")
    .description("Start local read-only dashboard (loopback only by default)")
    .argument("[path]", "Repository path")
    .option("--host <host>", "Bind host (default 127.0.0.1)", "127.0.0.1")
    .option("--port <port>", "Bind port", "8787")
    .option(
      "--allow-non-loopback",
      "Unsafe: allow binding outside 127.0.0.1/::1/localhost (not an enterprise security boundary)",
      false,
    )
    .action(
      async (
        pathArg: string | undefined,
        options: { host?: string; port?: string; allowNonLoopback?: boolean },
      ) => {
        process.exitCode = await runDashboardCommand({
          root: resolveTargetArgument(pathArg),
          host: options.host ?? "127.0.0.1",
          port: Number(options.port ?? 8787),
          allowNonLoopback: Boolean(options.allowNonLoopback),
        });
      },
    );

  program
    .command("plugins")
    .description("List / validate local plugins under .agentdoctor/plugins")
    .argument("[path]", "Repository path")
    .option("--run", "Execute analyzer plugin hooks (isolated; timeouts apply)", false)
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, options: { json?: boolean; run?: boolean }) => {
      process.exitCode = await runPluginsCommand({
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
        run: Boolean(options.run),
      });
    });

  program
    .command("local-ai")
    .description("Optional local AI provider probe (default: none; core stays deterministic)")
    .option("--provider <id>", "none | mock | ollama", "none")
    .option("--prompt <text>", "Prompt text")
    .option("--json", "Emit JSON", false)
    .action(async (options: { provider?: string; prompt?: string; json?: boolean }) => {
      process.exitCode = await runLocalAiCommand({
        ...(options.provider ? { provider: options.provider } : {}),
        ...(options.prompt ? { prompt: options.prompt } : {}),
        json: Boolean(options.json),
      });
    });

  const platform = program
    .command("platform")
    .description(
      "AgentDoctor 2.0 local platform (intelligence, Action Policy Evaluator, sessions, reports)",
    );
  platform
    .command("scan")
    .description("Run integrated platform scan and write local reports")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { json?: boolean };
      process.exitCode = await runPlatformCommand({
        action: "scan",
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });
  platform
    .command("graph")
    .description("Build repository intelligence graph")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { json?: boolean };
      process.exitCode = await runPlatformCommand({
        action: "graph",
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });
  platform
    .command("test-impact")
    .description("Analyze which tests likely relate to git changes (heuristic; does not run tests)")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { json?: boolean };
      process.exitCode = await runPlatformCommand({
        action: "test-impact",
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });

  const registerPolicyCheck = (name: string, aliasNote: string) => {
    platform
      .command(name)
      .description(
        `Action Policy Evaluator${aliasNote}: evaluate an agent action (never executes; no agent interception)`,
      )
      .argument("[path]", "Repository path")
      .option("--type <type>", "Action type", "shell")
      .option("--command <cmd>", "Shell command string")
      .option("--path <file>", "Target path")
      .option(
        "--fail-closed",
        "If local policy JSON is invalid, deny the action instead of falling back to defaults",
        false,
      )
      .option("--json", "Emit JSON", false)
      .action(async (pathArg: string | undefined, _options, cmd: Command) => {
        const options = cmd.optsWithGlobals() as {
          type?: string;
          command?: string;
          path?: string;
          json?: boolean;
          failClosed?: boolean;
        };
        process.exitCode = await runPlatformCommand({
          action: "policy-check",
          root: resolveTargetArgument(pathArg),
          ...(options.type ? { actionType: options.type } : {}),
          ...(options.command ? { command: options.command } : {}),
          ...(options.path ? { path: options.path } : {}),
          json: Boolean(options.json),
          failClosed: Boolean(options.failClosed),
        });
      });
  };
  registerPolicyCheck("policy-check", "");
  registerPolicyCheck("firewall-check", " (alias)");
  platform
    .command("session-list")
    .description("List recorded agent sessions")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { json?: boolean };
      process.exitCode = await runPlatformCommand({
        action: "session-list",
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });
  platform
    .command("session-show")
    .description("Show / export an agent session")
    .requiredOption("--session <id>", "Session id")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { session: string; json?: boolean };
      process.exitCode = await runPlatformCommand({
        action: "session-show",
        sessionId: options.session,
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });
  platform
    .command("demo-session")
    .description(
      "Record a demo session with Action Policy Evaluator (evaluate-only; no command execution)",
    )
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { json?: boolean };
      process.exitCode = await runPlatformCommand({
        action: "demo-session",
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });
  platform
    .command("provenance")
    .description("Build a provenance record for a file (unknown fields marked)")
    .requiredOption("--path <file>", "File path")
    .argument("[repo]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (repo: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { path: string; json?: boolean };
      process.exitCode = await runPlatformCommand({
        action: "provenance",
        path: options.path,
        root: resolveTargetArgument(repo),
        json: Boolean(options.json),
      });
    });
  platform
    .command("context")
    .description("Plan token-optimized context for a query")
    .option("--query <text>", "Query", "src")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { query?: string; json?: boolean };
      process.exitCode = await runPlatformCommand({
        action: "context",
        query: options.query ?? "src",
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });
  platform
    .command("refactor")
    .description("Analyze rename impact for a symbol (does not apply edits)")
    .requiredOption("--symbol <name>", "Symbol name")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { symbol: string; json?: boolean };
      process.exitCode = await runPlatformCommand({
        action: "refactor",
        symbol: options.symbol,
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });
  platform
    .command("time-machine")
    .description("Compare two git refs")
    .requiredOption("--left <ref>", "Left ref")
    .requiredOption("--right <ref>", "Right ref")
    .argument("[path]", "Repository path")
    .option("--json", "Emit JSON", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as {
        left: string;
        right: string;
        json?: boolean;
      };
      process.exitCode = await runPlatformCommand({
        action: "time-machine",
        left: options.left,
        right: options.right,
        root: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
      });
    });

  program
    .command("verify")
    .description("Re-scan and compare against a prior scan JSON baseline (Scan → Fix → Verify)")
    .argument("[path]", "Repository path (default: current directory)")
    .option("--json", "Emit machine-readable JSON", false)
    .option(
      "--ci",
      "CI mode: exit 1 when new findings appear (also honors other policy flags)",
      false,
    )
    .option("--fail-on-new", "Exit 1 when new findings appear relative to the baseline", false)
    .option("--verbose", "Show timing and extra diagnostics", false)
    .option(
      "--baseline <file>",
      "Prior scan JSON report (default: agentdoctor-report.json or .agentdoctor-baseline.json)",
    )
    .option(
      "--min-score <number>",
      "Exit 1 when overall readiness score is below this (0-100)",
      parseMinScore,
    )
    .option(
      "--fail-on-severity <level>",
      "Exit 1 when any finding has this severity or higher (critical|warning|info)",
      parseSeverityGate,
    )
    .option(
      "--fail-on-rule <id>",
      "Exit 1 when a finding matches this rule id (repeatable or comma-separated)",
      collectFailOnRules,
      [],
    )
    .option(
      "--summary",
      "Write a GitHub Actions step summary when GITHUB_STEP_SUMMARY is set",
      false,
    )
    .option("--annotations", "Emit GitHub Actions annotations for findings (stderr)", false)
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as {
        json?: boolean;
        ci?: boolean;
        failOnNew?: boolean;
        verbose?: boolean;
        baseline?: string;
        minScore?: unknown;
        failOnSeverity?: unknown;
        failOnRule?: unknown;
        summary?: boolean;
        annotations?: boolean;
      };
      const minScore = readMinScore(options);
      const failOnSeverity = readFailOnSeverity(options);
      const failOnRules = readFailOnRules(options);
      const code = await runVerifyCommand({
        targetPath: resolveTargetArgument(pathArg),
        json: Boolean(options.json),
        ci: Boolean(options.ci),
        failOnNew: Boolean(options.failOnNew),
        verbose: Boolean(options.verbose),
        summary: Boolean(options.summary),
        annotations: Boolean(options.annotations),
        ...(typeof options.baseline === "string" ? { baselinePath: options.baseline } : {}),
        ...(minScore !== undefined ? { minScore } : {}),
        ...(failOnSeverity !== undefined ? { failOnSeverity } : {}),
        ...(failOnRules.length > 0 ? { failOnRules } : {}),
      });
      process.exitCode = code;
    });

  program
    .command("explain")
    .description("Explain a rule by id")
    .argument("<rule>", "Rule id, e.g. security/env-file-exposure")
    .action(async (rule: string) => {
      const code = await runExplainCommand(rule);
      process.exitCode = code;
    });

  program
    .command("doctor")
    .description("Check AgentDoctor installation health")
    .option("--json", "Emit JSON ops health", false)
    .argument("[path]", "Repository path")
    .action(async (pathArg: string | undefined, _options, command: Command) => {
      const options = command.optsWithGlobals() as { json?: boolean };
      if (options.json) {
        const health = await collectOpsHealth(resolveTargetArgument(pathArg));
        process.stdout.write(`${JSON.stringify(health, null, 2)}\n`);
        process.exitCode = health.ok ? EXIT_CODES.SUCCESS : EXIT_CODES.INTERNAL_ERROR;
        return;
      }
      const code = await runDoctorCommand();
      process.exitCode = code;
    });

  program
    .command("brain-mcp")
    .description(
      "Start the local Project Brain MCP server over STDIO (evidence-backed agent context; no API key)",
    )
    .requiredOption(
      "--root <path>",
      "Absolute or relative project root (required; never uses process.cwd() implicitly)",
    )
    .option(
      "--no-build-if-missing",
      "Fail when no snapshot exists instead of compiling Project Brain",
    )
    .action(async (options: { root: string; buildIfMissing?: boolean }) => {
      const code = await runBrainMcpCommand({
        root: options.root,
        buildIfMissing: options.buildIfMissing !== false,
      });
      process.exitCode = code;
    });

  program
    .command("mcp")
    .description("Start combined AgentDoctor MCP (Brain tools + intelligence tools) over STDIO")
    .requiredOption(
      "--root <path>",
      "Absolute or relative project root (required; never uses process.cwd() implicitly)",
    )
    .option("--no-build-if-missing", "Fail when no Brain snapshot exists instead of compiling")
    .action(async (options: { root: string; buildIfMissing?: boolean }) => {
      const code = await runMcpCommand({
        root: options.root,
        buildIfMissing: options.buildIfMissing !== false,
      });
      process.exitCode = code;
    });

  program.configureOutput({
    outputError: (str, write) => write(str),
  });

  program.exitOverride();

  return program;
}

export async function runCli(argv = process.argv): Promise<void> {
  const program = createProgram();
  try {
    await program.parseAsync(argv);
  } catch (error) {
    // Commander throws on --help / --version with exitOverride
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "commander.helpDisplayed" || error.code === "commander.version")
    ) {
      process.exitCode = EXIT_CODES.SUCCESS;
      return;
    }
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string" &&
      error.code.startsWith("commander.")
    ) {
      process.exitCode = EXIT_CODES.USAGE_ERROR;
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = EXIT_CODES.INTERNAL_ERROR;
  }
}
