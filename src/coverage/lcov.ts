import { normalizeCoveragePath, type CoverageFile, type NormalizedCoverage } from "./types.js";

/**
 * Parse LCOV text into NormalizedCoverage.
 * LCOV records source line/function hits only — no test→source map.
 */
export function parseLcov(text: string): NormalizedCoverage {
  const files: Record<string, CoverageFile> = {};
  let current: CoverageFile | null = null;
  const limitations: string[] = [
    "LCOV provides source line/function hits only — no test→source mapping",
    "Test recommendation with LCOV uses hybrid naming/graph heuristics for test attribution",
  ];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith("SF:")) {
      const p = normalizeCoveragePath(line.slice(3).trim());
      current = { path: p, lines: {}, functions: [] };
      files[p] = current;
    } else if (line.startsWith("DA:") && current) {
      const [ln, hits] = line.slice(3).split(",");
      const n = Number(ln);
      const h = Number(hits);
      if (Number.isFinite(n) && Number.isFinite(h)) current.lines[n] = h;
    } else if (line.startsWith("FN:") && current) {
      const body = line.slice(3);
      const comma = body.indexOf(",");
      if (comma < 0) continue;
      const n = Number(body.slice(0, comma));
      const name = body.slice(comma + 1).trim();
      if (Number.isFinite(n) && name) {
        current.functions.push({ name, line: n, hits: 0 });
      }
    } else if (line.startsWith("FNDA:") && current) {
      const body = line.slice(5);
      const comma = body.indexOf(",");
      if (comma < 0) continue;
      const h = Number(body.slice(0, comma));
      const name = body.slice(comma + 1).trim();
      const fn = current.functions.find((f) => f.name === name);
      if (fn && Number.isFinite(h)) fn.hits = h;
    } else if (line === "end_of_record") {
      current = null;
    }
  }

  return { format: "lcov", files, limitations };
}

export function isLcovText(text: string): boolean {
  const sample = text.slice(0, 4000);
  return (
    /(^|\n)SF:/.test(sample) &&
    (/(^|\n)DA:/.test(sample) || /(^|\n)end_of_record/.test(sample) || /(^|\n)TN:/.test(sample))
  );
}
