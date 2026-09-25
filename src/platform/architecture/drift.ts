import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { resolveRepoRoot } from "../../utils/path.js";
import type { PlatformFinding, RepositoryGraph } from "../types.js";
import { writeJsonArtifact, platformDir } from "../store.js";

export interface ArchitectureRule {
  id: string;
  description: string;
  forbidImportFrom?: string;
  forbidImportTo?: string;
  severity: PlatformFinding["severity"];
}

export interface ArchitecturePolicy {
  version: "2.0";
  rules: ArchitectureRule[];
}

const DEFAULT_POLICY: ArchitecturePolicy = {
  version: "2.0",
  rules: [
    {
      id: "no-src-to-dist",
      description: "Source should not import built dist artifacts",
      forbidImportFrom: "src/",
      forbidImportTo: "dist/",
      severity: "high",
    },
    {
      id: "tests-not-imported-by-src",
      description: "Production source should not import test files",
      forbidImportFrom: "src/",
      forbidImportTo: ".test.",
      severity: "medium",
    },
  ],
};

export async function loadArchitecturePolicy(root: string): Promise<ArchitecturePolicy> {
  const file = path.join(platformDir(root), "architecture-policy.json");
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as ArchitecturePolicy;
    if (parsed.version === "2.0") return parsed;
  } catch {
    // default
  }
  await writeJsonArtifact(resolveRepoRoot(root), "architecture-policy.json", DEFAULT_POLICY);
  return DEFAULT_POLICY;
}

/**
 * Module I — Architecture drift detection.
 */
export async function analyzeArchitectureDrift(
  rootInput: string,
  graph: RepositoryGraph,
): Promise<PlatformFinding[]> {
  const root = resolveRepoRoot(rootInput);
  const policy = await loadArchitecturePolicy(root);
  const findings: PlatformFinding[] = [];

  for (const edge of graph.edges.filter((e) => e.kind === "imports")) {
    const fromNode = graph.nodes.find((n) => n.id === edge.from);
    const toLabel = graph.nodes.find((n) => n.id === edge.to)?.label ?? edge.to;
    const fromPath = fromNode?.path ?? "";
    for (const rule of policy.rules) {
      const fromHit = rule.forbidImportFrom ? fromPath.includes(rule.forbidImportFrom) : true;
      const toHit = rule.forbidImportTo ? toLabel.includes(rule.forbidImportTo) : true;
      if (fromHit && toHit && rule.forbidImportFrom && rule.forbidImportTo) {
        findings.push({
          id: `arch_${createHash("sha1").update(`${rule.id}:${edge.id}`).digest("hex").slice(0, 12)}`,
          module: "architecture-drift",
          severity: rule.severity,
          title: `Architecture rule violated: ${rule.id}`,
          message: `${fromPath} imports ${toLabel}`,
          recommendation: rule.description,
          confidence: edge.evidence === "verified" ? 0.7 : 0.4,
          evidence: [
            {
              kind: edge.evidence,
              path: fromPath,
              detail: `edge=${edge.kind} rule=${rule.id}`,
            },
          ],
        });
      }
    }
  }

  return findings.sort((a, b) => a.id.localeCompare(b.id));
}
