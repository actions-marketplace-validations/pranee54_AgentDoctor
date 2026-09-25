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
 * GitHub Copilot project configuration detection.
 *
 * Official sources (docs.github.com Copilot custom instructions):
 * - Repository-wide: `.github/copilot-instructions.md`
 * - Path-specific: files under `.github/instructions/` ending in `.instructions.md`
 *
 * We do NOT inspect `~/.copilot` or user-global preference files — repository only.
 * No official project-local deny/ignore file exists; Safe Fix does not invent one.
 */
export async function detectCopilot(context: AgentDetectionContext): Promise<AgentDetectionResult> {
  const { root, discovery, maxFileSizeBytes } = context;
  const configFiles: AgentConfigFile[] = [];
  const diagnostics: AgentDiagnostic[] = [];
  const seen = new Set<string>();
  const metadata: Record<string, unknown> = {
    repoInstructionsCount: 0,
    pathInstructionsCount: 0,
  };

  async function addInstructionFile(
    relativePath: string,
    kind: "copilot-instructions" | "copilot-path-instructions",
  ): Promise<void> {
    if (seen.has(relativePath)) {
      return;
    }
    seen.add(relativePath);
    const inspected = await inspectRepoFile(root, relativePath, maxFileSizeBytes);
    configFiles.push(
      toAgentConfigFile(inspected, kind, {
        legacy: false,
        scope: relativePath === ".github/copilot-instructions.md" ? "root" : "nested",
      }),
    );

    if (kind === "copilot-instructions") {
      metadata.repoInstructionsCount = Number(metadata.repoInstructionsCount) + 1;
    } else {
      metadata.pathInstructionsCount = Number(metadata.pathInstructionsCount) + 1;
    }

    if (!inspected.exists) {
      return;
    }
    if (!inspected.readable && inspected.error) {
      diagnostics.push({
        code: "copilot/unreadable-file",
        severity: "warning",
        message: `Could not read Copilot instruction file: ${inspected.error}`,
        file: relativePath,
      });
    } else if (inspected.empty) {
      diagnostics.push({
        code: "copilot/empty-instruction",
        severity: "info",
        message: "Copilot instruction file is empty",
        file: relativePath,
      });
    }
  }

  if (await pathExistsInsideRoot(root, ".github/copilot-instructions.md")) {
    await addInstructionFile(".github/copilot-instructions.md", "copilot-instructions");
  }

  for (const file of discovery.files) {
    const relative = file.relativePath;
    if (!relative.startsWith(".github/instructions/")) {
      continue;
    }
    const base = basenameOf(relative);
    if (!base.endsWith(".instructions.md")) {
      continue;
    }
    await addInstructionFile(relative, "copilot-path-instructions");
  }

  const usableInstruction = configFiles.some((f) => f.readable && !f.empty);
  const detected =
    Number(metadata.repoInstructionsCount) > 0 || Number(metadata.pathInstructionsCount) > 0;
  const configured = usableInstruction;
  const hasErrors = diagnostics.some((d) => d.severity === "error");
  const status = deriveStatus({ detected, configured, hasErrors });

  const parts: string[] = [];
  if (Number(metadata.repoInstructionsCount) > 0) {
    parts.push("copilot-instructions.md");
  }
  if (Number(metadata.pathInstructionsCount) > 0) {
    const count = Number(metadata.pathInstructionsCount);
    parts.push(`${count} path instruction${count === 1 ? "" : "s"}`);
  }

  let summary: string;
  if (!detected) {
    summary = "not configured";
  } else if (configured) {
    summary = parts.length > 0 ? parts.join(", ") : "configured";
  } else {
    summary = "detected but not configured";
  }

  return {
    id: "copilot",
    displayName: AGENT_DISPLAY_NAMES.copilot,
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

export const copilotAdapter: AgentAdapter = {
  id: "copilot",
  displayName: AGENT_DISPLAY_NAMES.copilot,
  detect: detectCopilot,
};
