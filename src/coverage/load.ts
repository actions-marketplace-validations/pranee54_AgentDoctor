import fs from "node:fs/promises";
import path from "node:path";

import { isCoberturaXml, parseCobertura } from "./cobertura.js";
import { parseIstanbul } from "./istanbul.js";
import { isLcovText, parseLcov } from "./lcov.js";
import type { NormalizedCoverage } from "./types.js";

export type { NormalizedCoverage, CoverageFormat, CoverageFile } from "./types.js";
export { parseLcov } from "./lcov.js";
export { parseIstanbul } from "./istanbul.js";
export { parseCobertura } from "./cobertura.js";

/**
 * Load coverage from a file path, auto-detecting format by extension then content.
 */
export async function loadCoverage(coveragePath: string): Promise<NormalizedCoverage> {
  const abs = path.resolve(coveragePath);
  let text: string;
  try {
    text = await fs.readFile(abs, "utf8");
  } catch (error) {
    throw new Error(
      `Unable to read coverage file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!text.trim()) {
    throw new Error("Coverage file is empty");
  }

  const base = path.basename(abs).toLowerCase();
  const ext = path.extname(abs).toLowerCase();

  if (ext === ".lcov" || base === "lcov.info" || base.endsWith(".info") || isLcovText(text)) {
    if (text.includes("SF:") || isLcovText(text)) return parseLcov(text);
  }
  if (ext === ".xml" || base.includes("cobertura") || isCoberturaXml(text)) {
    return parseCobertura(text);
  }
  if (ext === ".json" || text.trimStart().startsWith("{")) {
    return parseIstanbul(text);
  }
  if (text.includes("end_of_record")) return parseLcov(text);
  return parseIstanbul(text);
}
