import { normalizeCoveragePath, type CoverageFile, type NormalizedCoverage } from "./types.js";

interface IstanbulStatementMap {
  [id: string]: { start?: { line?: number }; end?: { line?: number } };
}

interface IstanbulFnMap {
  [id: string]: {
    name?: string;
    decl?: { start?: { line?: number } };
    line?: number;
  };
}

interface IstanbulFileRecord {
  path?: string;
  statementMap?: IstanbulStatementMap;
  s?: Record<string, number>;
  fnMap?: IstanbulFnMap;
  f?: Record<string, number>;
  meta?: { tests?: string[]; coveredByTests?: string[] };
  coveredByTests?: string[];
  tests?: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function looksLikeFileRecord(value: unknown): value is IstanbulFileRecord {
  const rec = asRecord(value);
  if (!rec) return false;
  return (
    "statementMap" in rec ||
    "s" in rec ||
    "fnMap" in rec ||
    "f" in rec ||
    typeof rec.path === "string"
  );
}

function extractTests(rec: IstanbulFileRecord): string[] {
  const fromMeta = rec.meta?.tests ?? rec.meta?.coveredByTests ?? [];
  const direct = rec.coveredByTests ?? rec.tests ?? [];
  return [...new Set([...fromMeta, ...direct].map(normalizeCoveragePath).filter(Boolean))].sort();
}

function collectTestMap(root: Record<string, unknown>): Record<string, string[]> | undefined {
  const raw = root.testMap ?? root.tests;
  const map = asRecord(raw);
  if (!map) return undefined;
  const out: Record<string, string[]> = {};
  for (const [testPath, sources] of Object.entries(map)) {
    if (!Array.isArray(sources)) continue;
    const files = sources
      .filter((s): s is string => typeof s === "string")
      .map(normalizeCoveragePath);
    if (files.length) out[normalizeCoveragePath(testPath)] = [...new Set(files)].sort();
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Istanbul / nyc / vitest coverage JSON (coverage-final.json style).
 * Accepts a JSON string or already-parsed object.
 * Supports optional testMap / coveredByTests when present.
 */
export function parseIstanbul(input: string | object): NormalizedCoverage {
  let root: Record<string, unknown>;
  if (typeof input === "string") {
    try {
      root = JSON.parse(input) as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        `Invalid Istanbul JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else if (input && typeof input === "object" && !Array.isArray(input)) {
    root = input as Record<string, unknown>;
  } else {
    throw new Error("Invalid Istanbul JSON: expected object or JSON string");
  }

  const candidate =
    asRecord(root.coverageMap) ?? asRecord(root.result) ?? asRecord(root.coverage) ?? root;

  const files: Record<string, CoverageFile> = {};
  const limitations: string[] = [
    "Istanbul statement/branch maps vary by version; line hits taken from s/statementMap when present",
  ];

  for (const [key, value] of Object.entries(candidate)) {
    if (key === "testMap" || key === "tests" || key === "meta") continue;
    if (!looksLikeFileRecord(value)) continue;
    const pathKey = normalizeCoveragePath(
      typeof value.path === "string" ? value.path : key.replace(/^.*:/, ""),
    );
    if (!pathKey) continue;

    const prev = files[pathKey];
    const file: CoverageFile = {
      path: pathKey,
      lines: { ...(prev?.lines ?? {}) },
      functions: [...(prev?.functions ?? [])],
      ...(prev?.coveredByTests ? { coveredByTests: [...prev.coveredByTests] } : {}),
    };

    const statementMap = value.statementMap ?? {};
    const statements = value.s ?? {};
    for (const [id, hits] of Object.entries(statements)) {
      const loc = statementMap[id];
      const line = loc?.start?.line ?? loc?.end?.line;
      if (typeof line !== "number" || !Number.isFinite(hits)) continue;
      file.lines[line] = Math.max(file.lines[line] ?? 0, Number(hits));
    }

    const fnMap = value.fnMap ?? {};
    const fnHits = value.f ?? {};
    for (const [id, hits] of Object.entries(fnHits)) {
      const meta = fnMap[id];
      const name = meta?.name || `fn_${id}`;
      const line = meta?.decl?.start?.line ?? meta?.line ?? 0;
      const existing = file.functions.find((f) => f.name === name);
      if (existing) {
        existing.hits = Math.max(existing.hits, Number(hits) || 0);
        if (!existing.line && line) existing.line = line;
      } else {
        file.functions.push({ name, line, hits: Number(hits) || 0 });
      }
    }

    const tests = extractTests(value);
    if (tests.length) {
      file.coveredByTests = [...new Set([...(file.coveredByTests ?? []), ...tests])].sort();
    }

    files[pathKey] = file;
  }

  let testToFiles = collectTestMap(root) ?? collectTestMap(candidate);
  for (const [source, cov] of Object.entries(files)) {
    for (const test of cov.coveredByTests ?? []) {
      testToFiles ??= {};
      const list = testToFiles[test] ?? [];
      if (!list.includes(source)) list.push(source);
      testToFiles[test] = list.sort();
    }
  }

  if (!testToFiles) {
    limitations.push(
      "Istanbul JSON had no test→source map — test attribution falls back to heuristics",
    );
  } else {
    limitations.push("Istanbul test→source map used where present");
  }

  return {
    format: "istanbul",
    files,
    ...(testToFiles ? { testToFiles } : {}),
    limitations,
  };
}
