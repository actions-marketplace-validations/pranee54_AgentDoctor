import fs from "node:fs/promises";
import path from "node:path";

import type { RepositoryGraph } from "../platform/types.js";
import { resolveRepoRoot } from "../utils/path.js";
import { atomicWriteTextFile } from "../utils/fs.js";

export interface ArchitectureLayer {
  id: string;
  paths: string[];
}

export interface ForbiddenDependency {
  fromLayer: string;
  toLayer: string;
  id: string;
  description: string;
}

export interface AllowedDependency {
  fromLayer: string;
  toLayer: string;
}

export interface ArchitectureContract {
  version: "1";
  layers: ArchitectureLayer[];
  forbidden: ForbiddenDependency[];
  allowed: AllowedDependency[];
}

export interface ArchitectureViolation {
  ruleId: string;
  kind: "forbidden" | "not-allowed";
  description: string;
  fromPath: string;
  toPath: string;
  fromLayer: string;
  toLayer: string;
  evidence: {
    edgeId: string;
    edgeKind: string;
    evidenceKind: string;
  };
}

export interface ArchitectureCheckResult {
  root: string;
  contractPath: string | null;
  contract: ArchitectureContract | null;
  violations: ArchitectureViolation[];
  importEdgesChecked: number;
  limitations: string[];
}

const CONTRACT_JSON = ".agentdoctor/architecture.json";
const CONTRACT_YML = ".agentdoctor/architecture.yml";

export const DEFAULT_ARCHITECTURE_CONTRACT: ArchitectureContract = {
  version: "1",
  layers: [
    { id: "cli", paths: ["src/cli/"] },
    { id: "platform", paths: ["src/platform/"] },
    { id: "core", paths: ["src/core/"] },
    { id: "tests", paths: ["tests/"] },
  ],
  forbidden: [
    {
      id: "core-must-not-import-cli",
      fromLayer: "core",
      toLayer: "cli",
      description: "Core must not depend on CLI surfaces",
    },
    {
      id: "src-must-not-import-tests",
      fromLayer: "core",
      toLayer: "tests",
      description: "Production core must not import test files",
    },
    {
      id: "platform-must-not-import-tests",
      fromLayer: "platform",
      toLayer: "tests",
      description: "Platform must not import test files",
    },
  ],
  allowed: [
    { fromLayer: "cli", toLayer: "platform" },
    { fromLayer: "cli", toLayer: "core" },
    { fromLayer: "platform", toLayer: "core" },
    { fromLayer: "tests", toLayer: "core" },
    { fromLayer: "tests", toLayer: "platform" },
    { fromLayer: "tests", toLayer: "cli" },
  ],
};

function normalizeRel(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function layerForPath(filePath: string, layers: ArchitectureLayer[]): string | null {
  const rel = normalizeRel(filePath);
  let best: { id: string; len: number } | null = null;
  for (const layer of layers) {
    for (const prefix of layer.paths) {
      const p = normalizeRel(prefix);
      if (
        rel === p.replace(/\/$/, "") ||
        rel.startsWith(p) ||
        rel.startsWith(p.replace(/\/$/, "") + "/")
      ) {
        if (!best || p.length > best.len) best = { id: layer.id, len: p.length };
      }
    }
  }
  return best?.id ?? null;
}

/**
 * Minimal YAML subset parser for architecture contracts.
 * Also accepts JSON content inside .yml files.
 */
export function parseArchitectureYamlSubset(text: string): ArchitectureContract {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    return parseArchitectureJson(trimmed);
  }

  // Line-oriented subset: version, layers/forbidden/allowed with indented keys
  const lines = text.split(/\r?\n/);
  let version = "1";
  const layers: ArchitectureLayer[] = [];
  const forbidden: ForbiddenDependency[] = [];
  const allowed: AllowedDependency[] = [];

  type Section = "none" | "layers" | "forbidden" | "allowed";
  let section: Section = "none";
  let current: Record<string, unknown> | null = null;

  const pushCurrent = () => {
    if (!current) return;
    if (section === "layers" && typeof current.id === "string") {
      const paths = Array.isArray(current.paths)
        ? current.paths.filter((p): p is string => typeof p === "string")
        : [];
      layers.push({ id: current.id, paths });
    } else if (section === "forbidden" && typeof current.id === "string") {
      forbidden.push({
        id: current.id,
        fromLayer: String(current.fromLayer ?? ""),
        toLayer: String(current.toLayer ?? ""),
        description: String(current.description ?? ""),
      });
    } else if (section === "allowed") {
      allowed.push({
        fromLayer: String(current.fromLayer ?? ""),
        toLayer: String(current.toLayer ?? ""),
      });
    }
    current = null;
  };

  for (const raw of lines) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const indent = raw.match(/^ */)?.[0].length ?? 0;
    const line = raw.trim();

    if (indent === 0 && line.startsWith("version:")) {
      pushCurrent();
      version = unquote(line.slice("version:".length).trim()) || "1";
      section = "none";
      continue;
    }
    if (indent === 0 && line === "layers:") {
      pushCurrent();
      section = "layers";
      continue;
    }
    if (indent === 0 && line === "forbidden:") {
      pushCurrent();
      section = "forbidden";
      continue;
    }
    if (indent === 0 && line === "allowed:") {
      pushCurrent();
      section = "allowed";
      continue;
    }

    if (section !== "none" && line.startsWith("- ")) {
      pushCurrent();
      current = {};
      const rest = line.slice(2).trim();
      if (rest.includes(":")) {
        const [k, ...restParts] = rest.split(":");
        current[k!.trim()] = parseYamlValue(restParts.join(":").trim());
      }
      continue;
    }

    if (current && indent >= 2 && line.includes(":")) {
      const [k, ...restParts] = line.split(":");
      const key = k!.trim();
      const val = restParts.join(":").trim();
      if (val === "" || val === "|" || val === ">") {
        // multi-line not supported; ignore
        continue;
      }
      if (key === "paths" && val.startsWith("[")) {
        try {
          current.paths = JSON.parse(val.replace(/'/g, '"'));
        } catch {
          current.paths = val
            .replace(/^\[/, "")
            .replace(/\]$/, "")
            .split(",")
            .map((s) => unquote(s.trim()))
            .filter(Boolean);
        }
      } else {
        current[key] = parseYamlValue(val);
      }
    }
  }
  pushCurrent();

  if (version !== "1") {
    throw new Error(`Unsupported architecture contract version: ${version}`);
  }

  return { version: "1", layers, forbidden, allowed };
}

function parseYamlValue(val: string): unknown {
  if (val.startsWith("[") && val.endsWith("]")) {
    try {
      return JSON.parse(val.replace(/'/g, '"'));
    } catch {
      return val
        .slice(1, -1)
        .split(",")
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
    }
  }
  return unquote(val);
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

export function parseArchitectureJson(text: string): ArchitectureContract {
  const parsed = JSON.parse(text) as ArchitectureContract;
  if (parsed.version !== "1") {
    throw new Error(`Unsupported architecture contract version: ${String(parsed.version)}`);
  }
  if (!Array.isArray(parsed.layers) || !Array.isArray(parsed.forbidden)) {
    throw new Error("Architecture contract requires layers and forbidden arrays");
  }
  return {
    version: "1",
    layers: parsed.layers,
    forbidden: parsed.forbidden,
    allowed: Array.isArray(parsed.allowed) ? parsed.allowed : [],
  };
}

export async function loadArchitectureContract(
  rootInput: string,
): Promise<{ contract: ArchitectureContract; path: string } | null> {
  const root = resolveRepoRoot(rootInput);
  const jsonPath = path.join(root, CONTRACT_JSON);
  const ymlPath = path.join(root, CONTRACT_YML);

  try {
    const text = await fs.readFile(jsonPath, "utf8");
    return { contract: parseArchitectureJson(text), path: jsonPath };
  } catch {
    // try yml
  }

  try {
    const text = await fs.readFile(ymlPath, "utf8");
    return { contract: parseArchitectureYamlSubset(text), path: ymlPath };
  } catch {
    return null;
  }
}

export async function initArchitecture(rootInput: string): Promise<string> {
  const root = resolveRepoRoot(rootInput);
  const out = path.join(root, CONTRACT_JSON);
  await fs.mkdir(path.dirname(out), { recursive: true });
  try {
    await fs.access(out);
    return out; // already exists — do not overwrite
  } catch {
    // create
  }
  await atomicWriteTextFile(out, `${JSON.stringify(DEFAULT_ARCHITECTURE_CONTRACT, null, 2)}\n`);
  return out;
}

function resolveNodePath(graph: RepositoryGraph, nodeId: string): string {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (node?.path) return normalizeRel(node.path);
  if (node?.label) return normalizeRel(node.label);
  return normalizeRel(nodeId.replace(/^file:/, ""));
}

/**
 * Check import edges against the architecture contract.
 * Forbidden rules always apply. When `allowed` is non-empty, cross-layer
 * imports not listed in allowed (and not same-layer) are reported as not-allowed.
 */
export function checkArchitecture(
  rootInput: string,
  graph: RepositoryGraph,
  contract?: ArchitectureContract | null,
  contractPath?: string | null,
): ArchitectureCheckResult {
  const root = resolveRepoRoot(rootInput);
  const limitations: string[] = [
    "Architecture check uses static import edges from the repository graph",
    "Layer assignment is path-prefix based — not runtime topology",
  ];

  if (!contract) {
    return {
      root,
      contractPath: contractPath ?? null,
      contract: null,
      violations: [],
      importEdgesChecked: 0,
      limitations: [
        ...limitations,
        "No architecture contract found — run: agentdoctor architecture init",
      ],
    };
  }

  const violations: ArchitectureViolation[] = [];
  const importEdges = graph.edges.filter((e) => e.kind === "imports" || e.kind === "depends_on");
  const allowSet = new Set(contract.allowed.map((a) => `${a.fromLayer}->${a.toLayer}`));
  const enforceAllowList = contract.allowed.length > 0;

  for (const edge of importEdges) {
    const fromPath = resolveNodePath(graph, edge.from);
    const toPath = resolveNodePath(graph, edge.to);
    const fromLayer = layerForPath(fromPath, contract.layers);
    const toLayer = layerForPath(toPath, contract.layers);
    if (!fromLayer || !toLayer) continue;
    if (fromLayer === toLayer) continue;

    for (const rule of contract.forbidden) {
      if (rule.fromLayer === fromLayer && rule.toLayer === toLayer) {
        violations.push({
          ruleId: rule.id,
          kind: "forbidden",
          description: rule.description,
          fromPath,
          toPath,
          fromLayer,
          toLayer,
          evidence: {
            edgeId: edge.id,
            edgeKind: edge.kind,
            evidenceKind: edge.evidence,
          },
        });
      }
    }

    if (enforceAllowList && !allowSet.has(`${fromLayer}->${toLayer}`)) {
      const alreadyForbidden = violations.some(
        (v) =>
          v.fromPath === fromPath &&
          v.toPath === toPath &&
          v.fromLayer === fromLayer &&
          v.toLayer === toLayer &&
          v.kind === "forbidden",
      );
      if (!alreadyForbidden) {
        violations.push({
          ruleId: `not-allowed:${fromLayer}->${toLayer}`,
          kind: "not-allowed",
          description: `Cross-layer import ${fromLayer} → ${toLayer} is not in the allowed list`,
          fromPath,
          toPath,
          fromLayer,
          toLayer,
          evidence: {
            edgeId: edge.id,
            edgeKind: edge.kind,
            evidenceKind: edge.evidence,
          },
        });
      }
    }
  }

  violations.sort((a, b) =>
    `${a.ruleId}:${a.fromPath}:${a.toPath}`.localeCompare(`${b.ruleId}:${b.fromPath}:${b.toPath}`),
  );

  return {
    root,
    contractPath: contractPath ?? null,
    contract,
    violations,
    importEdgesChecked: importEdges.length,
    limitations,
  };
}

export async function checkArchitectureAtRoot(
  rootInput: string,
  graph: RepositoryGraph,
): Promise<ArchitectureCheckResult> {
  const loaded = await loadArchitectureContract(rootInput);
  return checkArchitecture(rootInput, graph, loaded?.contract ?? null, loaded?.path ?? null);
}

export function explainArchitecture(
  contract: ArchitectureContract | null,
  check?: ArchitectureCheckResult | null,
): string {
  const lines: string[] = ["AgentDoctor architecture contract"];
  if (!contract) {
    lines.push("  No contract loaded. Run: agentdoctor architecture init");
    return `${lines.join("\n")}\n`;
  }
  lines.push(`  version: ${contract.version}`);
  lines.push(`  layers: ${contract.layers.map((l) => l.id).join(", ") || "(none)"}`);
  for (const layer of contract.layers) {
    lines.push(`    - ${layer.id}: ${layer.paths.join(", ")}`);
  }
  lines.push(`  forbidden rules: ${contract.forbidden.length}`);
  for (const rule of contract.forbidden) {
    lines.push(`    - [${rule.id}] ${rule.fromLayer} → ${rule.toLayer}: ${rule.description}`);
  }
  lines.push(`  allowed pairs: ${contract.allowed.length}`);
  for (const a of contract.allowed) {
    lines.push(`    - ${a.fromLayer} → ${a.toLayer}`);
  }
  if (check) {
    lines.push(`  import edges checked: ${check.importEdgesChecked}`);
    lines.push(`  violations: ${check.violations.length}`);
    for (const v of check.violations.slice(0, 20)) {
      lines.push(
        `    - ${v.kind} ${v.ruleId}: ${v.fromPath} → ${v.toPath} (${v.fromLayer}→${v.toLayer})`,
      );
    }
    for (const lim of check.limitations.slice(0, 5)) {
      lines.push(`  limitation: ${lim}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
