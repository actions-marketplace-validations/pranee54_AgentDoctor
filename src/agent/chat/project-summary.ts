import path from "node:path";

import { detectProject } from "../../detectors/project.js";
import { resolveRepoRoot } from "../../utils/path.js";

export interface ProjectChatSummary {
  root: string;
  name: string;
  languages: string[];
  frameworks: string[];
  packageManagers: string[];
  hasGit: boolean;
  hasTests: boolean;
  verifiedNotes: string[];
}

/**
 * Concise project fingerprint for /project using existing detectors.
 * Only reports verified detector signals — no invention.
 */
export async function summarizeProjectForChat(rootInput: string): Promise<ProjectChatSummary> {
  const root = resolveRepoRoot(rootInput);
  const detection = await detectProject(root);
  const repo = detection.repository;
  const name = path.basename(root);
  const languages = (repo.languages ?? []).filter((l) => l !== "unknown");
  const frameworks = (repo.frameworks ?? []).filter((f) => f !== "unknown");
  const packageManagers = (repo.packageManagers ?? []).filter((p) => p !== "unknown");

  let hasGit = false;
  try {
    const { access } = await import("node:fs/promises");
    await access(`${root}/.git`);
    hasGit = true;
  } catch {
    hasGit = false;
  }

  const paths = detection.discovery.files.map((f) => f.relativePath.toLowerCase());
  const hasTests = paths.some(
    (p) =>
      p.startsWith("tests/") ||
      p.startsWith("test/") ||
      p.includes(".test.") ||
      p.includes(".spec.") ||
      p.startsWith("__tests__/"),
  );

  const verifiedNotes: string[] = [];
  if (languages.length) verifiedNotes.push(`Languages: ${languages.join(", ")}`);
  if (frameworks.length) verifiedNotes.push(`Frameworks: ${frameworks.join(", ")}`);
  if (packageManagers.length) verifiedNotes.push(`Package managers: ${packageManagers.join(", ")}`);
  if (!languages.length && !frameworks.length) {
    verifiedNotes.push(
      "Limited stack signals — many answers may use UNKNOWN until more files are retrieved.",
    );
  }

  return {
    root,
    name: name || "project",
    languages,
    frameworks,
    packageManagers,
    hasGit,
    hasTests,
    verifiedNotes,
  };
}

export function formatProjectSummary(summary: ProjectChatSummary): string {
  return [
    "Project:",
    `  ${summary.name}`,
    `  root: ${summary.root}`,
    "",
    "Detected (verified repository signals):",
    `  languages: ${summary.languages.join(", ") || "(none)"}`,
    `  frameworks: ${summary.frameworks.join(", ") || "(none)"}`,
    `  package managers: ${summary.packageManagers.join(", ") || "(none)"}`,
    `  git: ${summary.hasGit ? "yes" : "not detected"}`,
    `  tests: ${summary.hasTests ? "detected" : "not detected"}`,
    "",
    ...summary.verifiedNotes.map((n) => `  - ${n}`),
    "",
    "Ask a question for evidence-backed detail.",
    "",
  ].join("\n");
}
