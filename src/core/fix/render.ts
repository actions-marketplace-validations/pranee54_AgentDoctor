import type { FixApplyResult, FixPlan } from "./types.js";
import { previewClaudeSettingsActions } from "./writers/claude-settings.js";
import { previewCodexConfigActions } from "./writers/codex-config.js";
import { previewCursorignoreActions } from "./writers/cursorignore.js";
import { previewSimpleIgnoreActions } from "./writers/simple-ignore.js";

export function renderFixPlanTerminal(
  plan: FixPlan,
  options: {
    dryRun: boolean;
    cursorContent: string | null;
    claudeSettingsContent?: string | null;
    codexConfigContent?: string | null;
    geminiignoreContent?: string | null;
    aiderignoreContent?: string | null;
    applyResult?: FixApplyResult;
  },
): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(options.dryRun ? "AgentDoctor fix (dry-run)" : "AgentDoctor fix");
  lines.push("");

  if (plan.actions.length === 0) {
    lines.push("  No automatic fixes available for this scan.");
    if (plan.skipped.length > 0) {
      lines.push("");
      lines.push(`  ${plan.skipped.length} finding(s) need manual or review action:`);
      const reasons = summarizeSkipReasons(plan.skipped.map((s) => s.reason));
      for (const [reason, count] of reasons) {
        lines.push(`    - ${reason} (${count})`);
      }
      lines.push("");
      lines.push("Next");
      lines.push("  Inspect a finding: agentdoctor explain <rule-id>  (ids in scan --json)");
      lines.push("  Confirm with verify: agentdoctor verify --baseline agentdoctor-report.json");
      lines.push("  No baseline yet? agentdoctor scan --json > agentdoctor-report.json");
    } else {
      lines.push("  Scan found nothing that Fix can change.");
      lines.push("");
      lines.push("Next");
      lines.push("  Re-scan: agentdoctor scan");
    }
    lines.push("");
    return lines.join("\n");
  }

  lines.push(`  Proposed actions: ${plan.actions.length}`);
  for (const action of plan.actions) {
    lines.push(`    • [${action.agent}] ${action.description}`);
    lines.push(`      pattern: ${action.pattern}`);
    lines.push(`      findings: ${action.findingIds.length}`);
  }

  const cursorPreview = previewCursorignoreActions(options.cursorContent, plan.actions);
  const claudePreview = previewClaudeSettingsActions(
    options.claudeSettingsContent ?? null,
    plan.actions,
  );
  const codexPreview = previewCodexConfigActions(options.codexConfigContent ?? null, plan.actions);
  const geminiPreview = previewSimpleIgnoreActions(
    options.geminiignoreContent ?? null,
    plan.actions,
    { agent: "gemini-cli", targetRelativePath: ".geminiignore" },
  );
  const aiderPreview = previewSimpleIgnoreActions(
    options.aiderignoreContent ?? null,
    plan.actions,
    { agent: "aider", targetRelativePath: ".aiderignore" },
  );

  type AnyPreview = {
    targetRelativePath: string;
    preview: string;
    patternsToAdd?: string[];
    denyRulesToAdd?: string[];
    denyKeysToAdd?: string[];
  };

  const previews: AnyPreview[] = [
    cursorPreview,
    claudePreview,
    codexPreview,
    geminiPreview,
    aiderPreview,
  ].filter((p): p is NonNullable<typeof p> => p !== null);

  if (previews.length > 0) {
    lines.push("");
    lines.push("  File changes:");
    let shown = false;
    for (const preview of previews) {
      if (shown) {
        lines.push("");
      }
      const count =
        preview.patternsToAdd?.length ??
        preview.denyRulesToAdd?.length ??
        preview.denyKeysToAdd?.length ??
        0;
      const unit = preview.patternsToAdd
        ? "pattern(s)"
        : preview.denyRulesToAdd
          ? "deny rule(s)"
          : "deny key(s)";
      lines.push(`    ${preview.targetRelativePath} (+${count} ${unit})`);
      lines.push("");
      for (const previewLine of preview.preview.split("\n")) {
        lines.push(`  ${previewLine}`);
      }
      shown = true;
    }
  }

  if (options.applyResult?.error) {
    lines.push("");
    if (options.applyResult.partial) {
      lines.push(
        `  Partial apply: wrote ${options.applyResult.writtenFiles.join(", ") || "(none)"} then failed on ${options.applyResult.failedTarget ?? "unknown target"}`,
      );
      lines.push(`  Error: ${options.applyResult.error}`);
      lines.push(
        "  Safe Fix is not transactional across multiple files — review written paths manually.",
      );
    } else {
      lines.push(`  Fix aborted before/during write: ${options.applyResult.error}`);
      if (options.applyResult.failedTarget) {
        lines.push(`  Target: ${options.applyResult.failedTarget}`);
      }
    }
  } else if (options.applyResult && !options.dryRun) {
    lines.push("");
    if (options.applyResult.writtenFiles.length > 0) {
      lines.push(`  Wrote: ${options.applyResult.writtenFiles.join(", ")}`);
    } else {
      lines.push("  No files written.");
    }
  } else if (options.dryRun) {
    lines.push("");
    lines.push("  No files were modified (dry-run).");
  }

  if (plan.skipped.length > 0) {
    lines.push("");
    lines.push(`  Skipped: ${plan.skipped.length} finding(s):`);
    const reasons = summarizeSkipReasons(plan.skipped.map((s) => s.reason));
    for (const [reason, count] of reasons) {
      lines.push(`    - ${reason} (${count})`);
    }
  }

  lines.push("");
  lines.push("Next");
  if (options.dryRun && plan.actions.length > 0) {
    lines.push("  Apply these changes: agentdoctor fix -y");
  }
  if (plan.skipped.length > 0) {
    lines.push("  Review/manual findings stay open — inspect with: agentdoctor explain <rule-id>");
  }
  lines.push("  Confirm with verify: agentdoctor verify --baseline agentdoctor-report.json");
  lines.push("  No baseline yet? agentdoctor scan --json > agentdoctor-report.json");
  lines.push("");
  return lines.join("\n");
}

function summarizeSkipReasons(reasons: string[]): Array<[string, number]> {
  const map = new Map<string, number>();
  for (const reason of reasons) {
    map.set(reason, (map.get(reason) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}
