import { toRepoRelativePosix } from "../../utils/path.js";

/**
 * Minimal gitignore-style pattern matching for .gitignore / agent ignore files.
 * Supports common patterns used in agent ignore files — not a full gitignore clone.
 */

export interface IgnoreIndex {
  gitignorePatterns: string[];
  cursorignorePatterns: string[];
  geminiignorePatterns: string[];
  aiderignorePatterns: string[];
  matchesGitignore(relativePath: string): boolean;
  matchesCursorignore(relativePath: string): boolean;
  matchesGeminiignore(relativePath: string): boolean;
  matchesAiderignore(relativePath: string): boolean;
  /** Whether a path appears excluded for Cursor agent/indexing purposes. */
  isExcludedForCursor(relativePath: string): boolean;
  /** Gemini CLI respects .geminiignore and .gitignore. */
  isExcludedForGemini(relativePath: string): boolean;
  /** Aider respects .aiderignore and typically .gitignore. */
  isExcludedForAider(relativePath: string): boolean;
}

function normalizePattern(pattern: string): string | null {
  const trimmed = pattern.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  return trimmed.replace(/\\ /g, " ");
}

export function parseIgnoreFile(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map(normalizePattern)
    .filter((p): p is string => p !== null);
}

/**
 * Rewrite patterns from a nested ignore file so they apply relative to repository root.
 * `baseDir` is the directory containing the ignore file (POSIX, no trailing slash), or "".
 */
export function relativizeIgnorePatterns(baseDir: string, patterns: string[]): string[] {
  if (!baseDir || baseDir === ".") {
    return patterns;
  }
  return patterns.map((pattern) => {
    const negated = pattern.startsWith("!");
    const body = negated ? pattern.slice(1) : pattern;
    let rewritten: string;
    if (body.startsWith("/")) {
      rewritten = `${baseDir}${body}`;
    } else if (body.startsWith("**/")) {
      rewritten = `${baseDir}/${body.slice(3)}`;
    } else {
      rewritten = `${baseDir}/${body}`;
    }
    return negated ? `!${rewritten}` : rewritten;
  });
}

/**
 * Match a relative POSIX path against a single gitignore-like pattern.
 * Negation (`!`) is not fully supported for re-inclusion of parent-excluded paths.
 */
export function matchIgnorePattern(relativePath: string, pattern: string): boolean {
  let pat = pattern;
  if (pat.startsWith("!")) {
    pat = pat.slice(1);
  }

  const pathNorm = toRepoRelativePosix(relativePath);
  let matched = false;

  if (pat.endsWith("/")) {
    const dir = pat.slice(0, -1);
    if (!dir.includes("/")) {
      matched =
        pathNorm === dir ||
        pathNorm.endsWith(`/${dir}`) ||
        pathNorm.split("/").includes(dir) ||
        globMatch(pathNorm, `**/${dir}`) ||
        globMatch(pathNorm, `**/${dir}/**`);
    } else {
      matched =
        pathNorm === dir ||
        pathNorm.startsWith(`${dir}/`) ||
        globMatch(pathNorm, dir) ||
        globMatch(pathNorm, `${dir}/**`);
    }
  } else if (pat.startsWith("/")) {
    matched = globMatch(pathNorm, pat.slice(1));
  } else if (pat.includes("/")) {
    matched =
      globMatch(pathNorm, pat) ||
      globMatch(pathNorm, `${pat}/**`) ||
      pathNorm.endsWith(`/${pat}`) ||
      pathNorm.startsWith(`${pat}/`);
  } else {
    const base = pathNorm.split("/").pop() ?? pathNorm;
    matched =
      globMatch(base, pat) ||
      globMatch(pathNorm, pat) ||
      globMatch(pathNorm, `**/${pat}`) ||
      pathNorm.split("/").includes(pat);
  }

  return matched;
}

function globMatch(value: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\0/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

export function pathMatchesAny(relativePath: string, patterns: string[]): boolean {
  let ignored = false;
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) {
      if (matchIgnorePattern(relativePath, pattern.slice(1))) {
        ignored = false;
      }
    } else if (matchIgnorePattern(relativePath, pattern)) {
      ignored = true;
    }
  }
  return ignored;
}

/** Cursor documents default ignore of .env* (see cursor.com/docs/reference/ignore-file). */
const CURSOR_DEFAULT_ENV_PATTERNS = [".env", ".env.*", "**/.env", "**/.env.*"];

export function createIgnoreIndex(options: {
  gitignorePatterns: string[];
  cursorignorePatterns: string[];
  geminiignorePatterns?: string[];
  aiderignorePatterns?: string[];
}): IgnoreIndex {
  const gitignorePatterns = options.gitignorePatterns;
  const cursorignorePatterns = options.cursorignorePatterns;
  const geminiignorePatterns = options.geminiignorePatterns ?? [];
  const aiderignorePatterns = options.aiderignorePatterns ?? [];

  return {
    gitignorePatterns,
    cursorignorePatterns,
    geminiignorePatterns,
    aiderignorePatterns,
    matchesGitignore(relativePath: string): boolean {
      return pathMatchesAny(relativePath, gitignorePatterns);
    },
    matchesCursorignore(relativePath: string): boolean {
      return pathMatchesAny(relativePath, cursorignorePatterns);
    },
    matchesGeminiignore(relativePath: string): boolean {
      return pathMatchesAny(relativePath, geminiignorePatterns);
    },
    matchesAiderignore(relativePath: string): boolean {
      return pathMatchesAny(relativePath, aiderignorePatterns);
    },
    isExcludedForCursor(relativePath: string): boolean {
      if (pathMatchesAny(relativePath, cursorignorePatterns)) {
        return true;
      }
      if (pathMatchesAny(relativePath, gitignorePatterns)) {
        return true;
      }
      return pathMatchesAny(relativePath, CURSOR_DEFAULT_ENV_PATTERNS);
    },
    isExcludedForGemini(relativePath: string): boolean {
      if (pathMatchesAny(relativePath, geminiignorePatterns)) {
        return true;
      }
      return pathMatchesAny(relativePath, gitignorePatterns);
    },
    isExcludedForAider(relativePath: string): boolean {
      if (pathMatchesAny(relativePath, aiderignorePatterns)) {
        return true;
      }
      return pathMatchesAny(relativePath, gitignorePatterns);
    },
  };
}
