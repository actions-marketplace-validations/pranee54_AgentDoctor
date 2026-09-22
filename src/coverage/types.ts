export type CoverageFormat = "lcov" | "istanbul" | "cobertura";

export interface CoverageFunction {
  name: string;
  line: number;
  hits: number;
}

export interface CoverageFile {
  path: string;
  lines: Record<number, number>;
  functions: CoverageFunction[];
  /** Optional test files known to cover this source (when format provides it). */
  coveredByTests?: string[];
}

export interface NormalizedCoverage {
  format: CoverageFormat;
  files: Record<string, CoverageFile>;
  /** Optional reverse map test → source files when available. */
  testToFiles?: Record<string, string[]>;
  limitations: string[];
}

export function normalizeCoveragePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** @deprecated use normalizeCoveragePath */
export const normalizePath = normalizeCoveragePath;
