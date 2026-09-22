import fs from "node:fs/promises";
import path from "node:path";

import { resolveRepoRoot } from "../../utils/path.js";
import type { RepositoryGraph } from "../types.js";

export interface RefactorImpact {
  root: string;
  symbol: string;
  affectedFiles: string[];
  dependencyPaths: string[];
  risk: "low" | "medium" | "high";
  requiredTests: string[];
  breakingChangeRisk: string;
  limitations: string[];
}

/**
 * Module K — Graph-aware refactoring analysis (rename impact MVP).
 * Does not apply refactors.
 */
export async function analyzeRenameImpact(options: {
  root: string;
  symbol: string;
  graph: RepositoryGraph;
}): Promise<RefactorImpact> {
  const root = resolveRepoRoot(options.root);
  const symbol = options.symbol.trim();
  const affected: string[] = [];
  const depPaths: string[] = [];

  for (const node of options.graph.nodes) {
    if ((node.kind === "function" || node.kind === "class") && node.label === symbol && node.path) {
      affected.push(node.path);
    }
  }

  for (const node of options.graph.nodes.filter((n) => n.kind === "file" && n.path)) {
    const rel = node.path!;
    if (!/\.(ts|tsx|js|jsx)$/i.test(rel)) continue;
    try {
      const text = await fs.readFile(path.join(root, rel), "utf8");
      if (new RegExp(`\\b${escapeReg(symbol)}\\b`).test(text)) {
        if (!affected.includes(rel)) affected.push(rel);
      }
    } catch {
      // skip
    }
  }

  for (const edge of options.graph.edges) {
    const from = options.graph.nodes.find((n) => n.id === edge.from);
    const to = options.graph.nodes.find((n) => n.id === edge.to);
    if (from?.path && affected.includes(from.path)) {
      depPaths.push(`${from.path} -> ${to?.label ?? edge.to}`);
    }
  }

  const requiredTests = affected.map((f) => f.replace(/(\.\w+)$/, ".test$1"));
  const risk = affected.length > 10 ? "high" : affected.length > 3 ? "medium" : "low";

  return {
    root,
    symbol,
    affectedFiles: affected.sort(),
    dependencyPaths: depPaths.slice(0, 50),
    risk,
    requiredTests: [...new Set(requiredTests)].sort(),
    breakingChangeRisk:
      risk === "high"
        ? "Likely public surface impact — require review and tests"
        : "Localized rename likely; still verify exports",
    limitations: [
      "Does not apply edits",
      "Text search may include false positives for common names",
    ],
  };
}

function escapeReg(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
