import path from "node:path";

import {
  PathEscapeError,
  rejectHostilePathInput,
  resolveSafeRepoPath,
  tryDecodeUriComponent,
} from "../../security/paths.js";
import { sanitizeForOutput } from "../../utils/path.js";

export { tryDecodeUriComponent };

/**
 * Validate a user-supplied repository-relative or in-repo target.
 * Returns a normalized path relative to root (POSIX) when the target is path-like and safe,
 * or null when the target is treated as a non-path identifier (graph id / label).
 * Throws a safe Error (no outside path leakage) when a path-like target escapes the root.
 */
export function assertSafeRepoTarget(root: string, rawTarget: string): string | null {
  if (typeof rawTarget !== "string" || rawTarget.includes("\0")) {
    throw new Error("invalid target");
  }
  const cleaned = sanitizeForOutput(rawTarget).trim();
  if (!cleaned) {
    throw new Error("invalid target");
  }
  if (cleaned.includes("\0")) {
    throw new Error("invalid target");
  }

  const decoded = tryDecodeUriComponent(cleaned);
  if (decoded === null) {
    throw new Error("invalid target");
  }
  const candidates = decoded === cleaned ? [cleaned] : [cleaned, decoded];

  let pathLike = false;
  for (const candidate of candidates) {
    const looksLikePath =
      path.isAbsolute(candidate) ||
      candidate.includes("..") ||
      candidate.includes("/") ||
      candidate.includes("\\") ||
      /^[A-Za-z]:[\\/]/.test(candidate);

    if (!looksLikePath) {
      continue;
    }
    pathLike = true;

    try {
      rejectHostilePathInput(candidate);
      resolveSafeRepoPath(root, candidate);
    } catch (error) {
      if (error instanceof PathEscapeError) {
        throw new Error(error.message);
      }
      throw new Error("invalid target");
    }
  }

  if (!pathLike) {
    return null;
  }

  const primary = candidates[candidates.length - 1]!;
  try {
    const abs = resolveSafeRepoPath(root, primary);
    return path.relative(root, abs).split(path.sep).join("/");
  } catch (error) {
    if (error instanceof PathEscapeError) {
      throw new Error(error.message);
    }
    throw new Error("invalid target");
  }
}
