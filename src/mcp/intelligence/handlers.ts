import { buildC4Views } from "../../architecture/c4.js";
import { buildIntelligenceGraph } from "../../intelligence/graph/build.js";
import { analyzeGitIntelligence } from "../../intelligence/git/analyze.js";
import { listKnowledge, retrieveAuthoritative } from "../../knowledge/store.js";
import {
  analyzeRenameImpact,
  analyzeTestImpact,
  buildRepositoryGraph,
  evaluateAgentAction,
} from "../../platform/index.js";
import { resolveRepoRoot } from "../../utils/path.js";
import { CONTRACTS_VERSION } from "../../contracts/index.js";
import { assertSafeRepoTarget } from "./path-safety.js";

export async function handleRepoOverview(rootInput: string): Promise<unknown> {
  const root = resolveRepoRoot(rootInput);
  const graph = await buildIntelligenceGraph({ root, mode: "auto" });
  return {
    ok: true,
    contractsVersion: CONTRACTS_VERSION,
    root,
    builder: graph.builder,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    limitations: graph.limitations,
  };
}

export async function handleCodebaseSearch(
  rootInput: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const root = resolveRepoRoot(rootInput);
  const query = String(args.query ?? "")
    .toLowerCase()
    .trim();
  if (!query) {
    return { ok: false, error: { code: "invalid_argument", message: "query required" } };
  }
  const graph = await buildIntelligenceGraph({ root, mode: "auto" });
  const hits = graph.nodes
    .filter(
      (n) =>
        n.label.toLowerCase().includes(query) ||
        n.id.toLowerCase().includes(query) ||
        (n.path ?? "").toLowerCase().includes(query),
    )
    .slice(0, 50);
  return {
    ok: true,
    query,
    hits,
    confidence: graph.builder === "typescript-ast" ? 0.85 : 0.55,
    evidenceKind: graph.builder === "typescript-ast" ? "observed" : "inferred",
    limitations: graph.limitations,
  };
}

export async function handleSymbolLookup(
  rootInput: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const root = resolveRepoRoot(rootInput);
  const name = String(args.name ?? "").trim();
  if (!name) {
    return { ok: false, error: { code: "invalid_argument", message: "name required" } };
  }
  const graph = await buildIntelligenceGraph({ root, mode: "auto" });
  const matches = graph.nodes.filter(
    (n) =>
      (n.kind === "function" || n.kind === "class" || n.kind === "module") &&
      (n.label === name || n.label.endsWith(`.${name}`)),
  );
  return {
    ok: true,
    name,
    matches,
    confidence: matches.length > 0 ? 0.8 : 0.2,
    limitations: ["Import/call resolution is best-effort; unsupported languages omitted."],
  };
}

export async function handleDependencyLookup(
  rootInput: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const root = resolveRepoRoot(rootInput);
  const target = String(args.target ?? "").trim();
  if (!target) {
    return { ok: false, error: { code: "invalid_argument", message: "target required" } };
  }
  let safeRelative: string | null = null;
  try {
    safeRelative = assertSafeRepoTarget(root, target);
  } catch {
    return {
      ok: false,
      error: { code: "path_escape", message: "path escapes repository root" },
    };
  }
  const graph = await buildIntelligenceGraph({ root, mode: "auto" });
  const lookupKeys = [target, safeRelative].filter((v): v is string => Boolean(v));
  const node = graph.nodes.find(
    (n) =>
      lookupKeys.includes(n.id) ||
      (n.path !== undefined && lookupKeys.includes(n.path)) ||
      lookupKeys.includes(n.label),
  );
  if (!node) {
    return { ok: true, target, edges: [], limitations: ["Target not found in graph"] };
  }
  const edges = graph.edges.filter((e) => e.from === node.id || e.to === node.id);
  return { ok: true, target: node, edges, confidence: 0.75 };
}

export async function handleCallGraphLookup(
  rootInput: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const root = resolveRepoRoot(rootInput);
  const symbol = String(args.symbol ?? "").trim();
  if (!symbol) {
    return { ok: false, error: { code: "invalid_argument", message: "symbol required" } };
  }
  const graph = await buildIntelligenceGraph({ root, mode: "auto" });
  const calls = graph.edges.filter(
    (e) => e.kind === "calls" && (e.from.includes(symbol) || e.to.includes(symbol)),
  );
  return {
    ok: true,
    symbol,
    calls,
    confidence: graph.builder === "typescript-ast" ? 0.7 : 0.4,
    limitations: ["Call edges may be incomplete for dynamic/dispatch patterns."],
  };
}

export async function handleTestImpactTool(rootInput: string): Promise<unknown> {
  const root = resolveRepoRoot(rootInput);
  const impact = await analyzeTestImpact(root);
  return {
    ok: true,
    impact,
    resultKind: impact.gitAvailable ? "graph-inferred" : "unknown",
    limitations: ["Coverage-backed mapping requires external coverage data (not bundled)."],
  };
}

export async function handleRefactorImpactTool(
  rootInput: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const root = resolveRepoRoot(rootInput);
  const symbol = String(args.symbol ?? "").trim();
  if (!symbol) {
    return { ok: false, error: { code: "invalid_argument", message: "symbol required" } };
  }
  const graph = await buildRepositoryGraph(root);
  const impact = await analyzeRenameImpact({ root, symbol, graph });
  return { ok: true, impact };
}

export async function handleCodeHealthTool(rootInput: string): Promise<unknown> {
  const root = resolveRepoRoot(rootInput);
  const report = await analyzeGitIntelligence(root);
  return {
    ok: true,
    report,
    methodDisclosure: report.hotspots[0]?.method ?? "see per-metric method fields",
    limitations: report.limitations,
  };
}

export async function handleArchitectureTool(rootInput: string): Promise<unknown> {
  const root = resolveRepoRoot(rootInput);
  const graph = await buildIntelligenceGraph({ root, mode: "auto" });
  const views = buildC4Views(graph);
  return {
    ok: true,
    views,
    label: "Inferred/proposed from graph evidence — not approved architecture facts",
  };
}

export async function handleKnowledgeTool(
  rootInput: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const root = resolveRepoRoot(rootInput);
  const list = await listKnowledge(root);
  const query = String(args.query ?? "").trim();
  if (!query) {
    return { ok: true, records: list.filter((r) => r.status === "approved").slice(0, 50) };
  }
  const result = retrieveAuthoritative(list, query);
  return { ok: true, ...result };
}

export async function handlePolicyEvalTool(
  rootInput: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const root = resolveRepoRoot(rootInput);
  const command = String(args.command ?? "").trim();
  if (!command) {
    return { ok: false, error: { code: "invalid_argument", message: "command required" } };
  }
  const verdict = await evaluateAgentAction(root, {
    actionId: `mcp_${Date.now()}`,
    agentId: "agentdoctor-mcp",
    timestamp: new Date().toISOString(),
    type: "shell",
    params: { command },
    repositoryRoot: root,
  });
  return {
    ok: true,
    verdict,
    executionResult: "not-executed",
    notice: "Evaluate-only: AgentDoctor MCP does not execute shell commands.",
  };
}
