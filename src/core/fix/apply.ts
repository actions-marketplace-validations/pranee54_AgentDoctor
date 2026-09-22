import type { FixApplyResult, FixPlan } from "./types.js";
import { assertTargetsUnchangedSinceBackup, createFixBackup } from "./backup.js";
import { preflightSafeFixTargets } from "./safe-target.js";
import {
  previewClaudeSettingsActions,
  readClaudeSettings,
  writeClaudeSettings,
} from "./writers/claude-settings.js";
import {
  previewCodexConfigActions,
  readCodexConfig,
  writeCodexConfig,
} from "./writers/codex-config.js";
import {
  previewCursorignoreActions,
  readCursorignore,
  writeCursorignore,
} from "./writers/cursorignore.js";
import {
  previewSimpleIgnoreActions,
  readSimpleIgnore,
  writeSimpleIgnore,
} from "./writers/simple-ignore.js";

type WriterStep = {
  targetRelativePath: string;
  write: () => Promise<void>;
};

/** Supported options for Safe Fix apply / dry-run. */
export interface ApplyFixPlanOptions {
  dryRun: boolean;
}

/**
 * Internal test-only options. Not a CLI feature and not part of the supported
 * public consumer API — use only from unit tests.
 */
export interface ApplyFixPlanInternalOptions extends ApplyFixPlanOptions {
  /** Inject a failure after earlier writers succeed (partial-apply tests). */
  simulateWriteFailureAt?: string;
}

/**
 * Apply (or dry-run) a fix plan.
 * Safe writers: `.cursorignore`, Claude settings deny, Codex config.toml deny,
 * `.geminiignore`, `.aiderignore`.
 *
 * All planned targets are preflighted before any write. Writes still run
 * sequentially; if a later write fails, earlier files may already be updated
 * (`partial: true` on the result).
 */
export async function applyFixPlan(
  plan: FixPlan,
  options: ApplyFixPlanOptions | ApplyFixPlanInternalOptions,
): Promise<FixApplyResult> {
  const simulateWriteFailureAt =
    "simulateWriteFailureAt" in options ? options.simulateWriteFailureAt : undefined;
  const cursorContent = await readCursorignore(plan.root);
  const claudeContent = await readClaudeSettings(plan.root);
  const codexContent = await readCodexConfig(plan.root);
  const geminiContent = await readSimpleIgnore(plan.root, ".geminiignore");
  const aiderContent = await readSimpleIgnore(plan.root, ".aiderignore");

  const cursorPreview = previewCursorignoreActions(cursorContent, plan.actions);
  const claudePreview = previewClaudeSettingsActions(claudeContent, plan.actions);
  const codexPreview = previewCodexConfigActions(codexContent, plan.actions);
  const geminiPreview = previewSimpleIgnoreActions(geminiContent, plan.actions, {
    agent: "gemini-cli",
    targetRelativePath: ".geminiignore",
  });
  const aiderPreview = previewSimpleIgnoreActions(aiderContent, plan.actions, {
    agent: "aider",
    targetRelativePath: ".aiderignore",
  });

  const steps: WriterStep[] = [];
  if (cursorPreview) {
    steps.push({
      targetRelativePath: cursorPreview.targetRelativePath,
      write: async () => writeCursorignore(plan.root, cursorPreview.after),
    });
  }
  if (claudePreview) {
    steps.push({
      targetRelativePath: claudePreview.targetRelativePath,
      write: async () => writeClaudeSettings(plan.root, claudePreview.after),
    });
  }
  if (codexPreview) {
    steps.push({
      targetRelativePath: codexPreview.targetRelativePath,
      write: async () => writeCodexConfig(plan.root, codexPreview.after),
    });
  }
  if (geminiPreview) {
    steps.push({
      targetRelativePath: geminiPreview.targetRelativePath,
      write: async () => writeSimpleIgnore(plan.root, ".geminiignore", geminiPreview.after),
    });
  }
  if (aiderPreview) {
    steps.push({
      targetRelativePath: aiderPreview.targetRelativePath,
      write: async () => writeSimpleIgnore(plan.root, ".aiderignore", aiderPreview.after),
    });
  }

  const changedFiles = steps.map((s) => s.targetRelativePath);

  try {
    await preflightSafeFixTargets(
      plan.root,
      steps.map((s) => s.targetRelativePath),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      plan,
      dryRun: options.dryRun,
      writtenFiles: [],
      changedFiles,
      partial: false,
      ...(steps[0]?.targetRelativePath ? { failedTarget: steps[0].targetRelativePath } : {}),
      error: message,
    };
  }

  if (options.dryRun) {
    return {
      plan,
      dryRun: true,
      writtenFiles: [],
      changedFiles,
    };
  }

  let auditId: string | undefined;
  let backupRecord: Awaited<ReturnType<typeof createFixBackup>> | undefined;
  try {
    backupRecord = await createFixBackup({
      root: plan.root,
      relativePaths: steps.map((s) => s.targetRelativePath),
      note: "safe-fix-apply",
    });
    auditId = backupRecord.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      plan,
      dryRun: false,
      writtenFiles: [],
      changedFiles,
      partial: false,
      error: `backup failed before apply: ${message}`,
    };
  }

  const writtenFiles: string[] = [];
  for (const step of steps) {
    try {
      if (backupRecord) {
        await assertTargetsUnchangedSinceBackup(plan.root, backupRecord, [step.targetRelativePath]);
      }
      if (simulateWriteFailureAt && simulateWriteFailureAt === step.targetRelativePath) {
        throw new Error("simulated later writer failure");
      }
      await step.write();
      writtenFiles.push(step.targetRelativePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        plan,
        dryRun: false,
        writtenFiles,
        changedFiles,
        partial: writtenFiles.length > 0,
        failedTarget: step.targetRelativePath,
        error: message,
        ...(auditId ? { auditId } : {}),
      };
    }
  }

  return {
    plan,
    dryRun: false,
    writtenFiles,
    changedFiles,
    ...(auditId ? { auditId } : {}),
  };
}

export { previewCursorignoreActions, readCursorignore };
export { previewClaudeSettingsActions, readClaudeSettings };
export { previewCodexConfigActions, readCodexConfig };
export { previewSimpleIgnoreActions, readSimpleIgnore };
