import {
  analyzeChange,
  changeStatus,
  diffChange,
  explainChange,
  inspectEvidence,
  verifyChange,
  verifyEvidence,
} from "../../assurance/change.js";
import {
  buildProofFromEvidence,
  explainProof,
  exportProof,
  inspectProof,
  verifyProof,
} from "../../assurance/proof.js";
import { EXIT_CODES } from "../../types/index.js";

function emit(json: boolean, value: unknown, human: string): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else {
    process.stdout.write(`${human}\n`);
  }
}

export async function runChangeAnalyzeCommand(options: {
  root: string;
  since?: string;
  coverage?: string;
  json?: boolean;
}): Promise<number> {
  try {
    const assessment = await analyzeChange({
      root: options.root,
      ...(options.since ? { since: options.since } : {}),
      ...(options.coverage ? { coveragePath: options.coverage } : {}),
    });
    emit(
      Boolean(options.json),
      assessment,
      [
        `Change assessment ${assessment.changeId}`,
        `  files: ${assessment.changedFiles.length}`,
        `  symbols: ${assessment.changedSymbols.length}`,
        `  testImpact: ${assessment.testImpact.mode} (${assessment.testImpact.confidence})`,
        `  verificationStatus: ${assessment.verificationStatus}`,
        `  Next: agentdoctor change verify${options.since ? ` --since ${options.since}` : ""}`,
      ].join("\n"),
    );
    return EXIT_CODES.SUCCESS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    return EXIT_CODES.INTERNAL_ERROR;
  }
}

export async function runChangeVerifyCommand(options: {
  root: string;
  since?: string;
  changeId?: string;
  coverage?: string;
  json?: boolean;
}): Promise<number> {
  try {
    const { assessment, manifest } = await verifyChange({
      root: options.root,
      ...(options.since ? { since: options.since } : {}),
      ...(options.changeId ? { changeId: options.changeId } : {}),
      ...(options.coverage ? { coveragePath: options.coverage } : {}),
    });
    emit(
      Boolean(options.json),
      { assessment, manifest },
      [
        `Evidence produced for ${assessment.changeId}`,
        `  directory: ${assessment.evidence.directory}`,
        `  files: ${assessment.evidence.files?.join(", ") ?? ""}`,
        `  verificationStatus: ${assessment.verificationStatus}`,
        `  Next: agentdoctor evidence verify ${assessment.changeId}`,
      ].join("\n"),
    );
    return EXIT_CODES.SUCCESS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    return EXIT_CODES.INTERNAL_ERROR;
  }
}

export async function runChangeExplainCommand(options: {
  root: string;
  since?: string;
  changeId?: string;
  coverage?: string;
  json?: boolean;
}): Promise<number> {
  try {
    const assessment = await analyzeChange({
      root: options.root,
      ...(options.since ? { since: options.since } : {}),
      ...(options.changeId ? { changeId: options.changeId } : {}),
      ...(options.coverage ? { coveragePath: options.coverage } : {}),
    });
    const text = explainChange(assessment);
    emit(Boolean(options.json), { assessment, explanation: text }, text);
    return EXIT_CODES.SUCCESS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    return EXIT_CODES.INTERNAL_ERROR;
  }
}

export async function runChangeDiffCommand(options: {
  root: string;
  since?: string;
  changeId?: string;
  json?: boolean;
}): Promise<number> {
  try {
    const diff = await diffChange({
      root: options.root,
      ...(options.since ? { since: options.since } : {}),
      ...(options.changeId ? { changeId: options.changeId } : {}),
    });
    emit(
      Boolean(options.json),
      diff,
      [
        `Change diff${diff.changeId ? ` (${diff.changeId})` : ""}`,
        `  base → target: ${diff.baseRevision ?? "(wt)"} → ${diff.targetRevision ?? "?"}`,
        `  files: +${diff.summary.added} ~${diff.summary.modified} -${diff.summary.deleted} ?${diff.summary.untracked}`,
        diff.stat ? `\n${diff.stat}` : "  (no git --stat output)",
      ].join("\n"),
    );
    return EXIT_CODES.SUCCESS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    return EXIT_CODES.INTERNAL_ERROR;
  }
}

export async function runChangeStatusCommand(options: {
  root: string;
  changeId?: string;
  json?: boolean;
}): Promise<number> {
  try {
    const status = await changeStatus({
      root: options.root,
      ...(options.changeId ? { changeId: options.changeId } : {}),
    });
    emit(
      Boolean(options.json),
      status,
      [
        `Change status${status.changeId ? `: ${status.changeId}` : " (no evidence)"}`,
        `  evidence: ${status.evidencePresent ? status.evidenceDirectory : "none"}`,
        `  verificationStatus: ${status.verificationStatus}`,
        `  proof: ${status.proofPresent ? status.proofId : "none"}`,
        `  note: ${status.integrityNote}`,
      ].join("\n"),
    );
    return EXIT_CODES.SUCCESS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    return EXIT_CODES.INTERNAL_ERROR;
  }
}

export async function runEvidenceInspectCommand(options: {
  root: string;
  changeId: string;
  json?: boolean;
}): Promise<number> {
  const result = await inspectEvidence({ root: options.root, changeId: options.changeId });
  if (!result.ok) {
    process.stderr.write(`Error: ${result.error ?? "evidence not found"}\n`);
    return EXIT_CODES.USAGE_ERROR;
  }
  emit(
    Boolean(options.json),
    result,
    [
      `Evidence ${options.changeId}`,
      `  directory: ${result.directory}`,
      `  files: ${result.presentFiles.join(", ")}`,
      `  manifestStatus: ${result.manifest?.verificationStatus ?? "missing"}`,
    ].join("\n"),
  );
  return EXIT_CODES.SUCCESS;
}

export async function runEvidenceVerifyCommand(options: {
  root: string;
  changeId: string;
  json?: boolean;
}): Promise<number> {
  const result = await verifyEvidence({ root: options.root, changeId: options.changeId });
  emit(
    Boolean(options.json),
    result,
    [
      `Evidence verify ${options.changeId}`,
      `  status: ${result.verificationStatus}`,
      ...result.checked.map((c) => `  ${c.match ? "OK" : "FAIL"} ${c.name}`),
    ].join("\n"),
  );
  if (!result.ok) {
    return EXIT_CODES.ISSUES_OR_THRESHOLD;
  }
  return EXIT_CODES.SUCCESS;
}

export async function runProofBuildCommand(options: {
  root: string;
  changeId: string;
  json?: boolean;
}): Promise<number> {
  try {
    const proof = await buildProofFromEvidence(options.root, options.changeId);
    emit(
      Boolean(options.json),
      proof,
      [
        `ChangeProof ${proof.proofId}`,
        `  changeId: ${proof.changeId}`,
        `  integrityStatus: ${proof.integrityStatus}`,
        `  engineeringChecksStatus: ${proof.engineeringChecksStatus}`,
        `  verificationState: ${proof.verificationState}`,
        `  correctnessStatus: ${proof.correctnessStatus}`,
      ].join("\n"),
    );
    return EXIT_CODES.SUCCESS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    return EXIT_CODES.INTERNAL_ERROR;
  }
}

export async function runProofInspectCommand(options: {
  root: string;
  id: string;
  json?: boolean;
}): Promise<number> {
  const result = await inspectProof(options.root, options.id);
  if (!result.ok || !result.proof) {
    process.stderr.write(`Error: ${result.error ?? "proof not found"}\n`);
    return EXIT_CODES.USAGE_ERROR;
  }
  emit(
    Boolean(options.json),
    result,
    [
      `Proof ${result.proof.proofId}`,
      `  changeId: ${result.proof.changeId}`,
      `  integrityStatus: ${result.proof.integrityStatus}`,
      `  engineeringChecksStatus: ${result.proof.engineeringChecksStatus}`,
      `  verificationState: ${result.proof.verificationState}`,
      `  correctnessStatus: ${result.proof.correctnessStatus}`,
      `  path: ${result.path}`,
    ].join("\n"),
  );
  return EXIT_CODES.SUCCESS;
}

export async function runProofExplainCommand(options: {
  root: string;
  id: string;
  json?: boolean;
}): Promise<number> {
  const result = await inspectProof(options.root, options.id);
  if (!result.ok || !result.proof) {
    process.stderr.write(`Error: ${result.error ?? "proof not found"}\n`);
    return EXIT_CODES.USAGE_ERROR;
  }
  const text = explainProof(result.proof);
  emit(Boolean(options.json), { proof: result.proof, explanation: text }, text);
  return EXIT_CODES.SUCCESS;
}

export async function runProofVerifyCommand(options: {
  root: string;
  id: string;
  json?: boolean;
}): Promise<number> {
  const result = await verifyProof(options.root, options.id);
  emit(
    Boolean(options.json),
    result,
    [
      `Proof verify ${options.id}`,
      `  integrityStatus: ${result.integrityStatus}`,
      `  engineeringChecksStatus: ${result.engineeringChecksStatus}`,
      `  verificationState: ${result.verificationState}`,
      `  correctnessStatus: ${result.correctnessStatus}`,
      ...result.checked.map((c) => `  ${c.match ? "OK" : "FAIL"} ${c.name}`),
    ].join("\n"),
  );
  return result.ok ? EXIT_CODES.SUCCESS : EXIT_CODES.ISSUES_OR_THRESHOLD;
}

export async function runProofExportCommand(options: {
  root: string;
  id: string;
  out: string;
  json?: boolean;
}): Promise<number> {
  const result = await exportProof(options.root, options.id, options.out);
  if (!result.ok) {
    process.stderr.write(`Error: ${result.error ?? "export failed"}\n`);
    return EXIT_CODES.USAGE_ERROR;
  }
  emit(Boolean(options.json), result, `Exported proof to ${result.path}`);
  return EXIT_CODES.SUCCESS;
}
