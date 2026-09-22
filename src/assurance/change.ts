import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { PACKAGE_VERSION } from "../constants.js";
import { analyzeChanges } from "../core/changes/analyze.js";
import { scanSecrets } from "../core/secrets/scan.js";
import { buildC4Views } from "../architecture/c4.js";
import { buildIntelligenceGraph } from "../intelligence/graph/build.js";
import { listKnowledge, retrieveAuthoritative } from "../knowledge/store.js";
import { analyzeTestImpact } from "../platform/test-impact/analyze.js";
import { evaluateAgentAction } from "../platform/firewall/evaluate.js";
import { resolveRepoRoot } from "../utils/path.js";
import { atomicWriteTextFile } from "../utils/fs.js";

export const EVIDENCE_SCHEMA_VERSION = "1.0.0";

export type VerificationStatus =
  "not-run" | "partial" | "evidence-produced" | "failed" | "verified";

export interface ChangeAssessment {
  changeId: string;
  schemaVersion: string;
  agentDoctorVersion: string;
  repository: {
    root: string;
    remote: string | null;
    branch: string | null;
  };
  baseRevision: string | null;
  targetRevision: string | null;
  changedFiles: Array<{ path: string; kind: string }>;
  changedSymbols: string[];
  /** Graph nodes / paths that call or import into changed symbols/files. */
  callers: string[];
  /** Graph targets called or imported from changed symbols/files. */
  callees: string[];
  /** Files that import changed files (reverse import deps). */
  reverseDependencies: string[];
  /** Workspace packages touched by changed files (from package.json workspaces when present). */
  packageImpact: string[];
  affectedComponents: string[];
  dependencyImpact: {
    status: "observed" | "unknown" | "heuristic";
    relatedPaths: string[];
    edgeCount: number;
    limitations: string[];
  };
  architectureImpact: {
    status: "inferred" | "unknown";
    viewLevels: string[];
    limitations: string[];
  };
  knowledgeReferences: Array<{
    id: string;
    title: string;
    status: string;
    authoritative: boolean;
  }>;
  securityFindings: {
    secretFindingCount: number;
    mode: "heuristic";
    limitations: string[];
  };
  policyResults: Array<{
    policyId: string;
    decision: string;
    reason: string;
    subject: string;
    action: string;
    evidence: string;
  }>;
  testImpact: {
    mode: "heuristic" | "coverage-backed";
    recommendedTests: string[];
    confidence: "low" | "medium" | "high";
    limitations: string[];
  };
  evidence: {
    directory: string | null;
    files: string[];
  };
  verificationStatus: VerificationStatus;
  limitations: string[];
  createdAt: string;
}

export interface EvidenceManifest {
  schemaVersion: string;
  agentDoctorVersion: string;
  changeId: string;
  repositoryRoot: string;
  baseRevision: string | null;
  targetRevision: string | null;
  createdAt: string;
  files: Array<{ name: string; sha256: string }>;
  verificationStatus: VerificationStatus;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function evidenceRoot(repoRoot: string, changeId: string): string {
  return path.join(repoRoot, ".agentdoctor", "evidence", changeId);
}

function normalizeRelPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].filter(Boolean).sort();
}

/**
 * Derive callers / callees / reverse import deps from the intelligence graph
 * for the given changed files and symbol ids. Honest: empty when graph lacks edges.
 */
export function deriveGraphChangeImpact(
  graph: {
    nodes: Array<{ id: string; kind: string; label: string; path?: string }>;
    edges: Array<{ from: string; to: string; kind: string }>;
  },
  changedFiles: Array<{ path: string; kind: string }>,
  changedSymbols: string[],
): {
  callers: string[];
  callees: string[];
  reverseDependencies: string[];
} {
  const changedPaths = new Set(changedFiles.map((f) => normalizeRelPath(f.path)));
  // Include rename sources: git may report only the new path; both old/new appear as kind renamed with path as destination.
  const changedSymbolIds = new Set(changedSymbols);
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  const isChangedNode = (nodeId: string): boolean => {
    if (changedSymbolIds.has(nodeId)) return true;
    const node = nodeById.get(nodeId);
    if (!node) return false;
    const nodePath = node.path ? normalizeRelPath(node.path) : "";
    if (nodePath && changedPaths.has(nodePath)) return true;
    // Dependency nodes may carry resolvedPath in meta — handled via path/label.
    if (node.kind === "dependency" && node.label) {
      const label = normalizeRelPath(node.label);
      if (changedPaths.has(label)) return true;
      for (const p of changedPaths) {
        if (label.endsWith(p) || label.includes(p)) return true;
      }
    }
    return false;
  };

  const labelOf = (nodeId: string): string => {
    const node = nodeById.get(nodeId);
    if (!node) return nodeId;
    if (node.path) return normalizeRelPath(node.path);
    return node.label || nodeId;
  };

  const callers = new Set<string>();
  const callees = new Set<string>();
  const reverseDependencies = new Set<string>();

  for (const edge of graph.edges) {
    const kind = edge.kind;
    const fromChanged = isChangedNode(edge.from);
    const toChanged = isChangedNode(edge.to);

    if (kind === "calls" || kind === "imports" || kind === "extends" || kind === "implements") {
      if (fromChanged) {
        callees.add(labelOf(edge.to));
      }
      if (toChanged) {
        callers.add(labelOf(edge.from));
      }
    }

    if (kind === "imports" && toChanged) {
      const fromLabel = labelOf(edge.from);
      if (!changedPaths.has(normalizeRelPath(fromLabel))) {
        reverseDependencies.add(fromLabel);
      }
    }
  }

  return {
    callers: uniqueSorted(callers).slice(0, 200),
    callees: uniqueSorted(callees).slice(0, 200),
    reverseDependencies: uniqueSorted(reverseDependencies).slice(0, 200),
  };
}

/**
 * Map changed files onto package.json workspaces (string globs or packages/*).
 * Returns [] when workspaces are absent — does not invent packages.
 */
export async function derivePackageImpact(
  root: string,
  changedFiles: Array<{ path: string }>,
): Promise<string[]> {
  let pkgRaw: string;
  try {
    pkgRaw = await fs.readFile(path.join(root, "package.json"), "utf8");
  } catch {
    return [];
  }
  let workspaces: string[] = [];
  try {
    const pkg = JSON.parse(pkgRaw) as {
      workspaces?: string[] | { packages?: string[] };
      name?: string;
    };
    if (Array.isArray(pkg.workspaces)) {
      workspaces = pkg.workspaces;
    } else if (pkg.workspaces && Array.isArray(pkg.workspaces.packages)) {
      workspaces = pkg.workspaces.packages;
    }
    if (workspaces.length === 0) {
      // Single-package repo: report package name when any file changed.
      if (changedFiles.length > 0 && typeof pkg.name === "string" && pkg.name) {
        return [pkg.name];
      }
      return [];
    }
  } catch {
    return [];
  }

  const impacted = new Set<string>();
  for (const pattern of workspaces) {
    // Support simple "packages/*" / "apps/*" style globs only.
    const star = pattern.indexOf("*");
    if (star === -1) {
      const prefix = normalizeRelPath(pattern).replace(/\/$/, "");
      for (const f of changedFiles) {
        const fp = normalizeRelPath(f.path);
        if (fp === prefix || fp.startsWith(`${prefix}/`)) {
          impacted.add(prefix);
        }
      }
      continue;
    }
    const prefix = normalizeRelPath(pattern.slice(0, star)).replace(/\/$/, "");
    for (const f of changedFiles) {
      const fp = normalizeRelPath(f.path);
      if (!fp.startsWith(prefix ? `${prefix}/` : "")) continue;
      const rest = prefix ? fp.slice(prefix.length + 1) : fp;
      const pkgName = rest.split("/")[0];
      if (pkgName) impacted.add(prefix ? `${prefix}/${pkgName}` : pkgName);
    }
  }
  return uniqueSorted(impacted);
}

async function writeJson(
  filePath: string,
  value: unknown,
): Promise<{ name: string; sha256: string }> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await atomicWriteTextFile(filePath, text);
  return { name: path.basename(filePath), sha256: sha256(text) };
}

function gitMeta(root: string): {
  remote: string | null;
  branch: string | null;
  head: string | null;
} {
  const run = (args: string[]) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    return r.status === 0 && typeof r.stdout === "string" ? r.stdout.trim() : null;
  };
  return {
    head: run(["rev-parse", "HEAD"]),
    branch: run(["rev-parse", "--abbrev-ref", "HEAD"]),
    remote: run(["config", "--get", "remote.origin.url"]),
  };
}

/**
 * Assemble a ChangeAssessment from existing AgentDoctor signals.
 * Never sets verificationStatus to "verified" — that requires evidence verify.
 */
export async function analyzeChange(options: {
  root: string;
  since?: string;
  changeId?: string;
  coveragePath?: string;
}): Promise<ChangeAssessment> {
  const root = resolveRepoRoot(options.root);
  const since = options.since;
  const changeId =
    options.changeId ??
    `chg_${createHash("sha256")
      .update(`${root}:${Date.now()}:${randomUUID()}`)
      .digest("hex")
      .slice(0, 16)}`;

  const meta = gitMeta(root);
  const changes = await analyzeChanges({
    root,
    ...(since ? { since } : {}),
    impact: true,
  });

  const graph = await buildIntelligenceGraph({ root, mode: "auto" });
  const changedFiles = changes.files.map((f) => ({ path: f.path, kind: f.kind }));
  const changedSet = new Set(changedFiles.map((f) => f.path));
  const changedSymbols = graph.nodes
    .filter((n) => {
      if (n.kind !== "function" && n.kind !== "class") return false;
      const nodePath = (n.path ?? "").split(path.sep).join("/");
      return nodePath !== "" && changedSet.has(nodePath);
    })
    .map((n) => n.id)
    .slice(0, 200);

  const graphImpact = deriveGraphChangeImpact(graph, changedFiles, changedSymbols);
  const packageImpact = await derivePackageImpact(root, changedFiles);

  const affectedComponents = [...new Set(changes.files.flatMap((f) => f.modules ?? []))].sort();

  const c4 = buildC4Views(graph);
  const testImpact = await analyzeTestImpact({
    root,
    ...(options.coveragePath ? { coveragePath: options.coveragePath } : {}),
  });
  const secrets = await scanSecrets({ root, enabled: true, maxFiles: 200 });
  const knowledge = await listKnowledge(root);
  const knowledgeRefs = knowledge
    .filter((k) => k.status === "approved")
    .slice(0, 20)
    .map((rec) => {
      const auth = retrieveAuthoritative(knowledge, rec.title);
      return {
        id: rec.id,
        title: rec.title,
        status: rec.status,
        authoritative: !auth.abstain,
      };
    });

  const policyEval = await evaluateAgentAction(root, {
    actionId: `change-analyze-${changeId}`,
    agentId: "agentdoctor",
    timestamp: new Date().toISOString(),
    type: "shell",
    params: { command: "agentdoctor change analyze" },
    repositoryRoot: root,
  });

  const kindCounts = changedFiles.reduce(
    (acc, f) => {
      acc[f.kind] = (acc[f.kind] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const limitations = [
    ...changes.limitations,
    `Graph builder: ${graph.builder}; AST files parsed: ${graph.astFilesParsed}`,
    "Changed symbols are graph-derived when path metadata is present",
    "Callers/callees/reverseDependencies are graph-edge derived — incomplete when imports are UNRESOLVED",
    "Architecture impact is inferred from C4 views — not approved architecture truth",
    `Test impact mode=${testImpact.mode}${testImpact.coverage ? ` (format=${testImpact.coverage.format}, attribution=${testImpact.coverage.testAttribution})` : ""}`,
    "verificationStatus is not-run until agentdoctor change verify produces an evidence bundle",
    `Git change kinds observed: ${JSON.stringify(kindCounts)}`,
    ...secrets.limitations,
  ];

  return {
    changeId,
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    agentDoctorVersion: PACKAGE_VERSION,
    repository: {
      root,
      remote: meta.remote,
      branch: meta.branch,
    },
    baseRevision: since ?? null,
    targetRevision: meta.head ?? changes.head,
    changedFiles,
    changedSymbols,
    callers: graphImpact.callers,
    callees: graphImpact.callees,
    reverseDependencies: graphImpact.reverseDependencies,
    packageImpact,
    affectedComponents,
    dependencyImpact: {
      status:
        changes.impact?.status === "observed"
          ? "observed"
          : changes.impact
            ? "unknown"
            : "heuristic",
      relatedPaths: changes.impact?.relatedPaths ?? graphImpact.reverseDependencies,
      edgeCount: changes.impact?.edges.length ?? 0,
      limitations: changes.impact
        ? [changes.impact.reason]
        : [
            "No Project Brain impact edges available; reverseDependencies from graph used when present",
          ],
    },
    architectureImpact: {
      status: "inferred",
      viewLevels: c4.map((v) => v.level),
      limitations: c4.flatMap((v) => v.limitations).slice(0, 8),
    },
    knowledgeReferences: knowledgeRefs,
    securityFindings: {
      secretFindingCount: secrets.findings.length,
      mode: "heuristic",
      limitations: ["Secret scan is pattern-based and redacted; does not prove absence of secrets"],
    },
    policyResults: [
      {
        policyId: policyEval.policyId ?? "firewall",
        decision: policyEval.decision,
        reason: policyEval.reason,
        subject: "change-analyze",
        action: "shell:agentdoctor change analyze",
        evidence: `evaluate-only; executionResult=${policyEval.executionResult}`,
      },
    ],
    testImpact: {
      mode: testImpact.mode,
      recommendedTests: testImpact.recommendedTests.map((t) => t.testPath),
      confidence: testImpact.recommendedTests.some((t) => t.confidence >= 0.7) ? "medium" : "low",
      limitations: testImpact.limitations,
    },
    evidence: {
      directory: null,
      files: [],
    },
    verificationStatus: "not-run",
    limitations,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Persist evidence bundle. Status becomes evidence-produced (not "verified").
 * "verified" is reserved for evidence verify when artifact hashes match.
 */
export async function verifyChange(options: {
  root: string;
  since?: string;
  changeId?: string;
  coveragePath?: string;
}): Promise<{ assessment: ChangeAssessment; manifest: EvidenceManifest }> {
  const draft = await analyzeChange(options);
  const root = resolveRepoRoot(options.root);
  const dir = evidenceRoot(root, draft.changeId);
  await fs.mkdir(dir, { recursive: true });

  const graph = await buildIntelligenceGraph({ root, mode: "auto" });
  const c4 = buildC4Views(graph);
  const testImpact = await analyzeTestImpact({
    root,
    ...(options.coveragePath ? { coveragePath: options.coveragePath } : {}),
  });
  const secrets = await scanSecrets({ root, enabled: true, maxFiles: 200 });
  const meta = gitMeta(root);

  const assessment: ChangeAssessment = {
    ...draft,
    testImpact: {
      mode: testImpact.mode,
      recommendedTests: testImpact.recommendedTests.map((t) => t.testPath),
      confidence: testImpact.recommendedTests.some((t) => t.confidence >= 0.7) ? "medium" : "low",
      limitations: testImpact.limitations,
    },
    evidence: {
      directory: dir,
      files: [
        "manifest.json",
        "change.json",
        "graph-impact.json",
        "architecture.json",
        "knowledge.json",
        "policy.json",
        "security.json",
        "tests.json",
        "git.json",
        "verification.json",
      ],
    },
    verificationStatus: "evidence-produced",
  };

  const fileHashes: Array<{ name: string; sha256: string }> = [];
  fileHashes.push(await writeJson(path.join(dir, "change.json"), assessment));
  fileHashes.push(
    await writeJson(path.join(dir, "graph-impact.json"), {
      builder: graph.builder,
      astFilesParsed: graph.astFilesParsed,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      relatedPaths: assessment.dependencyImpact.relatedPaths,
      limitations: [...assessment.dependencyImpact.limitations, ...graph.limitations].slice(0, 20),
    }),
  );
  fileHashes.push(
    await writeJson(path.join(dir, "architecture.json"), {
      status: "inferred",
      views: c4,
    }),
  );
  fileHashes.push(
    await writeJson(path.join(dir, "knowledge.json"), {
      references: assessment.knowledgeReferences,
      note: "Only approved knowledge is listed as authoritative candidates",
    }),
  );
  fileHashes.push(
    await writeJson(path.join(dir, "policy.json"), {
      results: assessment.policyResults,
      executionResult: "not-executed",
    }),
  );
  fileHashes.push(
    await writeJson(path.join(dir, "security.json"), {
      secretFindingCount: secrets.findings.length,
      findings: secrets.findings,
      mode: "heuristic",
    }),
  );
  fileHashes.push(
    await writeJson(path.join(dir, "tests.json"), {
      mode: testImpact.mode,
      coverage: testImpact.coverage,
      report: testImpact,
    }),
  );
  fileHashes.push(
    await writeJson(path.join(dir, "git.json"), {
      ...meta,
      baseRevision: assessment.baseRevision,
      targetRevision: assessment.targetRevision,
      changedFiles: assessment.changedFiles,
    }),
  );
  fileHashes.push(
    await writeJson(path.join(dir, "verification.json"), {
      status: "evidence-produced",
      note: "Evidence artifacts written. Use agentdoctor evidence verify to hash-check.",
      producedAt: new Date().toISOString(),
    }),
  );

  const manifest: EvidenceManifest = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    agentDoctorVersion: PACKAGE_VERSION,
    changeId: assessment.changeId,
    repositoryRoot: root,
    baseRevision: assessment.baseRevision,
    targetRevision: assessment.targetRevision,
    createdAt: new Date().toISOString(),
    files: fileHashes,
    verificationStatus: "evidence-produced",
  };
  await writeJson(path.join(dir, "manifest.json"), manifest);

  // Durable ChangeProof from the evidence bundle (correctness never claimed).
  const { buildProofFromEvidence } = await import("./proof.js");
  await buildProofFromEvidence(root, assessment.changeId);

  return { assessment, manifest };
}

/**
 * Human-readable explanation of a ChangeAssessment (does not claim correctness).
 */
export function explainChange(assessment: ChangeAssessment): string {
  const lines = [
    `Change ${assessment.changeId}`,
    `  repository: ${assessment.repository.root}`,
    `  base → target: ${assessment.baseRevision ?? "(working tree)"} → ${assessment.targetRevision ?? "unknown"}`,
    `  changed files: ${assessment.changedFiles.length} (${assessment.changedFiles.map((f) => f.kind).join(", ") || "none"})`,
    `  changed symbols: ${assessment.changedSymbols.length}`,
    `  callers: ${assessment.callers.length}`,
    `  callees: ${assessment.callees.length}`,
    `  reverseDependencies: ${assessment.reverseDependencies.length}`,
    `  packageImpact: ${assessment.packageImpact.join(", ") || "(none)"}`,
    `  components: ${assessment.affectedComponents.join(", ") || "(none)"}`,
    `  dependency impact: ${assessment.dependencyImpact.status} (${assessment.dependencyImpact.edgeCount} edges)`,
    `  architecture: ${assessment.architectureImpact.status} [${assessment.architectureImpact.viewLevels.join(", ")}]`,
    `  knowledge refs: ${assessment.knowledgeReferences.length}`,
    `  security (heuristic): ${assessment.securityFindings.secretFindingCount} secret finding(s)`,
    `  policy: ${assessment.policyResults.map((p) => `${p.decision}`).join(", ") || "none"}`,
    `  test impact: ${assessment.testImpact.mode} / ${assessment.testImpact.confidence} (${assessment.testImpact.recommendedTests.length} recommended)`,
    `  verificationStatus: ${assessment.verificationStatus}`,
    `  evidence: ${assessment.evidence.directory ?? "(none)"}`,
    "",
    "This assessment assembles engineering signals. It does not prove correctness, security, or completeness.",
    "Limitations:",
    ...assessment.limitations.slice(0, 12).map((l) => `  - ${l}`),
  ];
  return lines.join("\n");
}

/**
 * Summarize base/target file diffs from git for a change.
 */
export async function diffChange(options: {
  root: string;
  since?: string;
  changeId?: string;
}): Promise<{
  changeId: string | null;
  baseRevision: string | null;
  targetRevision: string | null;
  files: Array<{ path: string; kind: string }>;
  summary: { added: number; modified: number; deleted: number; renamed: number; untracked: number };
  stat: string | null;
  limitations: string[];
}> {
  const root = resolveRepoRoot(options.root);
  const since = options.since;
  const changes = await analyzeChanges({
    root,
    ...(since ? { since } : {}),
  });

  const run = (args: string[]) => {
    const r = spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    return r.status === 0 && typeof r.stdout === "string" ? r.stdout.trim() : null;
  };

  const base = since ?? null;
  const target = changes.head;
  let stat: string | null = null;
  if (base) {
    stat = run(["diff", "--stat", `${base}...${target ?? "HEAD"}`]);
  } else {
    stat = run(["diff", "--stat", "HEAD"]);
    const unstaged = run(["diff", "--stat"]);
    if (unstaged && unstaged !== stat) {
      stat = [stat, unstaged].filter(Boolean).join("\n");
    }
  }

  return {
    changeId: options.changeId ?? null,
    baseRevision: base,
    targetRevision: target,
    files: changes.files.map((f) => ({ path: f.path, kind: f.kind })),
    summary: changes.summary,
    stat,
    limitations: [
      ...changes.limitations,
      "Diff is git-derived; binary and generated files may be omitted from --stat",
    ],
  };
}

/**
 * Verification / evidence status for latest evidence or a specific change id.
 */
export async function changeStatus(options: { root: string; changeId?: string }): Promise<{
  changeId: string | null;
  evidenceDirectory: string | null;
  verificationStatus: VerificationStatus;
  evidencePresent: boolean;
  proofPresent: boolean;
  proofId: string | null;
  integrityNote: string;
  files: string[];
}> {
  const root = resolveRepoRoot(options.root);
  let changeId = options.changeId ?? null;

  if (!changeId) {
    const evidenceRoot = path.join(root, ".agentdoctor", "evidence");
    try {
      const entries = await fs.readdir(evidenceRoot, { withFileTypes: true });
      const dirs = entries.filter((e) => e.isDirectory() && e.name.startsWith("chg_"));
      let newest: { name: string; mtime: number } | null = null;
      for (const d of dirs) {
        const st = await fs.stat(path.join(evidenceRoot, d.name));
        if (!newest || st.mtimeMs > newest.mtime) {
          newest = { name: d.name, mtime: st.mtimeMs };
        }
      }
      changeId = newest?.name ?? null;
    } catch {
      changeId = null;
    }
  }

  if (!changeId) {
    return {
      changeId: null,
      evidenceDirectory: null,
      verificationStatus: "not-run",
      evidencePresent: false,
      proofPresent: false,
      proofId: null,
      integrityNote: "No evidence bundles found under .agentdoctor/evidence/",
      files: [],
    };
  }

  const inspected = await inspectEvidence({ root, changeId });
  let verificationStatus: VerificationStatus = "not-run";
  if (inspected.ok && inspected.manifest) {
    const hashCheck = await verifyEvidence({ root, changeId });
    verificationStatus = hashCheck.verificationStatus;
  } else if (inspected.ok) {
    verificationStatus = "partial";
  }

  let proofPresent = false;
  let proofId: string | null = null;
  try {
    const { inspectProof } = await import("./proof.js");
    const proof = await inspectProof(root, changeId);
    if (proof.ok && proof.proof) {
      proofPresent = true;
      proofId = proof.proof.proofId;
    }
  } catch {
    proofPresent = false;
  }

  return {
    changeId,
    evidenceDirectory: inspected.ok ? inspected.directory : null,
    verificationStatus,
    evidencePresent: inspected.ok,
    proofPresent,
    proofId,
    integrityNote:
      verificationStatus === "verified"
        ? "Evidence artifact hashes match manifest (HASH integrity only — not engineering correctness)"
        : verificationStatus === "evidence-produced" || verificationStatus === "not-run"
          ? "Run agentdoctor evidence verify / proof verify to check hashes"
          : "Evidence hash check incomplete or failed",
    files: inspected.presentFiles,
  };
}

export async function inspectEvidence(options: { root: string; changeId: string }): Promise<{
  ok: boolean;
  directory: string;
  manifest: EvidenceManifest | null;
  presentFiles: string[];
  error?: string;
}> {
  const root = resolveRepoRoot(options.root);
  const directory = evidenceRoot(root, options.changeId);
  try {
    const entries = await fs.readdir(directory);
    let manifest: EvidenceManifest | null = null;
    try {
      const raw = await fs.readFile(path.join(directory, "manifest.json"), "utf8");
      manifest = JSON.parse(raw) as EvidenceManifest;
    } catch {
      manifest = null;
    }
    return { ok: true, directory, manifest, presentFiles: entries.sort() };
  } catch (error) {
    return {
      ok: false,
      directory,
      manifest: null,
      presentFiles: [],
      error: error instanceof Error ? error.message : "Unable to read evidence directory",
    };
  }
}

/**
 * Hash-check evidence bundle. Returns "verified" only when all listed files match.
 */
export async function verifyEvidence(options: { root: string; changeId: string }): Promise<{
  ok: boolean;
  verificationStatus: VerificationStatus;
  checked: Array<{ name: string; match: boolean; expected?: string; actual?: string }>;
  error?: string;
}> {
  const inspected = await inspectEvidence(options);
  if (!inspected.ok || !inspected.manifest) {
    return {
      ok: false,
      verificationStatus: "failed",
      checked: [],
      error: inspected.error ?? "manifest.json missing",
    };
  }

  const checked: Array<{ name: string; match: boolean; expected?: string; actual?: string }> = [];
  for (const file of inspected.manifest.files) {
    const filePath = path.join(inspected.directory, file.name);
    try {
      const text = await fs.readFile(filePath, "utf8");
      const actual = sha256(text);
      checked.push({
        name: file.name,
        match: actual === file.sha256,
        expected: file.sha256,
        actual,
      });
    } catch {
      checked.push({ name: file.name, match: false, expected: file.sha256 });
    }
  }

  const allMatch = checked.length > 0 && checked.every((c) => c.match);
  const anyMatch = checked.some((c) => c.match);
  const verificationStatus: VerificationStatus = allMatch
    ? "verified"
    : anyMatch
      ? "partial"
      : "failed";

  return { ok: allMatch, verificationStatus, checked };
}
