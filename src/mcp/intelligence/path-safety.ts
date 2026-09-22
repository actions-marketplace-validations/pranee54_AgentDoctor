import path from "node:path";

import { isPathInsideRoot, sanitizeForOutput } from "../../utils/path.js";

/**
 * Decode a single layer of URI encoding. Rejects malformed sequences by returning null.
 */
export function tryDecodeUriComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

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

  for (const candidate of candidates) {
    if (candidate.includes("\0")) {
      throw new Error("invalid target");
    }

    const looksLikePath =
      path.isAbsolute(candidate) ||
      candidate.includes("..") ||
      candidate.includes("/") ||
      candidate.includes("\\") ||
      /^[A-Za-z]:[\\/]/.test(candidate);

    if (!looksLikePath) {
      continue;
    }

    // Reject any .. segment forms before resolve (prevents src/x/../../etc tricks).
    const normalizedSlashes = candidate.replace(/\\/g, "/");
    if (
      normalizedSlashes === ".." ||
      normalizedSlashes.includes("/../") ||
      normalizedSlashes.startsWith("../") ||
      normalizedSlashes.endsWith("/..") ||
      normalizedSlashes.includes("/..") ||
      /(^|\/)\.\.($|\/)/.test(normalizedSlashes)
    ) {
      throw new Error("path escapes repository root");
    }

    // Always reject Windows drive-absolute forms (even on POSIX hosts).
    if (/^[A-Za-z]:[\\/]/.test(candidate)) {
      throw new Error("path escapes repository root");
    }

    // Resolve relative to root; absolute candidates resolve to themselves.
    const resolved = path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(root, candidate);

    if (!isPathInsideRoot(root, resolved)) {
      throw new Error("path escapes repository root");
    }
  }

  // Prefer decoded form for relative path returns when path-like.
  const primary = candidates[candidates.length - 1]!;
  const looksLikePath =
    path.isAbsolute(primary) ||
    primary.includes("..") ||
    primary.includes("/") ||
    primary.includes("\\") ||
    /^[A-Za-z]:[\\/]/.test(primary);

  if (!looksLikePath) {
    return null;
  }

  const resolved = path.isAbsolute(primary) ? path.resolve(primary) : path.resolve(root, primary);
  return path.relative(root, resolved).split(path.sep).join("/");
}
