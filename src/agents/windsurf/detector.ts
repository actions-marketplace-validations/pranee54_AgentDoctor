import { AGENT_DISPLAY_NAMES } from "../../constants.js";
import {
  deriveStatus,
  inspectRepoFile,
  pathExistsInsideRoot,
  toAgentConfigFile,
} from "../inspect.js";
import type {
  AgentAdapter,
  AgentConfigFile,
  AgentDetectionContext,
  AgentDetectionResult,
  AgentDiagnostic,
} from "../types.js";
import { basenameOf } from "../types.js";

/**
 * Windsurf / Cascade project rules detection.
 *
 * Official sources (docs.devin.ai Cascade memories & rules):
 * - Preferred: `.devin/rules/*.md`
 * - Fallback: `.windsurf/rules/*.md`
 * - Legacy: `.windsurfrules` at workspace root
 *
 * We do NOT inspect `~/.codeium/windsurf` or OS system rules — repository only.
 * No official project-local deny/ignore Fix writer; Safe Fix does not invent one.
 */
export async function detectWindsurf(
  context: AgentDetectionContext,
): Promise<AgentDetectionResult> {
  const { root, discovery, maxFileSizeBytes } = context;
  const configFiles: AgentConfigFile[] = [];
  const diagnostics: AgentDiagnostic[] = [];
  const seen = new Set<string>();
  const metadata: Record<string, unknown> = {
    ruleCount: 0,
    hasLegacyRules: false,
    hasWindsurfDir: false,
    hasDevinDir: false,
  };

  async function addRule(
    relativePath: string,
    kind: "windsurf-rule-md" | "windsurf-legacy-rules",
    legacy: boolean,
  ): Promise<void> {
    if (seen.has(relativePath)) {
      return;
    }
    seen.add(relativePath);
    const inspected = await inspectRepoFile(root, relativePath, maxFileSizeBytes);
    configFiles.push(
      toAgentConfigFile(inspected, kind, {
        legacy,
        scope: relativePath === ".windsurfrules" ? "legacy" : "nested",
      }),
    );
    metadata.ruleCount = Number(metadata.ruleCount) + 1;
    if (legacy) {
      metadata.hasLegacyRules = true;
    }

    if (!inspected.exists) {
      return;
    }
    if (!inspected.readable && inspected.error) {
      diagnostics.push({
        code: "windsurf/unreadable-file",
        severity: "warning",
        message: `Could not read Windsurf rule file: ${inspected.error}`,
        file: relativePath,
      });
    } else if (inspected.empty) {
      diagnostics.push({
        code: "windsurf/empty-rule",
        severity: "info",
        message: "Windsurf rule file is empty",
        file: relativePath,
      });
    }
  }

  metadata.hasWindsurfDir = await pathExistsInsideRoot(root, ".windsurf");
  metadata.hasDevinDir = await pathExistsInsideRoot(root, ".devin");

  if (await pathExistsInsideRoot(root, ".windsurfrules")) {
    await addRule(".windsurfrules", "windsurf-legacy-rules", true);
    diagnostics.push({
      code: "windsurf/legacy-rules",
      severity: "info",
      message: "Legacy .windsurfrules detected; prefer .devin/rules/ or .windsurf/rules/",
      file: ".windsurfrules",
    });
  }

  for (const file of discovery.files) {
    const relative = file.relativePath;
    const base = basenameOf(relative);
    if (!base.endsWith(".md")) {
      continue;
    }
    if (relative.includes(".windsurf/rules/") || relative.includes(".devin/rules/")) {
      await addRule(relative, "windsurf-rule-md", false);
    }
  }

  const usable = configFiles.some((f) => f.readable && !f.empty);
  const detected =
    Boolean(metadata.hasWindsurfDir) ||
    Boolean(metadata.hasDevinDir) ||
    Number(metadata.ruleCount) > 0;
  const configured = usable;
  const status = deriveStatus({
    detected,
    configured,
    hasErrors: diagnostics.some((d) => d.severity === "error"),
  });

  let summary: string;
  if (!detected) {
    summary = "not configured";
  } else if (configured) {
    const count = Number(metadata.ruleCount);
    summary = `${count} rule${count === 1 ? "" : "s"}`;
  } else {
    summary = "detected but not configured";
  }

  return {
    id: "windsurf",
    displayName: AGENT_DISPLAY_NAMES.windsurf,
    detected,
    configured,
    status,
    summary,
    configFiles,
    configPaths: configFiles.map((f) => f.relativePath),
    diagnostics,
    metadata,
  };
}

export const windsurfAdapter: AgentAdapter = {
  id: "windsurf",
  displayName: AGENT_DISPLAY_NAMES.windsurf,
  detect: detectWindsurf,
};
