import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import ts from "typescript";

import { resolveRepoRoot, toPosixRelative } from "../../utils/path.js";
import type { GraphEdge, GraphNode, RepositoryGraph } from "../../platform/types.js";
import { buildRepositoryGraph } from "../../platform/graph/build.js";
import { CONTRACTS_VERSION } from "../../contracts/index.js";

export type GraphBuilderMode = "regex" | "typescript-ast" | "auto";

function nodeId(kind: string, key: string): string {
  return `${kind}:${createHash("sha1").update(key).digest("hex").slice(0, 12)}`;
}

async function listTsFiles(root: string, limit = 400): Promise<string[]> {
  const out: string[] = [];
  const skip = new Set(["node_modules", ".git", "dist", "coverage", ".agentdoctor", "vendor"]);
  async function walk(dir: string): Promise<void> {
    if (out.length >= limit) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (/\.(ts|tsx|mts|cts)$/i.test(e.name) && !e.name.endsWith(".d.ts")) {
        out.push(abs);
      }
    }
  }
  await walk(root);
  return out.sort();
}

/**
 * TypeScript compiler API based graph enrichment.
 * Falls back to regex graph when mode=regex or on failure.
 */
export async function buildIntelligenceGraph(options: {
  root: string;
  mode?: GraphBuilderMode;
}): Promise<RepositoryGraph & { builder: GraphBuilderMode; astFilesParsed: number }> {
  const root = resolveRepoRoot(options.root);
  const mode = options.mode ?? "auto";
  if (mode === "regex") {
    const g = await buildRepositoryGraph(root);
    return { ...g, builder: "regex", astFilesParsed: 0 };
  }

  try {
    const files = await listTsFiles(root);
    if (files.length === 0) {
      const g = await buildRepositoryGraph(root);
      return {
        ...g,
        builder: "regex",
        astFilesParsed: 0,
        limitations: [
          ...g.limitations,
          "No TypeScript sources found for AST builder; used regex fallback",
        ],
      };
    }

    const program = ts.createProgram({
      rootNames: files,
      options: {
        allowJs: false,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        skipLibCheck: true,
        noEmit: true,
      },
    });

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const seen = new Set<string>();

    const pushNode = (n: GraphNode) => {
      if (seen.has(n.id)) return;
      seen.add(n.id);
      nodes.push(n);
    };

    for (const sf of program.getSourceFiles()) {
      if (sf.isDeclarationFile) continue;
      if (!files.includes(sf.fileName)) continue;
      const rel = toPosixRelative(root, sf.fileName);
      const fileId = nodeId("file", rel);
      pushNode({ id: fileId, kind: "file", label: path.basename(rel), path: rel });

      const visit = (node: ts.Node) => {
        if (ts.isFunctionDeclaration(node) && node.name) {
          const name = node.name.text;
          pushNode({
            id: nodeId("function", `${rel}:${name}`),
            kind: "function",
            label: name,
            path: rel,
            meta: { parser: "typescript-ast", analysisVersion: CONTRACTS_VERSION },
          });
        }
        if (ts.isClassDeclaration(node) && node.name) {
          const name = node.name.text;
          const classId = nodeId("class", `${rel}:${name}`);
          pushNode({
            id: classId,
            kind: "class",
            label: name,
            path: rel,
            meta: { parser: "typescript-ast" },
          });
          if (node.heritageClauses) {
            for (const h of node.heritageClauses) {
              for (const t of h.types) {
                const label = t.expression.getText(sf);
                const toId = nodeId("dependency", `${rel}->${label}`);
                pushNode({ id: toId, kind: "dependency", label, path: rel });
                edges.push({
                  id: nodeId("edge", `${classId}->${toId}:${h.token}`),
                  from: classId,
                  to: toId,
                  kind: h.token === ts.SyntaxKind.ExtendsKeyword ? "extends" : "implements",
                  evidence: "verified",
                });
              }
            }
          }
        }
        if (ts.isInterfaceDeclaration(node) && node.name) {
          pushNode({
            id: nodeId("interface", `${rel}:${node.name.text}`),
            kind: "module",
            label: node.name.text,
            path: rel,
            meta: { symbolKind: "interface", parser: "typescript-ast" },
          });
        }
        if (
          ts.isImportDeclaration(node) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          const spec = node.moduleSpecifier.text;
          const toId = nodeId("dependency", `${rel}->${spec}`);
          pushNode({
            id: toId,
            kind: "dependency",
            label: spec,
            path: rel,
            meta: { specifier: spec, parser: "typescript-ast" },
          });
          edges.push({
            id: nodeId("edge", `${fileId}->${toId}`),
            from: fileId,
            to: toId,
            kind: "imports",
            evidence: spec.startsWith(".") ? "verified" : "inferred",
          });
        }
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text.length > 1
        ) {
          const callee = node.expression.text;
          const toId = nodeId("function", `call:${rel}:${callee}`);
          pushNode({
            id: toId,
            kind: "function",
            label: callee,
            path: rel,
            meta: { callSite: true, parser: "typescript-ast" },
          });
          edges.push({
            id: nodeId("edge", `${fileId}->call:${callee}:${node.getStart(sf)}`),
            from: fileId,
            to: toId,
            kind: "calls",
            evidence: "inferred",
          });
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }

    nodes.sort((a, b) => a.id.localeCompare(b.id));
    edges.sort((a, b) => a.id.localeCompare(b.id));

    return {
      root,
      generatedAt: new Date().toISOString(),
      nodes,
      edges,
      builder: "typescript-ast",
      astFilesParsed: files.length,
      limitations: [
        "TypeScript AST builder uses the TypeScript compiler API for .ts/.tsx only",
        "Cross-file call resolution is identifier-based (not full type-checker binding)",
        "Non-TypeScript languages fall back to regex graph when requested via auto+empty TS set",
        `analysisVersion=${CONTRACTS_VERSION}`,
      ],
    };
  } catch (error) {
    const g = await buildRepositoryGraph(root);
    return {
      ...g,
      builder: "regex",
      astFilesParsed: 0,
      limitations: [
        ...g.limitations,
        `TypeScript AST builder failed; regex fallback used (${error instanceof Error ? error.message : String(error)})`,
      ],
    };
  }
}
