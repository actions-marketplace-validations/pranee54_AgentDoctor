import fs from "node:fs/promises";
import path from "node:path";

import { resolveRepoRoot, toPosixRelative } from "../../utils/path.js";

export type ContextConflictKind =
  | "duplicate-instruction-surface"
  | "contradictory-tone"
  | "overlapping-ignore"
  | "empty-instruction-file"
  | "oversized-instruction-file"
  | "invalid-path-reference"
  | "ambiguous-marker"
  | "outdated-year-reference"
  | "terminology-inconsistency"
  | "unused-ignore-candidate";

export interface ContextConflict {
  kind: ContextConflictKind;
  severity: "warning" | "info";
  files: string[];
  message: string;
  confidence: "high" | "medium" | "low";
}

export interface ContextHealthReport {
  root: string;
  conflicts: ContextConflict[];
  instructionFiles: string[];
  ignoreFiles: string[];
}

const INSTRUCTION_CANDIDATES = [
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  "CONVENTIONS.md",
  ".cursorrules",
  ".windsurfrules",
  ".github/copilot-instructions.md",
];

const IGNORE_CANDIDATES = [
  ".cursorignore",
  ".claudeignore",
  ".codexignore",
  ".geminiignore",
  ".aiderignore",
];

const OVERSIZE_BYTES = 100_000;
const PATH_REF =
  /(?:^|[\s`"'(])((?:\.\.?\/|[A-Za-z0-9_.-]+\/)[A-Za-z0-9_./-]+\.[A-Za-z0-9]+)(?=[\s`"'')]|$)/gm;
const AMBIGUOUS = /\b(TODO|FIXME|TBD|XXX)\b/g;
const YEAR_REF = /\b(20[0-1][0-9]|202[0-3])\b/g;

async function existsFile(root: string, rel: string): Promise<boolean> {
  try {
    const st = await fs.lstat(path.join(root, rel));
    return st.isFile() || st.isSymbolicLink();
  } catch {
    return false;
  }
}

async function readText(root: string, rel: string): Promise<string> {
  try {
    return await fs.readFile(path.join(root, rel), "utf8");
  } catch {
    return "";
  }
}

async function fileSize(root: string, rel: string): Promise<number> {
  try {
    const st = await fs.stat(path.join(root, rel));
    return st.size;
  } catch {
    return 0;
  }
}

function hasContradictoryTone(a: string, b: string): boolean {
  const always = /\balways\b/i;
  const never = /\bnever\b/i;
  return (always.test(a) && never.test(b)) || (never.test(a) && always.test(b));
}

function extractTerms(text: string): Set<string> {
  const terms = new Set<string>();
  for (const m of text.matchAll(/\b(repo|repository|codebase|project|workspace)\b/gi)) {
    terms.add(m[1]!.toLowerCase());
  }
  return terms;
}

export async function analyzeContextHealth(rootInput: string): Promise<ContextHealthReport> {
  const root = resolveRepoRoot(rootInput);
  const instructionFiles: string[] = [];
  const ignoreFiles: string[] = [];
  const conflicts: ContextConflict[] = [];

  for (const rel of INSTRUCTION_CANDIDATES) {
    if (await existsFile(root, rel)) {
      instructionFiles.push(rel);
    }
  }

  try {
    const instructionsDir = path.join(root, ".github", "instructions");
    const entries = await fs.readdir(instructionsDir);
    for (const entry of entries) {
      if (entry.endsWith(".md")) {
        instructionFiles.push(toPosixRelative(root, path.join(instructionsDir, entry)));
      }
    }
  } catch {
    // optional
  }

  for (const rel of IGNORE_CANDIDATES) {
    if (await existsFile(root, rel)) {
      ignoreFiles.push(rel);
    }
  }

  if (instructionFiles.length >= 2) {
    conflicts.push({
      kind: "duplicate-instruction-surface",
      severity: "info",
      files: [...instructionFiles],
      message:
        "Multiple agent instruction surfaces detected; prefer one primary source of truth per agent.",
      confidence: "high",
    });
  }

  const currentYear = new Date().getUTCFullYear();
  const termUnion = new Set<string>();
  const termByFile = new Map<string, Set<string>>();

  for (const rel of instructionFiles) {
    const text = await readText(root, rel);
    if (text.trim().length === 0) {
      conflicts.push({
        kind: "empty-instruction-file",
        severity: "warning",
        files: [rel],
        message: `Instruction file is empty: ${rel}`,
        confidence: "high",
      });
      continue;
    }

    const size = await fileSize(root, rel);
    if (size > OVERSIZE_BYTES) {
      conflicts.push({
        kind: "oversized-instruction-file",
        severity: "warning",
        files: [rel],
        message: `Instruction file exceeds ${OVERSIZE_BYTES} bytes (${size}): ${rel}`,
        confidence: "high",
      });
    }

    AMBIGUOUS.lastIndex = 0;
    const ambiguousHits = text.match(AMBIGUOUS);
    if (ambiguousHits && ambiguousHits.length > 0) {
      conflicts.push({
        kind: "ambiguous-marker",
        severity: "info",
        files: [rel],
        message: `Ambiguous markers (${[...new Set(ambiguousHits)].join(", ")}) in ${rel}`,
        confidence: "medium",
      });
    }

    YEAR_REF.lastIndex = 0;
    for (const m of text.matchAll(YEAR_REF)) {
      const year = Number(m[1]);
      if (Number.isFinite(year) && year < currentYear - 1) {
        conflicts.push({
          kind: "outdated-year-reference",
          severity: "info",
          files: [rel],
          message: `Possibly outdated year reference ${year} in ${rel}`,
          confidence: "low",
        });
        break;
      }
    }

    PATH_REF.lastIndex = 0;
    const seenRefs = new Set<string>();
    for (const m of text.matchAll(PATH_REF)) {
      const ref = (m[1] ?? "").replace(/^\.\//, "");
      if (!ref || seenRefs.has(ref) || ref.includes("http")) continue;
      seenRefs.add(ref);
      if (ref.startsWith("node_modules/")) continue;
      const exists = await existsFile(root, ref);
      if (!exists) {
        conflicts.push({
          kind: "invalid-path-reference",
          severity: "warning",
          files: [rel],
          message: `Referenced path not found: ${ref} (from ${rel})`,
          confidence: "medium",
        });
      }
    }

    const terms = extractTerms(text);
    termByFile.set(rel, terms);
    for (const t of terms) termUnion.add(t);
  }

  if (termUnion.has("repo") && termUnion.has("repository") && termByFile.size >= 2) {
    const filesUsing: string[] = [];
    for (const [file, terms] of termByFile) {
      if (terms.has("repo") || terms.has("repository")) filesUsing.push(file);
    }
    if (filesUsing.length >= 2) {
      conflicts.push({
        kind: "terminology-inconsistency",
        severity: "info",
        files: filesUsing.sort(),
        message: 'Mixed terminology "repo" vs "repository" across instruction files',
        confidence: "low",
      });
    }
  }

  for (let i = 0; i < instructionFiles.length; i += 1) {
    for (let j = i + 1; j < instructionFiles.length; j += 1) {
      const a = instructionFiles[i]!;
      const b = instructionFiles[j]!;
      const textA = await readText(root, a);
      const textB = await readText(root, b);
      if (hasContradictoryTone(textA, textB)) {
        conflicts.push({
          kind: "contradictory-tone",
          severity: "warning",
          files: [a, b],
          message: `Potential always/never contradiction between ${a} and ${b}`,
          confidence: "medium",
        });
      }
    }
  }

  if (ignoreFiles.length >= 2) {
    conflicts.push({
      kind: "overlapping-ignore",
      severity: "info",
      files: [...ignoreFiles],
      message: "Multiple ignore surfaces present; keep patterns aligned across agents.",
      confidence: "high",
    });
  }

  // Empty ignore files are unused-candidate signals
  for (const rel of ignoreFiles) {
    const text = await readText(root, rel);
    if (text.trim().length === 0) {
      conflicts.push({
        kind: "unused-ignore-candidate",
        severity: "info",
        files: [rel],
        message: `Ignore file exists but is empty: ${rel}`,
        confidence: "medium",
      });
    }
  }

  return {
    root,
    conflicts,
    instructionFiles: instructionFiles.sort(),
    ignoreFiles: ignoreFiles.sort(),
  };
}
