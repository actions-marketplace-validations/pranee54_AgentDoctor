import { AGENT_DISPLAY_NAMES } from "../../constants.js";
import {
  deriveStatus,
  inspectRepoFile,
  pathExistsInsideRoot,
  toAgentConfigFile,
  tryParseJson,
} from "../inspect.js";
import type {
  AgentAdapter,
  AgentConfigFile,
  AgentDetectionContext,
  AgentDetectionResult,
  AgentDiagnostic,
} from "../types.js";
import { basenameOf, isRootLevel } from "../types.js";

/**
 * Gemini CLI project configuration detection.
 *
 * Official sources (google-gemini.github.io/gemini-cli):
 * - Context: `GEMINI.md` (cwd, ancestors to git root, and subdirectories)
 * - Project settings: `.gemini/settings.json`
 * - Ignore: `.geminiignore` (gitignore-style)
 *
 * We do NOT inspect `~/.gemini` — repository only.
 */
export async function detectGeminiCli(
  context: AgentDetectionContext,
): Promise<AgentDetectionResult> {
  const { root, discovery, maxFileSizeBytes } = context;
  const configFiles: AgentConfigFile[] = [];
  const diagnostics: AgentDiagnostic[] = [];
  const seen = new Set<string>();
  const metadata: Record<string, unknown> = {
    geminiMdCount: 0,
    hasGeminiDir: false,
    hasSettings: false,
    hasGeminiignore: false,
  };

  async function addGeminiMd(relativePath: string): Promise<void> {
    if (seen.has(relativePath)) {
      return;
    }
    seen.add(relativePath);
    const inspected = await inspectRepoFile(root, relativePath, maxFileSizeBytes);
    configFiles.push(
      toAgentConfigFile(inspected, "gemini-md", {
        legacy: false,
        scope: isRootLevel(relativePath) ? "root" : "nested",
      }),
    );
    metadata.geminiMdCount = Number(metadata.geminiMdCount) + 1;

    if (!inspected.exists) {
      return;
    }
    if (!inspected.readable && inspected.error) {
      diagnostics.push({
        code: "gemini/unreadable-file",
        severity: "warning",
        message: `Could not read Gemini context file: ${inspected.error}`,
        file: relativePath,
      });
    } else if (inspected.empty) {
      diagnostics.push({
        code: "gemini/empty-instruction",
        severity: "info",
        message: "Gemini context file is empty",
        file: relativePath,
      });
    }
  }

  metadata.hasGeminiDir = await pathExistsInsideRoot(root, ".gemini");

  if (await pathExistsInsideRoot(root, ".gemini/settings.json")) {
    const relative = ".gemini/settings.json";
    seen.add(relative);
    const inspected = await inspectRepoFile(root, relative, maxFileSizeBytes);
    let parseError: string | undefined;
    if (inspected.readable && inspected.text !== null && !inspected.empty) {
      const parsed = tryParseJson(inspected.text);
      if (!parsed.ok) {
        parseError = parsed.error;
        diagnostics.push({
          code: "gemini/malformed-settings",
          severity: "warning",
          message: `${relative} could not be parsed: ${parsed.error}`,
          file: relative,
        });
      }
    } else if (inspected.exists && inspected.empty) {
      diagnostics.push({
        code: "gemini/empty-settings",
        severity: "info",
        message: `${relative} is empty`,
        file: relative,
      });
    }
    configFiles.push(
      toAgentConfigFile(inspected, "gemini-settings", {
        legacy: false,
        scope: "root",
        ...(parseError !== undefined ? { parseError } : {}),
      }),
    );
    metadata.hasSettings = true;
  }

  if (await pathExistsInsideRoot(root, ".geminiignore")) {
    metadata.hasGeminiignore = true;
  }

  for (const file of discovery.files) {
    if (basenameOf(file.relativePath) === "GEMINI.md") {
      await addGeminiMd(file.relativePath);
    }
  }

  if (await pathExistsInsideRoot(root, "GEMINI.md")) {
    await addGeminiMd("GEMINI.md");
  }

  const usableInstruction = configFiles.some(
    (f) =>
      f.readable &&
      !f.empty &&
      (f.kind === "gemini-md" || (f.kind === "gemini-settings" && f.parseError === undefined)),
  );

  const detected =
    Boolean(metadata.hasGeminiDir) ||
    Boolean(metadata.hasGeminiignore) ||
    Number(metadata.geminiMdCount) > 0 ||
    Boolean(metadata.hasSettings);

  const configured = usableInstruction || Boolean(metadata.hasGeminiignore);
  const hasParseProblems = configFiles.some((f) => f.parseError !== undefined);
  const status = deriveStatus({
    detected,
    configured,
    hasErrors: diagnostics.some((d) => d.severity === "error") || (hasParseProblems && !configured),
  });

  const parts: string[] = [];
  if (Number(metadata.geminiMdCount) > 0) {
    parts.push("GEMINI.md");
  }
  if (metadata.hasSettings) {
    parts.push("settings");
  }
  if (metadata.hasGeminiignore) {
    parts.push(".geminiignore");
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
    id: "gemini-cli",
    displayName: AGENT_DISPLAY_NAMES["gemini-cli"],
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

export const geminiCliAdapter: AgentAdapter = {
  id: "gemini-cli",
  displayName: AGENT_DISPLAY_NAMES["gemini-cli"],
  detect: detectGeminiCli,
};
