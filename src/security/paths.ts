import fs from "node:fs";
import path from "node:path";

import { resolveRepoRoot, isPathInsideRoot, toPosixRelative } from "../utils/path.js";

export class PathEscapeError extends Error {
  readonly code = "PATH_ESCAPE";
  constructor(message = "path escapes repository root") {
    super(message);
    this.name = "PathEscapeError";
  }
}

function tryDecodeUri(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function hasTraversalSegment(value: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  if (normalized.includes("\0")) return true;
  // Reject any `..` occurrence (including encoded forms after decode and `....` tricks).
  if (normalized.includes("..")) return true;
  return false;
}

function isWindowsDriveAbsolute(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value);
}

/**
 * Lexical hostility checks shared by resolve/assert helpers.
 * Does not leak the candidate path in thrown messages.
 */
export function rejectHostilePathInput(candidate: string): void {
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new PathEscapeError("invalid path");
  }
  if (candidate.includes("\0")) {
    throw new PathEscapeError("invalid path");
  }

  const decoded = tryDecodeUri(candidate);
  if (decoded === null) {
    throw new PathEscapeError("invalid path");
  }

  for (const form of decoded === candidate ? [candidate] : [candidate, decoded]) {
    if (form.includes("\0") || hasTraversalSegment(form) || isWindowsDriveAbsolute(form)) {
      throw new PathEscapeError("path escapes repository root");
    }
  }
}

function realpathRoot(root: string): string {
  try {
    return fs.realpathSync(root);
  } catch {
    return path.resolve(root);
  }
}

/**
 * Resolve a user-supplied path and require it to remain inside the repository root.
 * Rejects `..`, URI-encoded traversal, null bytes, Windows-drive absolutes, and
 * symlink realpath escapes. Error messages never echo the hostile candidate.
 */
export function resolveSafeRepoPath(rootInput: string, candidate: string): string {
  const root = resolveRepoRoot(rootInput);
  rejectHostilePathInput(candidate);

  const decoded = tryDecodeUri(candidate) ?? candidate;
  const primary = decoded;

  const absolute = path.isAbsolute(primary) ? path.normalize(primary) : path.resolve(root, primary);

  // Lexical containment against the resolved (non-realpath) root first.
  // On macOS, /var vs /private/var must not false-reject before realpath.
  if (!isPathInsideRoot(root, absolute) && path.resolve(absolute) !== path.resolve(root)) {
    throw new PathEscapeError("path escapes repository root");
  }

  const realRoot = realpathRoot(root);

  // Existing path: realpath and verify (catches symlink escape).
  if (fs.existsSync(absolute)) {
    let realTarget: string;
    try {
      realTarget = fs.realpathSync(absolute);
    } catch {
      realTarget = absolute;
    }
    if (!isPathInsideRoot(realRoot, realTarget) && realTarget !== realRoot) {
      throw new PathEscapeError("path escapes repository root");
    }
    return realTarget;
  }

  // Non-existent path (create): reject if any existing ancestor realpath escapes
  // (symlink-dir escape), then map under realRoot for /var vs /private/var.
  let ancestor = path.dirname(absolute);
  for (;;) {
    if (fs.existsSync(ancestor)) {
      let realAncestor: string;
      try {
        realAncestor = fs.realpathSync(ancestor);
      } catch {
        realAncestor = ancestor;
      }
      if (!isPathInsideRoot(realRoot, realAncestor) && realAncestor !== realRoot) {
        throw new PathEscapeError("path escapes repository root");
      }
      break;
    }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }

  const rel = path.relative(root, absolute);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new PathEscapeError("path escapes repository root");
  }
  const mapped = path.resolve(realRoot, rel);
  if (!isPathInsideRoot(realRoot, mapped) && mapped !== realRoot) {
    throw new PathEscapeError("path escapes repository root");
  }
  return mapped;
}

/** Assert `candidate` resolves inside `root`; throws PathEscapeError otherwise. */
export function assertInsideRepo(rootInput: string, candidate: string): void {
  resolveSafeRepoPath(rootInput, candidate);
}

/** Resolve safely and return a POSIX path relative to the repo root. */
export function safeRelPath(rootInput: string, absoluteOrRel: string): string {
  const abs = resolveSafeRepoPath(rootInput, absoluteOrRel);
  const root = realpathRoot(resolveRepoRoot(rootInput));
  return toPosixRelative(root, abs);
}

export { tryDecodeUri as tryDecodeUriComponent };
