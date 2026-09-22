import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { resolveRepoRoot } from "../../utils/path.js";
import type { PlatformFinding } from "../types.js";
import type { RepositoryGraph } from "../types.js";

function fid(module: string, key: string): string {
  return `health_${createHash("sha1").update(`${module}:${key}`).digest("hex").slice(0, 12)}`;
}

/**
 * Module B — Code health & risk (deterministic heuristics with evidence).
 */
export async function analyzeCodeHealth(
  rootInput: string,
  graph: RepositoryGraph,
): Promise<PlatformFinding[]> {
  const root = resolveRepoRoot(rootInput);
  const findings: PlatformFinding[] = [];

  const fileNodes = graph.nodes.filter((n) => n.kind === "file" || n.kind === "test");
  for (const node of fileNodes.slice(0, 800)) {
    if (!node.path) continue;
    const absolute = path.join(root, node.path);
    let content: string;
    let size: number;
    try {
      const st = await fs.stat(absolute);
      size = st.size;
      if (size > 512 * 1024) {
        findings.push({
          id: fid("filesize", node.path),
          module: "code-health",
          severity: "medium",
          title: "Large source file",
          message: `${node.path} is ${size} bytes`,
          recommendation: "Split into smaller modules to reduce change risk",
          confidence: 0.9,
          evidence: [{ kind: "verified", path: node.path, detail: `sizeBytes=${size}` }],
        });
        continue;
      }
      if (!/\.(ts|tsx|js|jsx|py|go)$/i.test(node.path)) continue;
      content = await fs.readFile(absolute, "utf8");
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    if (lines.length > 500) {
      findings.push({
        id: fid("loc", node.path),
        module: "code-health",
        severity: "medium",
        title: "High line count",
        message: `${node.path} has ${lines.length} lines`,
        recommendation: "Consider modularization",
        confidence: 0.85,
        evidence: [{ kind: "verified", path: node.path, detail: `lines=${lines.length}` }],
      });
    }

    let depth = 0;
    let maxDepth = 0;
    for (const line of lines) {
      for (const ch of line) {
        if (ch === "{" || ch === "(") depth += 1;
        if (ch === "}" || ch === ")") depth = Math.max(0, depth - 1);
        maxDepth = Math.max(maxDepth, depth);
      }
    }
    if (maxDepth >= 8) {
      findings.push({
        id: fid("complexity", node.path),
        module: "code-health",
        severity: "high",
        title: "High nesting / complexity heuristic",
        message: `${node.path} nesting depth heuristic=${maxDepth}`,
        recommendation: "Reduce nesting; extract helpers",
        confidence: 0.55,
        evidence: [
          {
            kind: "inferred",
            path: node.path,
            detail: `maxNesting=${maxDepth} (brace/paren heuristic, not full cyclomatic)`,
          },
        ],
        falsePositiveWarning: "Nesting depth is a proxy; verify with a language-aware analyzer",
      });
    }

    if (/catch\s*\([^)]*\)\s*\{\s*\}/m.test(content) || /catch\s*\{\s*\}/m.test(content)) {
      findings.push({
        id: fid("empty-catch", node.path),
        module: "code-health",
        severity: "medium",
        title: "Empty catch block",
        message: `${node.path} contains an empty catch`,
        recommendation: "Log or handle errors explicitly",
        confidence: 0.7,
        evidence: [{ kind: "inferred", path: node.path, detail: "empty catch pattern" }],
      });
    }
  }

  // Circular import heuristic among relative edges (file→file via resolved relative specs)
  const fileByPath = new Map(
    graph.nodes
      .filter((n) => n.path && (n.kind === "file" || n.kind === "test"))
      .map((n) => [n.path!, n.id]),
  );
  const adj = new Map<string, Set<string>>();
  for (const edge of graph.edges.filter((e) => e.kind === "imports" && e.evidence === "verified")) {
    const from = edge.from;
    const toNode = graph.nodes.find((n) => n.id === edge.to);
    const spec =
      typeof toNode?.meta?.specifier === "string" ? toNode.meta.specifier : toNode?.label;
    if (!spec || typeof spec !== "string" || !spec.startsWith(".")) continue;
    const fromPath = graph.nodes.find((n) => n.id === from)?.path;
    if (!fromPath) continue;
    const resolvedRel = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), spec));
    const candidates = [
      resolvedRel,
      `${resolvedRel}.ts`,
      `${resolvedRel}.js`,
      `${resolvedRel}/index.ts`,
    ];
    for (const cand of candidates) {
      const toId = fileByPath.get(cand);
      if (toId) {
        if (!adj.has(from)) adj.set(from, new Set());
        adj.get(from)!.add(toId);
        break;
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const reportCycle = (stack: string[]) => {
    const paths = stack
      .map((id) => graph.nodes.find((n) => n.id === id)?.path)
      .filter(Boolean)
      .join(" -> ");
    findings.push({
      id: fid("cycle", stack.join("|")),
      module: "code-health",
      severity: "high",
      title: "Possible circular import",
      message: paths || stack.join(" -> "),
      recommendation: "Break the cycle with inversion of control or a shared module",
      confidence: 0.5,
      evidence: [{ kind: "inferred", detail: `cycleLen=${stack.length}` }],
      falsePositiveWarning:
        "Relative import resolution is heuristic; confirm with a bundler/graph tool",
    });
  };
  const dfs = (node: string, stack: string[]) => {
    if (visiting.has(node)) {
      const idx = stack.indexOf(node);
      if (idx >= 0) reportCycle(stack.slice(idx));
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    stack.push(node);
    for (const next of adj.get(node) ?? []) dfs(next, stack);
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of adj.keys()) dfs(node, []);

  findings.sort((a, b) => a.id.localeCompare(b.id));
  return findings;
}

export function scoreFileRisk(findings: PlatformFinding[], filePath: string): number {
  const related = findings.filter((f) => f.evidence.some((e) => e.path === filePath));
  let score = 0;
  for (const f of related) {
    if (f.severity === "critical") score += 40;
    else if (f.severity === "high") score += 25;
    else if (f.severity === "medium") score += 12;
    else score += 4;
  }
  return Math.min(100, score);
}
