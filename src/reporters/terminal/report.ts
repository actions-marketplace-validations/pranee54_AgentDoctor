import { PACKAGE_VERSION } from "../../constants.js";
import { AGENT_DISPLAY_NAMES } from "../../constants.js";
import { formatFramework, formatFrameworks } from "../../detectors/framework.js";
import { formatLanguage, formatLanguages } from "../../detectors/language.js";
import { formatMonorepo } from "../../detectors/monorepo.js";
import { formatPackageManager, formatPackageManagers } from "../../detectors/package-manager.js";
import type { AgentId, Finding, ScanResult, Severity } from "../../types/index.js";
import { colors, symbolFail, symbolInfo, symbolOk, symbolWarn } from "../../utils/colors.js";
import { sanitizeTerminalText } from "../../security/redaction.js";

export interface TerminalReportOptions {
  verbose?: boolean;
}

const DEFAULT_FINDING_LIMIT = 12;

const LIMITED_ANALYSIS_NOTE =
  "Agent-specific exposure checks are limited (no supported agent config); repository hygiene still applied.";

/** Agents with an implemented Safe Fix writer (detect-only agents are excluded). */
const SAFE_FIX_AGENT_IDS = new Set<AgentId>([
  "cursor",
  "claude-code",
  "codex",
  "gemini-cli",
  "aider",
]);

function renderAgentCoverageSummary(result: ScanResult): string[] {
  const configured = result.agents.filter((a) => a.configured);
  const detectedOnly = result.agents.filter((a) => a.detected && !a.configured);
  const withFix = configured.filter((a) => SAFE_FIX_AGENT_IDS.has(a.id));
  const detectOnlyConfigured = configured.filter((a) => !SAFE_FIX_AGENT_IDS.has(a.id));

  const lines: string[] = [];
  lines.push("");
  if (result.agentSecurityAnalysis === "limited") {
    lines.push(
      colors.dim(
        "  Coverage: 0 configured · universal hygiene still runs (limited agent analysis)",
      ),
    );
    return lines;
  }

  const parts: string[] = [`${configured.length} configured`];
  if (detectedOnly.length > 0) {
    parts.push(`${detectedOnly.length} detected-only`);
  }
  if (withFix.length > 0) {
    parts.push(`Safe Fix: ${withFix.map((a) => a.displayName).join(", ")}`);
  }
  if (detectOnlyConfigured.length > 0) {
    parts.push(
      `detect-only (no Safe Fix writer): ${detectOnlyConfigured.map((a) => a.displayName).join(", ")}`,
    );
  }
  lines.push(colors.dim(`  Coverage: ${parts.join(" · ")}`));
  return lines;
}

function groupFindings(findings: Finding[]): Record<Severity, Finding[]> {
  return {
    critical: findings.filter((f) => f.severity === "critical"),
    warning: findings.filter((f) => f.severity === "warning"),
    info: findings.filter((f) => f.severity === "info"),
  };
}

function agentGlyph(configured: boolean, detected: boolean): string {
  if (configured) {
    return symbolOk();
  }
  if (detected) {
    return symbolWarn();
  }
  return colors.dim("–");
}

function formatAgents(agents: AgentId[]): string {
  return agents.map((id) => AGENT_DISPLAY_NAMES[id] ?? id).join(", ");
}

function isMultiStack(result: ScanResult): boolean {
  if (result.repository.monorepo === "multi-project") {
    return true;
  }
  const frameworks = result.repository.frameworks.filter((id) => id !== "unknown");
  const managers = result.repository.packageManagers.filter((id) => id !== "unknown");
  return frameworks.length > 1 || managers.length > 1;
}

function renderFindingBlock(finding: Finding, verbose: boolean): string[] {
  const lines: string[] = [];
  const icon =
    finding.severity === "critical"
      ? symbolFail()
      : finding.severity === "warning"
        ? symbolWarn()
        : symbolInfo();

  const fixTag =
    finding.fixability === "safe"
      ? colors.green("[safe]")
      : finding.fixability === "review"
        ? colors.yellow("[review]")
        : colors.dim("[manual]");

  lines.push(`  ${icon} ${fixTag} ${sanitizeTerminalText(finding.title)}`);
  if (finding.evidence?.path) {
    lines.push(colors.dim(`    ${sanitizeTerminalText(finding.evidence.path)}`));
  }
  if (finding.affectedAgents.length > 0) {
    lines.push(colors.dim(`    Affected: ${formatAgents(finding.affectedAgents)}`));
  }
  lines.push(`    ${sanitizeTerminalText(finding.message)}`);
  if (verbose) {
    lines.push(colors.dim(`    Why: ${sanitizeTerminalText(finding.whyItMatters)}`));
  }
  if (finding.recommendation) {
    lines.push(`    Fix: ${sanitizeTerminalText(finding.recommendation)}`);
  }
  lines.push("");
  return lines;
}

function countByFixability(findings: Finding[]): { safe: number; review: number; manual: number } {
  let safe = 0;
  let review = 0;
  let manual = 0;
  for (const finding of findings) {
    if (finding.fixability === "safe") {
      safe += 1;
    } else if (finding.fixability === "review") {
      review += 1;
    } else {
      manual += 1;
    }
  }
  return { safe, review, manual };
}

/**
 * Close the Scan → Fix → Verify loop on first run.
 * Empty / agentless scans already print a Next line; findings used to dead-end.
 */
export function renderNextSteps(result: ScanResult): string[] {
  const lines: string[] = [];
  const total = result.summary.total;
  if (total === 0) {
    return lines;
  }

  const { safe, review, manual } = countByFixability(result.findings);
  const reviewLike = review + manual;

  lines.push(colors.bold("Next"));
  lines.push("");
  if (safe > 0) {
    lines.push(
      `  ${safe} finding(s) are auto-fixable. Preview: ${colors.bold("agentdoctor fix --dry-run")}`,
    );
    lines.push(`  Apply: ${colors.bold("agentdoctor fix -y")}`);
  } else if (reviewLike > 0) {
    lines.push(
      `  ${reviewLike} finding(s) need review or manual action — ${colors.bold("agentdoctor fix")} will not change them automatically.`,
    );
    lines.push(
      colors.dim("  Inspect a rule: agentdoctor explain <rule-id>  (ids are in --json output)"),
    );
  }
  lines.push(
    colors.dim("  Save a verify baseline: agentdoctor scan --json > agentdoctor-report.json"),
  );
  lines.push(colors.dim("  After changes: agentdoctor verify --baseline agentdoctor-report.json"));
  lines.push("");
  return lines;
}

/**
 * Terminal report: agents and actionable findings.
 */
export function renderTerminalReport(
  result: ScanResult,
  options: TerminalReportOptions = {},
): string {
  const lines: string[] = [];
  const verbose = options.verbose ?? false;

  lines.push("");
  lines.push(colors.bold(`🩺 AgentDoctor`) + colors.dim(` v${PACKAGE_VERSION}`));
  lines.push("");
  lines.push(colors.dim("Scanning repository..."));
  lines.push("");

  lines.push(colors.bold("Repository"));
  if (isMultiStack(result)) {
    lines.push(
      `  Languages: ${sanitizeTerminalText(formatLanguages(result.repository.languages))}`,
    );
    lines.push(
      `  Frameworks: ${sanitizeTerminalText(formatFrameworks(result.repository.frameworks))}`,
    );
    lines.push(
      `  Package managers: ${sanitizeTerminalText(formatPackageManagers(result.repository.packageManagers))}`,
    );
  } else {
    lines.push(
      `  Framework: ${sanitizeTerminalText(formatFramework(result.repository.primaryFramework))}`,
    );
    lines.push(
      `  Language: ${sanitizeTerminalText(formatLanguage(result.repository.primaryLanguage))}`,
    );
    const packageManagerLabel =
      result.repository.packageManagers.length > 1 ||
      result.repository.primaryPackageManager === "unknown"
        ? formatPackageManagers(result.repository.packageManagers)
        : formatPackageManager(result.repository.primaryPackageManager);
    lines.push(`  Package manager: ${sanitizeTerminalText(packageManagerLabel)}`);
  }
  if (result.repository.monorepo !== "none") {
    lines.push(`  Monorepo: ${sanitizeTerminalText(formatMonorepo(result.repository.monorepo))}`);
  }
  lines.push(`  Files scanned: ${result.repository.filesScanned}`);
  lines.push("");

  lines.push(colors.bold("AI Coding Agents"));
  lines.push("");
  for (const agent of result.agents) {
    const glyph = agentGlyph(agent.configured, agent.detected);
    const status = agent.configured ? "configured" : agent.detected ? "detected" : "not configured";
    lines.push(
      `${glyph} ${pad(sanitizeTerminalText(agent.displayName), 12)} ${colors.dim(status)}`,
    );
    if (verbose && agent.configured) {
      lines.push(colors.dim(`    ${sanitizeTerminalText(agent.summary)}`));
      for (const configPath of agent.configPaths) {
        lines.push(colors.dim(`    · ${sanitizeTerminalText(configPath)}`));
      }
    }
  }
  lines.push(...renderAgentCoverageSummary(result));
  lines.push("");

  const grouped = groupFindings(result.findings);
  const total = result.summary.total;
  const limited = result.agentSecurityAnalysis === "limited";

  lines.push(colors.bold("Findings"));
  lines.push("");

  if (limited) {
    lines.push(`  ${symbolWarn()} ${sanitizeTerminalText(LIMITED_ANALYSIS_NOTE)}`);
    lines.push("");
  }

  if (total === 0) {
    if (limited) {
      lines.push(
        `  ${symbolOk()} No repository-hygiene findings — agent readiness not scored (no supported agent config)`,
      );
      lines.push("");
      lines.push(
        colors.dim(
          "  Optional next: add project agent config (`.cursor/`, `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `.windsurf/rules/`, `GEMINI.md`, or `.aider.conf.yml`)",
        ),
      );
      lines.push(
        colors.dim(
          "  so agent exposure checks run fully. CLI, Action, and Project Brain MCP still work without an agent.",
        ),
      );
    } else {
      lines.push(`  ${symbolOk()} No findings`);
    }
    lines.push("");
  } else {
    let shown = 0;
    const limit = verbose ? Number.POSITIVE_INFINITY : DEFAULT_FINDING_LIMIT;

    for (const severity of ["critical", "warning", "info"] as const) {
      const list = grouped[severity];
      if (list.length === 0) {
        continue;
      }
      const header =
        severity === "critical"
          ? colors.red(colors.bold("CRITICAL"))
          : severity === "warning"
            ? colors.yellow(colors.bold("WARNING"))
            : colors.cyan(colors.bold("INFO"));
      lines.push(header);
      lines.push("");
      for (const finding of list) {
        if (shown >= limit) {
          break;
        }
        lines.push(...renderFindingBlock(finding, verbose));
        shown += 1;
      }
      if (shown >= limit) {
        break;
      }
    }

    if (total > shown) {
      lines.push(
        colors.dim(
          `  … and ${total - shown} more. Re-run with --verbose for detail, or --json for the full list.`,
        ),
      );
      lines.push("");
    }
  }

  lines.push(colors.bold("Summary"));
  lines.push("");
  lines.push(`  ${result.summary.critical} critical`);
  lines.push(`  ${result.summary.warning} warning`);
  lines.push(`  ${result.summary.info} info`);
  if (total > 0) {
    const { safe, review, manual } = countByFixability(result.findings);
    lines.push(colors.dim(`  Fixability: ${safe} safe · ${review} review · ${manual} manual`));
  }
  lines.push("");
  if (result.scoringAvailable && result.scores) {
    if (limited) {
      lines.push(
        `  Readiness: n/a — configure a supported agent (Cursor, Claude Code, Codex, Copilot, Windsurf, Gemini CLI, or Aider) before treating scores as agent readiness`,
      );
      lines.push(
        colors.dim(
          `  Numeric scores remain in JSON (overall ${result.scores.overall}/100) for repository-risk findings only`,
        ),
      );
    } else {
      lines.push(`  Readiness: ${result.scores.overall}/100`);
      lines.push(colors.dim("  Category and agent scores: agentdoctor scan --json"));
    }
  } else {
    lines.push(colors.dim("  Readiness scoring unavailable for this scan"));
  }
  lines.push("");

  lines.push(...renderNextSteps(result));

  if (verbose) {
    lines.push(colors.dim("Timing"));
    lines.push(`  Discovery: ${result.timing.discoveryMs}ms`);
    lines.push(`  Detection: ${result.timing.detectionMs}ms`);
    lines.push(`  Agents:    ${result.timing.agentsMs}ms`);
    lines.push(`  Rules:     ${result.timing.rulesMs}ms`);
    lines.push(`  Total:     ${result.timing.totalMs}ms`);
    lines.push("");
  }

  return lines.join("\n");
}

function pad(value: string, width: number): string {
  return value.padEnd(width, " ");
}
