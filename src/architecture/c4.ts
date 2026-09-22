import type { RepositoryGraph } from "../platform/types.js";

export interface C4View {
  level: "system-context" | "container" | "component" | "code";
  title: string;
  nodes: Array<{ id: string; label: string; kind: string }>;
  edges: Array<{ from: string; to: string; kind: string }>;
  evidenceKind: "observed" | "inferred" | "proposed";
  limitations: string[];
}

/**
 * C4-style views derived from repository graph evidence.
 * Always labels inferred vs observed.
 */
export function buildC4Views(graph: RepositoryGraph): C4View[] {
  const files = graph.nodes.filter((n) => n.kind === "file" || n.kind === "test");
  const deps = graph.edges.filter((e) => e.kind === "imports" || e.kind === "depends_on");
  const containers = [
    { id: "c_app", label: "Application", kind: "container" },
    { id: "c_tests", label: "Tests", kind: "container" },
    { id: "c_docs", label: "Docs", kind: "container" },
  ];

  const system: C4View = {
    level: "system-context",
    title: "System context (inferred)",
    nodes: [
      { id: "sys", label: graph.root.split("/").pop() ?? "system", kind: "system" },
      { id: "dev", label: "Developer / Agent", kind: "person" },
    ],
    edges: [{ from: "dev", to: "sys", kind: "uses" }],
    evidenceKind: "inferred",
    limitations: ["System context is scaffolding from repository root name only"],
  };

  const container: C4View = {
    level: "container",
    title: "Containers (inferred from paths)",
    nodes: containers,
    edges: [
      { from: "c_app", to: "c_tests", kind: "tested_by" },
      { from: "c_docs", to: "c_app", kind: "documents" },
    ],
    evidenceKind: "inferred",
    limitations: ["Container boundaries inferred from folder conventions, not runtime topology"],
  };

  const component: C4View = {
    level: "component",
    title: "Components (from graph files)",
    nodes: files.slice(0, 40).map((n) => ({
      id: n.id,
      label: n.label,
      kind: n.kind,
    })),
    edges: deps.slice(0, 80).map((e) => ({ from: e.from, to: e.to, kind: e.kind })),
    evidenceKind: deps.some((e) => e.evidence === "verified") ? "observed" : "inferred",
    limitations: ["Component view capped; not a full deployment diagram"],
  };

  const code: C4View = {
    level: "code",
    title: "Code-level symbols",
    nodes: graph.nodes
      .filter((n) => n.kind === "function" || n.kind === "class")
      .slice(0, 60)
      .map((n) => ({ id: n.id, label: n.label, kind: n.kind })),
    edges: graph.edges
      .filter((e) => e.kind === "calls" || e.kind === "extends" || e.kind === "implements")
      .slice(0, 80)
      .map((e) => ({ from: e.from, to: e.to, kind: e.kind })),
    evidenceKind: "observed",
    limitations: ["Code view depends on active graph builder (AST or regex)"],
  };

  return [system, container, component, code];
}
