import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { PACKAGE_VERSION } from "../constants.js";
import { resolveRepoRoot } from "../utils/path.js";
import { atomicWriteTextFile } from "../utils/fs.js";
import { checkArchitectureAtRoot, loadArchitectureContract } from "../architecture/contract.js";
import { buildIntelligenceGraph } from "../intelligence/graph/build.js";
import { evaluateAgentAction } from "../platform/firewall/evaluate.js";
import {
  inspectEvidence,
  verifyEvidence,
  type EvidenceManifest,
  type VerificationStatus,
} from "./change.js";

/** Hash integrity of evidence artifacts — separate from engineering checks. */
export type IntegrityStatus = "HASH_INTEGRITY_VERIFIED" | "HASH_INTEGRITY_FAILED" | "NOT_CHECKED";

/** Outcome of architecture + policy engineering checks (never claims correctness). */
export type EngineeringChecksStatus = "NOT_RUN" | "PASSED" | "FAILED" | "INSUFFICIENT_EVIDENCE";

/**
 * Proof verification lifecycle. INTEGRITY_VERIFIED means hash match only.
 * ENGINEERING_CHECKS_* means architecture+policy ran — not that the change is correct.
 */
export type ProofVerificationState =
  | "NOT_RUN"
  | "ANALYSIS_COMPLETE"
  | "EVIDENCE_PRODUCED"
  | "INTEGRITY_VERIFIED"
  | "ENGINEERING_CHECKS_PASSED"
  | "ENGINEERING_CHECKS_FAILED"
  | "INSUFFICIENT_EVIDENCE";

/** Engineering correctness is never claimed in this release. */
export type CorrectnessStatus = "ENGINEERING_CORRECTNESS_NOT_CLAIMED";

export interface ChangeProof {
  proofId: string;
  changeId: string;
  repository: string;
  baseRevision: string | null;
  targetRevision: string | null;
  producer: string;
  producerVersion: string;
  timestamp: string;
  inputs: {
    evidenceDirectory: string;
    evidenceFiles: string[];
    manifestSchemaVersion: string;
  };
  findings: {
    verificationStatus: VerificationStatus;
    fileCount: number;
    hashMatchCount: number;
    hashMismatchCount: number;
  };
  architectureEvidence: { present: boolean; name: string };
  policyEvidence: { present: boolean; name: string };
  securityEvidence: { present: boolean; name: string };
  knowledgeEvidence: { present: boolean; name: string };
  testEvidence: { present: boolean; name: string };
  gitEvidence: { present: boolean; name: string };
  hashes: {
    evidenceManifestSha256: string | null;
    proofContentSha256: string;
    artifactHashes: Array<{ name: string; sha256: string }>;
  };
  parentEvidence?: { previousProofHash: string };
  /** Hash integrity only — never means the change is correct. */
  integrityStatus: IntegrityStatus;
  /** Architecture + policy check outcome — separate from integrity. */
  engineeringChecksStatus: EngineeringChecksStatus;
  /** Lifecycle state combining evidence / integrity / engineering checks. */
  verificationState: ProofVerificationState;
  engineeringChecks?: {
    architecture: {
      contractPresent: boolean;
      violations: number;
      importEdgesChecked: number;
      limitations: string[];
    };
    policy: {
      decision: string;
      reason: string;
      policyId: string | null;
    };
  };
  correctnessStatus: CorrectnessStatus;
  limitations: string[];
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function proofsDir(root: string): string {
  return path.join(root, ".agentdoctor", "proofs");
}

function proofPath(root: string, proofId: string): string {
  return path.join(proofsDir(root), `${proofId}.json`);
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function listProofFiles(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(proofsDir(root));
    return entries.filter((e) => e.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

function presentFlag(files: string[], name: string): { present: boolean; name: string } {
  return { present: files.includes(name), name };
}

async function runEngineeringChecks(root: string): Promise<{
  status: EngineeringChecksStatus;
  details: NonNullable<ChangeProof["engineeringChecks"]>;
  limitations: string[];
}> {
  const limitations: string[] = [
    "Engineering checks are architecture contract + policy evaluate only",
    "Passing engineering checks does not prove correctness, security, or completeness",
  ];

  const contractLoaded = await loadArchitectureContract(root);
  const graph = await buildIntelligenceGraph({ root, mode: "auto" });
  const arch = await checkArchitectureAtRoot(root, graph);

  const policy = await evaluateAgentAction(root, {
    actionId: `proof-engineering-${Date.now()}`,
    agentId: "agentdoctor",
    timestamp: new Date().toISOString(),
    type: "shell",
    params: { command: "agentdoctor proof build" },
    repositoryRoot: root,
  });

  const details: NonNullable<ChangeProof["engineeringChecks"]> = {
    architecture: {
      contractPresent: Boolean(contractLoaded),
      violations: arch.violations.length,
      importEdgesChecked: arch.importEdgesChecked,
      limitations: arch.limitations.slice(0, 8),
    },
    policy: {
      decision: policy.decision,
      reason: policy.reason,
      policyId: policy.policyId ?? null,
    },
  };

  if (!contractLoaded) {
    return {
      status: "INSUFFICIENT_EVIDENCE",
      details,
      limitations: [
        ...limitations,
        "No architecture contract found — engineering checks require architecture + policy",
        ...arch.limitations.slice(0, 4),
      ],
    };
  }

  const archOk = arch.violations.length === 0;
  const policyOk = policy.decision === "allow";

  if (archOk && policyOk) {
    return {
      status: "PASSED",
      details,
      limitations: [...limitations, ...arch.limitations.slice(0, 4)],
    };
  }

  return {
    status: "FAILED",
    details,
    limitations: [
      ...limitations,
      ...(archOk ? [] : [`Architecture violations: ${arch.violations.length}`]),
      ...(policyOk ? [] : [`Policy decision: ${policy.decision} (${policy.reason})`]),
      ...arch.limitations.slice(0, 4),
    ],
  };
}

function deriveVerificationState(
  integrityStatus: IntegrityStatus,
  engineeringChecksStatus: EngineeringChecksStatus,
): ProofVerificationState {
  if (integrityStatus === "HASH_INTEGRITY_FAILED") {
    return "EVIDENCE_PRODUCED";
  }
  if (integrityStatus !== "HASH_INTEGRITY_VERIFIED") {
    return "EVIDENCE_PRODUCED";
  }
  if (engineeringChecksStatus === "PASSED") {
    return "ENGINEERING_CHECKS_PASSED";
  }
  if (engineeringChecksStatus === "FAILED") {
    return "ENGINEERING_CHECKS_FAILED";
  }
  if (engineeringChecksStatus === "INSUFFICIENT_EVIDENCE") {
    return "INSUFFICIENT_EVIDENCE";
  }
  return "INTEGRITY_VERIFIED";
}

/**
 * Build a ChangeProof from an existing evidence bundle.
 * integrityStatus reflects hash re-check; engineeringChecksStatus is separate;
 * correctnessStatus is always NOT_CLAIMED.
 */
export async function buildProofFromEvidence(
  rootInput: string,
  changeId: string,
): Promise<ChangeProof> {
  const root = resolveRepoRoot(rootInput);
  const inspected = await inspectEvidence({ root, changeId });
  if (!inspected.ok || !inspected.manifest) {
    throw new Error(inspected.error ?? `Evidence bundle not found for ${changeId}`);
  }

  const hashCheck = await verifyEvidence({ root, changeId });
  const integrityStatus: IntegrityStatus = hashCheck.ok
    ? "HASH_INTEGRITY_VERIFIED"
    : hashCheck.checked.length > 0
      ? "HASH_INTEGRITY_FAILED"
      : "NOT_CHECKED";

  const eng =
    integrityStatus === "HASH_INTEGRITY_VERIFIED"
      ? await runEngineeringChecks(root)
      : {
          status: "NOT_RUN" as const,
          details: {
            architecture: {
              contractPresent: false,
              violations: 0,
              importEdgesChecked: 0,
              limitations: ["Engineering checks skipped because evidence integrity failed"],
            },
            policy: { decision: "not-run", reason: "integrity failed", policyId: null },
          },
          limitations: ["Engineering checks not run when integrity fails"],
        };

  const engineeringChecksStatus = eng.status;
  const verificationState = deriveVerificationState(integrityStatus, engineeringChecksStatus);

  const files = inspected.presentFiles;
  const manifest = inspected.manifest;
  let manifestSha: string | null = null;
  try {
    const raw = await fs.readFile(path.join(inspected.directory, "manifest.json"), "utf8");
    manifestSha = sha256(raw);
  } catch {
    manifestSha = null;
  }

  const previous = await findLatestProofForChange(root, changeId);
  const proofId = `prf_${createHash("sha256")
    .update(`${changeId}:${Date.now()}:${randomUUID()}`)
    .digest("hex")
    .slice(0, 16)}`;

  const limitations = [
    "ChangeProof records artifact integrity and optional engineering checks",
    "HASH_INTEGRITY_VERIFIED never means the change is correct or safe",
    "ENGINEERING_CHECKS_PASSED means architecture+policy evaluate succeeded — not product correctness",
    ...eng.limitations,
  ];

  const draft: Omit<ChangeProof, "hashes"> & {
    hashes: Omit<ChangeProof["hashes"], "proofContentSha256"> & { proofContentSha256?: string };
  } = {
    proofId,
    changeId,
    repository: root,
    baseRevision: manifest.baseRevision,
    targetRevision: manifest.targetRevision,
    producer: "agentdoctor",
    producerVersion: PACKAGE_VERSION,
    timestamp: new Date().toISOString(),
    inputs: {
      evidenceDirectory: inspected.directory,
      evidenceFiles: files,
      manifestSchemaVersion: manifest.schemaVersion,
    },
    findings: {
      verificationStatus: hashCheck.verificationStatus,
      fileCount: manifest.files.length,
      hashMatchCount: hashCheck.checked.filter((c) => c.match).length,
      hashMismatchCount: hashCheck.checked.filter((c) => !c.match).length,
    },
    architectureEvidence: presentFlag(files, "architecture.json"),
    policyEvidence: presentFlag(files, "policy.json"),
    securityEvidence: presentFlag(files, "security.json"),
    knowledgeEvidence: presentFlag(files, "knowledge.json"),
    testEvidence: presentFlag(files, "tests.json"),
    gitEvidence: presentFlag(files, "git.json"),
    hashes: {
      evidenceManifestSha256: manifestSha,
      artifactHashes: manifest.files.map((f) => ({ name: f.name, sha256: f.sha256 })),
    },
    ...(previous
      ? { parentEvidence: { previousProofHash: previous.hashes.proofContentSha256 } }
      : {}),
    integrityStatus,
    engineeringChecksStatus,
    verificationState,
    engineeringChecks: eng.details,
    correctnessStatus: "ENGINEERING_CORRECTNESS_NOT_CLAIMED",
    limitations,
  };

  const withoutProofHash = { ...draft, hashes: { ...draft.hashes, proofContentSha256: "" } };
  const proofContentSha256 = sha256(JSON.stringify(withoutProofHash));
  const proof: ChangeProof = {
    ...draft,
    hashes: {
      evidenceManifestSha256: manifestSha,
      proofContentSha256,
      artifactHashes: draft.hashes.artifactHashes,
    },
    correctnessStatus: "ENGINEERING_CORRECTNESS_NOT_CLAIMED",
  };

  await fs.mkdir(proofsDir(root), { recursive: true });
  await atomicWriteTextFile(proofPath(root, proofId), `${JSON.stringify(proof, null, 2)}\n`);
  return proof;
}

async function findLatestProofForChange(
  root: string,
  changeId: string,
): Promise<ChangeProof | null> {
  const files = await listProofFiles(root);
  let latest: ChangeProof | null = null;
  for (const name of files) {
    const raw = await readJsonFile(path.join(proofsDir(root), name));
    if (!raw || typeof raw !== "object") continue;
    const p = raw as ChangeProof;
    if (p.changeId !== changeId) continue;
    if (!latest || (p.timestamp ?? "") > (latest.timestamp ?? "")) {
      latest = p;
    }
  }
  return latest;
}

export async function resolveProofId(
  rootInput: string,
  proofIdOrChangeId: string,
): Promise<{ proof: ChangeProof; path: string } | { error: string }> {
  const root = resolveRepoRoot(rootInput);
  const direct = path.join(proofsDir(root), `${proofIdOrChangeId}.json`);
  const directRaw = await readJsonFile(direct);
  if (directRaw && typeof directRaw === "object") {
    return { proof: directRaw as ChangeProof, path: direct };
  }

  const latest = await findLatestProofForChange(root, proofIdOrChangeId);
  if (latest) {
    return { proof: latest, path: proofPath(root, latest.proofId) };
  }

  return {
    error: `No proof found for id ${proofIdOrChangeId} (tried proofId and changeId)`,
  };
}

export async function inspectProof(
  rootInput: string,
  proofIdOrChangeId: string,
): Promise<{ ok: boolean; proof?: ChangeProof; path?: string; error?: string }> {
  const resolved = await resolveProofId(rootInput, proofIdOrChangeId);
  if ("error" in resolved) {
    return { ok: false, error: resolved.error };
  }
  return { ok: true, proof: resolved.proof, path: resolved.path };
}

/**
 * Re-hash evidence artifacts and compare to the proof's recorded hashes.
 * Never upgrades correctnessStatus. Tampering → HASH_INTEGRITY_FAILED.
 */
export async function verifyProof(
  rootInput: string,
  proofIdOrChangeId: string,
): Promise<{
  ok: boolean;
  integrityStatus: IntegrityStatus;
  engineeringChecksStatus: EngineeringChecksStatus;
  verificationState: ProofVerificationState;
  correctnessStatus: CorrectnessStatus;
  proof?: ChangeProof;
  checked: Array<{ name: string; match: boolean; expected?: string; actual?: string }>;
  error?: string;
}> {
  const resolved = await resolveProofId(rootInput, proofIdOrChangeId);
  if ("error" in resolved) {
    return {
      ok: false,
      integrityStatus: "HASH_INTEGRITY_FAILED",
      engineeringChecksStatus: "NOT_RUN",
      verificationState: "NOT_RUN",
      correctnessStatus: "ENGINEERING_CORRECTNESS_NOT_CLAIMED",
      checked: [],
      error: resolved.error,
    };
  }

  const proof = resolved.proof;
  const evidenceCheck = await verifyEvidence({
    root: rootInput,
    changeId: proof.changeId,
  });

  const checked = evidenceCheck.checked;
  const ok = evidenceCheck.ok;
  const integrityStatus: IntegrityStatus = ok ? "HASH_INTEGRITY_VERIFIED" : "HASH_INTEGRITY_FAILED";
  const engineeringChecksStatus: EngineeringChecksStatus =
    proof.engineeringChecksStatus ?? "NOT_RUN";
  const verificationState = ok
    ? deriveVerificationState(integrityStatus, engineeringChecksStatus)
    : ("EVIDENCE_PRODUCED" as const);

  return {
    ok,
    integrityStatus,
    engineeringChecksStatus,
    verificationState,
    correctnessStatus: "ENGINEERING_CORRECTNESS_NOT_CLAIMED",
    proof,
    checked,
    ...(evidenceCheck.error ? { error: evidenceCheck.error } : {}),
  };
}

/**
 * Human-readable explanation of a ChangeProof (does not claim correctness).
 */
export function explainProof(proof: ChangeProof): string {
  const lines = [
    `ChangeProof ${proof.proofId}`,
    `  changeId: ${proof.changeId}`,
    `  repository: ${proof.repository}`,
    `  base → target: ${proof.baseRevision ?? "(none)"} → ${proof.targetRevision ?? "unknown"}`,
    `  integrityStatus: ${proof.integrityStatus}`,
    `  engineeringChecksStatus: ${proof.engineeringChecksStatus}`,
    `  verificationState: ${proof.verificationState}`,
    `  correctnessStatus: ${proof.correctnessStatus}`,
    `  evidence files: ${proof.inputs.evidenceFiles.length}`,
    `  hash matches: ${proof.findings.hashMatchCount}/${proof.findings.fileCount}`,
  ];
  if (proof.engineeringChecks) {
    lines.push(
      `  architecture: contract=${proof.engineeringChecks.architecture.contractPresent} violations=${proof.engineeringChecks.architecture.violations}`,
      `  policy: ${proof.engineeringChecks.policy.decision} (${proof.engineeringChecks.policy.reason})`,
    );
  }
  lines.push(
    "",
    "Integrity verifies evidence artifact hashes only.",
    "Engineering checks (when present) evaluate architecture contract + policy — not that the change is correct.",
    "Limitations:",
    ...(proof.limitations ?? []).slice(0, 10).map((l) => `  - ${l}`),
  );
  return lines.join("\n");
}

export async function exportProof(
  rootInput: string,
  proofIdOrChangeId: string,
  outFile: string,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  const inspected = await inspectProof(rootInput, proofIdOrChangeId);
  if (!inspected.ok || !inspected.proof) {
    return { ok: false, error: inspected.error ?? "proof not found" };
  }
  const target = path.resolve(outFile);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await atomicWriteTextFile(target, `${JSON.stringify(inspected.proof, null, 2)}\n`);
  return { ok: true, path: target };
}

export type { EvidenceManifest };
