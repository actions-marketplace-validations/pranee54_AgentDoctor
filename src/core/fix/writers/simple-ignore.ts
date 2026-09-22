import path from "node:path";

import type { AgentId } from "../../../types/index.js";
import { atomicWriteTextFile, readTextFile } from "../../../utils/fs.js";
import { missingPatternsForIgnoreFile } from "../plan.js";
import { resolveSafeFixWritePath } from "../safe-target.js";
import type { FixAction, FixAllowlistedPath } from "../types.js";

const MAX_BYTES = 512 * 1024;
const BANNER = "# Added by AgentDoctor";

export interface SimpleIgnoreWritePreview {
  targetRelativePath: FixAllowlistedPath;
  patternsToAdd: string[];
  before: string;
  after: string;
  preview: string;
}

export function buildSimpleIgnoreContent(
  currentContent: string | null,
  patternsToAdd: string[],
): string {
  if (patternsToAdd.length === 0) {
    return currentContent ?? "";
  }

  const base = currentContent ?? "";
  const trimmed = base.replace(/\s+$/, "");
  const block = [BANNER, ...patternsToAdd].join("\n");
  if (trimmed.length === 0) {
    return `${block}\n`;
  }
  return `${trimmed}\n\n${block}\n`;
}

export function previewSimpleIgnoreActions(
  currentContent: string | null,
  actions: FixAction[],
  options: { agent: AgentId; targetRelativePath: FixAllowlistedPath },
): SimpleIgnoreWritePreview | null {
  const matched = actions.filter(
    (a) => a.agent === options.agent && a.targetRelativePath === options.targetRelativePath,
  );
  if (matched.length === 0) {
    return null;
  }

  const requested = [...new Set(matched.map((a) => a.pattern))];
  const patternsToAdd = missingPatternsForIgnoreFile(currentContent, requested);
  if (patternsToAdd.length === 0) {
    return null;
  }

  const before = currentContent ?? "";
  const after = buildSimpleIgnoreContent(currentContent, patternsToAdd);
  const preview = formatSimpleDiff(options.targetRelativePath, before, after);

  return {
    targetRelativePath: options.targetRelativePath,
    patternsToAdd,
    before,
    after,
    preview,
  };
}

export async function readSimpleIgnore(root: string, relativePath: string): Promise<string | null> {
  return readTextFile(path.join(root, relativePath), MAX_BYTES);
}

export async function writeSimpleIgnore(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const { absolutePath } = await resolveSafeFixWritePath(root, relativePath);
  await atomicWriteTextFile(absolutePath, content);
}

function formatSimpleDiff(fileLabel: string, before: string, after: string): string {
  const beforeLines = before.length === 0 ? [] : before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const lines: string[] = [];
  lines.push(`--- a/${fileLabel}`);
  lines.push(`+++ b/${fileLabel}`);
  const addedStart = beforeLines.length === 0 ? 0 : beforeLines.length;
  for (let i = addedStart; i < afterLines.length; i++) {
    const line = afterLines[i];
    if (line === undefined) {
      continue;
    }
    lines.push(`+${line}`);
  }
  if (before.length === 0) {
    lines.splice(2, 0, "@@ new file @@");
  } else {
    lines.splice(2, 0, "@@ append @@");
  }
  return lines.join("\n");
}
