import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { resolveRepoRoot, isPathInsideRoot } from "../../utils/path.js";
import type { RepositoryGraph } from "../types.js";

export interface ContextPlan {
  root: string;
  budgetTokens: number;
  estimatedTokens: number;
  selected: Array<{ path: string; tokens: number; relevance: number; reason: string }>;
  excluded: Array<{ path: string; reason: string }>;
  recommendations: string[];
  limitations: string[];
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const SECRETISH = /\.env|id_rsa|credentials|secrets\//i;

/**
 * Module L — Token / context optimization.
 * Never includes secret-like paths.
 */
export async function planContext(options: {
  root: string;
  graph: RepositoryGraph;
  query: string;
  budgetTokens?: number;
}): Promise<ContextPlan> {
  const root = resolveRepoRoot(options.root);
  const budget = options.budgetTokens ?? 8_000;
  const q = options.query.toLowerCase();
  const selected: ContextPlan["selected"] = [];
  const excluded: ContextPlan["excluded"] = [];
  let used = 0;

  const candidates = options.graph.nodes
    .filter((n) => (n.kind === "file" || n.kind === "doc" || n.kind === "config") && n.path)
    .map((n) => n.path!)
    .sort();

  for (const rel of candidates) {
    if (rel.includes("\0") || path.isAbsolute(rel) || rel.split(/[/\\]/).includes("..")) {
      excluded.push({ path: rel, reason: "Unsafe path rejected" });
      continue;
    }
    if (SECRETISH.test(rel)) {
      excluded.push({ path: rel, reason: "Secret-like path excluded" });
      continue;
    }
    const relevance =
      (rel.toLowerCase().includes(q) ? 0.6 : 0) +
      (/\.(ts|tsx|md)$/i.test(rel) ? 0.2 : 0.05) +
      (rel.startsWith("src/") ? 0.15 : 0);
    if (relevance < 0.25) {
      excluded.push({ path: rel, reason: "Low relevance to query" });
      continue;
    }
    try {
      const absolute = path.resolve(root, rel);
      if (!isPathInsideRoot(root, absolute)) {
        excluded.push({ path: rel, reason: "Path escapes repository root" });
        continue;
      }
      // Open first (O_NOFOLLOW rejects symlinks), then fstat+read from the same fd — no TOCTOU.
      const openFlags =
        typeof fsConstants.O_NOFOLLOW === "number"
          ? fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
          : fsConstants.O_RDONLY;
      let handle;
      try {
        handle = await fs.open(absolute, openFlags);
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String((error as { code: unknown }).code)
            : "";
        if (code === "ELOOP") {
          excluded.push({ path: rel, reason: "Symlink excluded" });
          continue;
        }
        throw error;
      }
      try {
        const st = await handle.stat();
        if (st.size > 100_000) {
          excluded.push({ path: rel, reason: "File too large for context budget" });
          continue;
        }
        const text = await handle.readFile("utf8");
        const tokens = estimateTokens(text);
        if (used + tokens > budget) {
          excluded.push({ path: rel, reason: "Would exceed token budget" });
          continue;
        }
        selected.push({
          path: rel,
          tokens,
          relevance,
          reason: relevance >= 0.6 ? "Path matches query" : "Likely relevant source/doc",
        });
        used += tokens;
      } finally {
        await handle.close();
      }
    } catch {
      excluded.push({ path: rel, reason: "Unreadable" });
    }
  }

  selected.sort((a, b) => b.relevance - a.relevance || a.path.localeCompare(b.path));

  return {
    root,
    budgetTokens: budget,
    estimatedTokens: used,
    selected,
    excluded: excluded.slice(0, 200),
    recommendations: [
      used > budget * 0.9 ? "Increase budget or narrow query" : "Budget headroom available",
      "Prefer Project Brain claims over dumping entire directories",
    ],
    limitations: [
      "Token estimate is chars/4 heuristic",
      "Relevance is lexical, not embedding-based",
    ],
  };
}
