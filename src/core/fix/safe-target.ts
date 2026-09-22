import fs from "node:fs/promises";
import path from "node:path";

import { FIX_PATH_ALLOWLIST, type FixAllowlistedPath } from "./types.js";

/**
 * Resolve an allowlisted Fix target and refuse symlink write-through /
 * path-escape before any Safe Fix writer mutates the filesystem.
 */
export async function resolveSafeFixWritePath(
  root: string,
  relativePath: string,
): Promise<{ absolutePath: string; relativePath: FixAllowlistedPath }> {
  if (!(FIX_PATH_ALLOWLIST as readonly string[]).includes(relativePath)) {
    throw new Error(`Fix target is not allowlisted: ${relativePath}`);
  }
  const allowlisted = relativePath as FixAllowlistedPath;

  if (path.isAbsolute(allowlisted) || allowlisted.split(/[/\\]/).includes("..")) {
    throw new Error(`Fix target path is invalid: ${allowlisted}`);
  }

  const rootReal = await fs.realpath(root);
  const absolutePath = path.resolve(rootReal, allowlisted);
  const relativeToRoot = path.relative(rootReal, absolutePath);
  if (
    relativeToRoot.startsWith("..") ||
    path.isAbsolute(relativeToRoot) ||
    relativeToRoot.includes(`..${path.sep}`)
  ) {
    throw new Error(`Fix target escapes repository root: ${allowlisted}`);
  }

  await assertNoSymlinkAncestors(rootReal, absolutePath, allowlisted);

  try {
    const stat = await fs.lstat(absolutePath);
    if (stat.isSymbolicLink()) {
      throw new Error(
        `refusing to write through symlink Fix target: ${allowlisted} (replace the symlink with a regular file first)`,
      );
    }
    if (stat.isDirectory()) {
      throw new Error(
        `refusing Fix target that is a directory: ${allowlisted} (expected a regular file)`,
      );
    }
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (code !== "ENOENT") {
      throw error;
    }
  }

  return { absolutePath, relativePath: allowlisted };
}

/**
 * Preflight every planned Fix target before any writer mutates the repo.
 * Fails fast if any target is unsafe; does not create files.
 */
export async function preflightSafeFixTargets(
  root: string,
  relativePaths: readonly string[],
): Promise<FixAllowlistedPath[]> {
  const unique = [...new Set(relativePaths)];
  const resolved: FixAllowlistedPath[] = [];
  for (const relativePath of unique) {
    const { relativePath: allowlisted } = await resolveSafeFixWritePath(root, relativePath);
    resolved.push(allowlisted);
  }
  return resolved;
}

async function assertNoSymlinkAncestors(
  rootReal: string,
  absolutePath: string,
  label: string,
): Promise<void> {
  let current = path.dirname(absolutePath);
  while (current.startsWith(rootReal) && current !== rootReal) {
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error(
          `refusing Fix target under symlink directory: ${label} (ancestor ${path.relative(rootReal, current)} is a symlink)`,
        );
      }
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code: unknown }).code)
          : "";
      if (code === "ENOENT") {
        break;
      }
      throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
}
