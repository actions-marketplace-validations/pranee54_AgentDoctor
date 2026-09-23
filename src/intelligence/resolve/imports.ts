import fs from "node:fs";
import path from "node:path";

export type ImportConfidence = "EXACT" | "RESOLVED" | "INFERRED" | "UNRESOLVED";

export interface TsconfigPathsConfig {
  baseUrl: string;
  paths: Record<string, string[]>;
  configPath: string;
}

export interface ImportResolutionResult {
  specifier: string;
  fromFile: string;
  resolvedPath: string | null;
  confidence: ImportConfidence;
  via?: string;
}

const FILE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function fileExists(abs: string, existsFn?: (p: string) => boolean): boolean {
  if (existsFn) return existsFn(abs);
  try {
    return fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}

function dirExists(abs: string, existsFn?: (p: string) => boolean): boolean {
  if (existsFn) {
    // Approximate: any index file under the dir.
    return FILE_EXTENSIONS.some((ext) => existsFn(path.join(abs, `index${ext}`)));
  }
  try {
    return fs.statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Try exact file, extension variants, then index/barrel.
 * Returns confidence EXACT when the written path exists as-is,
 * RESOLVED when found via extension or index.
 */
function resolveFilesystemCandidate(
  root: string,
  absWithoutExt: string,
  existsFn?: (p: string) => boolean,
): { abs: string; confidence: ImportConfidence; via: string } | null {
  const tryFile = (abs: string, confidence: ImportConfidence, via: string) => {
    if (fileExists(abs, existsFn)) {
      return { abs, confidence, via };
    }
    return null;
  };

  const exact = tryFile(absWithoutExt, "EXACT", "exact");
  if (exact) return exact;

  for (const ext of FILE_EXTENSIONS) {
    if (absWithoutExt.endsWith(ext)) continue;
    const hit = tryFile(`${absWithoutExt}${ext}`, "RESOLVED", `extension:${ext}`);
    if (hit) return hit;
  }

  if (dirExists(absWithoutExt, existsFn)) {
    for (const ext of FILE_EXTENSIONS) {
      const hit = tryFile(path.join(absWithoutExt, `index${ext}`), "RESOLVED", `index:index${ext}`);
      if (hit) return hit;
    }
  }

  return null;
}

function stripJsonComments(text: string): string {
  // Minimal strip for // and /* */ outside strings — enough for typical tsconfig.
  let out = "";
  let i = 0;
  let inString: '"' | "'" | null = null;
  while (i < text.length) {
    const ch = text[i]!;
    if (inString) {
      out += ch;
      if (ch === "\\" && i + 1 < text.length) {
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      i += 2;
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i + 1 < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    // Trailing commas before } or ]
    if (ch === "," && (text.slice(i + 1).match(/^\s*[}\]]/) ?? false)) {
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Read tsconfig.json paths/baseUrl when present. Returns null when absent or unreadable.
 * Does not invent mappings.
 */
export function loadTsconfigPaths(root: string): TsconfigPathsConfig | null {
  const configPath = path.join(root, "tsconfig.json");
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(stripJsonComments(raw)) as {
      compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
    };
    const baseUrl = parsed.compilerOptions?.baseUrl ?? ".";
    const paths = parsed.compilerOptions?.paths ?? {};
    return { baseUrl, paths, configPath };
  } catch {
    return null;
  }
}

function matchTsconfigPath(
  specifier: string,
  config: TsconfigPathsConfig,
): { mapped: string; pattern: string } | null {
  const entries = Object.entries(config.paths);
  // Prefer longest pattern key for specificity.
  entries.sort((a, b) => b[0].length - a[0].length);
  for (const [pattern, targets] of entries) {
    if (!targets.length) continue;
    if (pattern.includes("*")) {
      const [prefix, suffix] = pattern.split("*");
      if (
        typeof prefix === "string" &&
        typeof suffix === "string" &&
        specifier.startsWith(prefix) &&
        specifier.endsWith(suffix)
      ) {
        const star = specifier.slice(prefix.length, specifier.length - suffix.length);
        const target = targets[0]!;
        const mapped = target.includes("*") ? target.split("*").join(star) : target;
        return { mapped, pattern };
      }
    } else if (specifier === pattern) {
      return { mapped: targets[0]!, pattern };
    }
  }
  return null;
}

/**
 * Resolve an import specifier relative to `fromFile` (repo-relative POSIX).
 * Never invents a path for UNRESOLVED — `resolvedPath` is null.
 */
export function resolveImportSpecifier(options: {
  root: string;
  fromFile: string;
  specifier: string;
  tsconfig?: TsconfigPathsConfig | null;
  fileExists?: (absolutePath: string) => boolean;
}): ImportResolutionResult {
  const { root, fromFile, specifier } = options;
  const fromPosix = toPosix(fromFile);
  const base: Omit<ImportResolutionResult, "resolvedPath" | "confidence" | "via"> = {
    specifier,
    fromFile: fromPosix,
  };

  if (!specifier || specifier.includes("\0")) {
    return { ...base, resolvedPath: null, confidence: "UNRESOLVED" };
  }

  const existsFn = options.fileExists;
  const toRel = (abs: string) => toPosix(path.relative(root, abs));

  // Relative imports
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const fromDir = path.dirname(path.join(root, fromPosix));
    const abs = path.resolve(fromDir, specifier);
    // Containment: refuse escaping the repo when resolving relatives.
    const rel = path.relative(root, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return { ...base, resolvedPath: null, confidence: "UNRESOLVED" };
    }
    const hit = resolveFilesystemCandidate(root, abs, existsFn);
    if (!hit) {
      return { ...base, resolvedPath: null, confidence: "UNRESOLVED" };
    }
    return {
      ...base,
      resolvedPath: toRel(hit.abs),
      confidence: hit.confidence,
      via: hit.via,
    };
  }

  // tsconfig paths / baseUrl (non-relative)
  const tsconfig = options.tsconfig === undefined ? loadTsconfigPaths(root) : options.tsconfig;
  if (tsconfig) {
    const matched = matchTsconfigPath(specifier, tsconfig);
    if (matched) {
      const abs = path.resolve(root, tsconfig.baseUrl, matched.mapped);
      const rel = path.relative(root, abs);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        return { ...base, resolvedPath: null, confidence: "UNRESOLVED" };
      }
      const hit = resolveFilesystemCandidate(root, abs, existsFn);
      if (hit) {
        return {
          ...base,
          resolvedPath: toRel(hit.abs),
          confidence: "RESOLVED",
          via: `tsconfig-paths:${matched.pattern}`,
        };
      }
      // Pattern matched but file missing — do not invent.
      return { ...base, resolvedPath: null, confidence: "UNRESOLVED", via: "tsconfig-paths-miss" };
    }

    // baseUrl bare specifier (e.g. "utils/foo" with baseUrl=src) — INFERRED only when found.
    if (!specifier.startsWith(".") && !specifier.includes(":")) {
      const abs = path.resolve(root, tsconfig.baseUrl, specifier);
      const rel = path.relative(root, abs);
      if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
        const hit = resolveFilesystemCandidate(root, abs, existsFn);
        if (hit) {
          return {
            ...base,
            resolvedPath: toRel(hit.abs),
            confidence: "INFERRED",
            via: "tsconfig-baseUrl",
          };
        }
      }
    }
  }

  // Package / URL / unknown — unresolved; never invent a repo edge.
  return { ...base, resolvedPath: null, confidence: "UNRESOLVED" };
}

/**
 * Resolve many import edges; filters to those with a concrete resolved path.
 */
export function resolveImportEdges(
  root: string,
  imports: Array<{ fromFile: string; specifier: string }>,
  tsconfig?: TsconfigPathsConfig | null,
): ImportResolutionResult[] {
  const cfg = tsconfig === undefined ? loadTsconfigPaths(root) : tsconfig;
  return imports.map((item) =>
    resolveImportSpecifier({
      root,
      fromFile: item.fromFile,
      specifier: item.specifier,
      tsconfig: cfg,
    }),
  );
}
