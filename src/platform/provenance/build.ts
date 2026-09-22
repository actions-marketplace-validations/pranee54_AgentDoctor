import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

import { writeJsonArtifact } from "../store.js";
import { resolveRepoRoot } from "../../utils/path.js";
import type { EvidenceKind } from "../types.js";

export interface ProvenanceRecord {
  id: string;
  repository: string;
  branch: string | null;
  commit: string | null;
  pullRequest: string | null;
  file: string;
  lineRange?: { start: number; end: number };
  agent: string | null;
  model: string | null;
  taskRef: string | null;
  toolCalls: string[];
  testsExecuted: string[];
  reviewer: string | null;
  approvalStatus: "unknown" | "approved" | "pending" | "rejected";
  risk: string;
  fields: Record<string, { value: string | null; kind: EvidenceKind }>;
  chain: string[];
}

function git(root: string, args: string[]): string | null {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

/**
 * Module E — AI change provenance.
 * Never fabricates missing metadata; marks unknown explicitly.
 */
export function buildProvenance(options: {
  root: string;
  file: string;
  agent?: string;
  model?: string;
  taskRef?: string;
  toolCalls?: string[];
  testsExecuted?: string[];
  reviewer?: string;
  approvalStatus?: ProvenanceRecord["approvalStatus"];
  lineStart?: number;
  lineEnd?: number;
}): ProvenanceRecord {
  const root = resolveRepoRoot(options.root);
  const commit = git(root, ["rev-parse", "HEAD"]);
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const field = (value: string | null | undefined, kind: EvidenceKind) => ({
    value: value ?? null,
    kind: value ? kind : ("unknown" as const),
  });

  const record: ProvenanceRecord = {
    id: `prov_${createHash("sha1")
      .update(`${options.file}:${commit ?? randomUUID()}`)
      .digest("hex")
      .slice(0, 12)}`,
    repository: root,
    branch,
    commit,
    pullRequest: null,
    file: options.file,
    agent: options.agent ?? null,
    model: options.model ?? null,
    taskRef: options.taskRef ?? null,
    toolCalls: options.toolCalls ?? [],
    testsExecuted: options.testsExecuted ?? [],
    reviewer: options.reviewer ?? null,
    approvalStatus: options.approvalStatus ?? "unknown",
    risk: "unknown",
    fields: {
      repository: field(root, "verified"),
      branch: field(branch, "verified"),
      commit: field(commit, "verified"),
      pullRequest: field(null, "unknown"),
      agent: field(options.agent ?? null, options.agent ? "inferred" : "unknown"),
      model: field(options.model ?? null, options.model ? "inferred" : "unknown"),
      reviewer: field(options.reviewer ?? null, options.reviewer ? "verified" : "unknown"),
    },
    chain: [
      "Request",
      options.agent ? "Agent" : "Agent(unknown)",
      "Tool calls",
      "Files changed",
      options.testsExecuted?.length ? "Tests" : "Tests(unknown)",
      options.reviewer ? "Review" : "Review(unknown)",
      commit ? "Commit" : "Commit(unknown)",
    ],
  };
  if (options.lineStart !== undefined && options.lineEnd !== undefined) {
    record.lineRange = { start: options.lineStart, end: options.lineEnd };
  }
  return record;
}

export async function saveProvenance(root: string, record: ProvenanceRecord): Promise<string> {
  return writeJsonArtifact(root, `provenance/${record.id}.json`, record);
}
