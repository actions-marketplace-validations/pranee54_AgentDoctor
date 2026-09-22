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

/**
 * Aider project configuration detection.
 *
 * Official sources (aider.chat docs):
 * - Config: `.aider.conf.yml` (cwd / git root); `.aider.conf.yaml` also seen in the wild
 * - Ignore: `.aiderignore` (gitignore-style; default at git root)
 * - Conventions: `CONVENTIONS.md` commonly loaded via conf `read:` — only counted when
 *   an Aider config/ignore file is also present (avoids false positives)
 *
 * We do NOT inspect `~/.aider.conf.yml` — repository only.
 */
export async function detectAider(context: AgentDetectionContext): Promise<AgentDetectionResult> {
  const { root, maxFileSizeBytes } = context;
  const configFiles: AgentConfigFile[] = [];
  const diagnostics: AgentDiagnostic[] = [];
  const seen = new Set<string>();
  const metadata: Record<string, unknown> = {
    hasConf: false,
    hasAiderignore: false,
    hasConventions: false,
  };

  async function addFile(
    relativePath: string,
    kind: "aider-conf" | "aider-ignore" | "aider-conventions",
  ): Promise<void> {
    if (seen.has(relativePath)) {
      return;
    }
    seen.add(relativePath);
    const inspected = await inspectRepoFile(root, relativePath, maxFileSizeBytes);
    configFiles.push(
      toAgentConfigFile(inspected, kind, {
        legacy: false,
        scope: "root",
      }),
    );

    if (!inspected.exists) {
      return;
    }
    if (!inspected.readable && inspected.error) {
      diagnostics.push({
        code: "aider/unreadable-file",
        severity: "warning",
        message: `Could not read Aider file: ${inspected.error}`,
        file: relativePath,
      });
    } else if (inspected.empty && kind !== "aider-ignore") {
      diagnostics.push({
        code: "aider/empty-config",
        severity: "info",
        message: "Aider config/instruction file is empty",
        file: relativePath,
      });
    }
  }

  const confYml = await pathExistsInsideRoot(root, ".aider.conf.yml");
  const confYaml = await pathExistsInsideRoot(root, ".aider.conf.yaml");
  if (confYml) {
    await addFile(".aider.conf.yml", "aider-conf");
    metadata.hasConf = true;
  } else if (confYaml) {
    await addFile(".aider.conf.yaml", "aider-conf");
    metadata.hasConf = true;
  }

  if (await pathExistsInsideRoot(root, ".aiderignore")) {
    await addFile(".aiderignore", "aider-ignore");
    metadata.hasAiderignore = true;
  }

  const aiderPresent = Boolean(metadata.hasConf) || Boolean(metadata.hasAiderignore);
  if (aiderPresent && (await pathExistsInsideRoot(root, "CONVENTIONS.md"))) {
    await addFile("CONVENTIONS.md", "aider-conventions");
    metadata.hasConventions = true;
  }

  const usable = configFiles.some(
    (f) =>
      f.readable &&
      !f.empty &&
      (f.kind === "aider-conf" || f.kind === "aider-conventions" || f.kind === "aider-ignore"),
  );

  const detected = aiderPresent;
  const configured = usable || Boolean(metadata.hasAiderignore) || Boolean(metadata.hasConf);
  const status = deriveStatus({
    detected,
    configured,
    hasErrors: diagnostics.some((d) => d.severity === "error"),
  });

  const parts: string[] = [];
  if (metadata.hasConf) {
    parts.push("conf");
  }
  if (metadata.hasAiderignore) {
    parts.push(".aiderignore");
  }
  if (metadata.hasConventions) {
    parts.push("CONVENTIONS.md");
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
    id: "aider",
    displayName: AGENT_DISPLAY_NAMES.aider,
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

export const aiderAdapter: AgentAdapter = {
  id: "aider",
  displayName: AGENT_DISPLAY_NAMES.aider,
  detect: detectAider,
};
