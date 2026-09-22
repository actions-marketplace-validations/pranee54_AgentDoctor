import { createHash, randomUUID } from "node:crypto";

import type { KnowledgeRecordContract, KnowledgeStatus } from "../contracts/index.js";
import type { StorageProvider } from "../contracts/index.js";
import { FilesystemStorageProvider } from "../storage/provider.js";
import { resolveRepoRoot } from "../utils/path.js";

function kid(title: string): string {
  return `know_${createHash("sha1").update(title).digest("hex").slice(0, 12)}`;
}

export async function createKnowledgeRecord(options: {
  root: string;
  title: string;
  content: string;
  status?: KnowledgeStatus;
  owner?: string;
  storage?: StorageProvider;
}): Promise<KnowledgeRecordContract> {
  const storage =
    options.storage ?? new FilesystemStorageProvider(options.root, ".agentdoctor/knowledge");
  const record: KnowledgeRecordContract = {
    id: kid(`${options.title}:${randomUUID()}`),
    title: options.title,
    content: options.content,
    status: options.status ?? "draft",
    owner: options.owner ?? null,
    approver: null,
    version: "1",
    evidence: [
      {
        id: "ev_create",
        kind: "proposed",
        detail: "Created via knowledge governance API",
      },
    ],
    relatedRepositoryId: resolveRepoRoot(options.root),
    changeHistory: [
      {
        at: new Date().toISOString(),
        note: "created",
        to: options.status ?? "draft",
        ...(options.owner ? { by: options.owner } : {}),
      },
    ],
  };
  await storage.set(`records/${record.id}.json`, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

export async function transitionKnowledge(options: {
  root: string;
  id: string;
  to: KnowledgeStatus;
  by?: string;
  note?: string;
  storage?: StorageProvider;
}): Promise<KnowledgeRecordContract> {
  const storage =
    options.storage ?? new FilesystemStorageProvider(options.root, ".agentdoctor/knowledge");
  const raw = await storage.get(`records/${options.id}.json`);
  if (!raw) throw new Error(`knowledge record not found: ${options.id}`);
  const record = JSON.parse(raw) as KnowledgeRecordContract;
  const from = record.status;
  // Authority: only pending-review/draft/proposed can become approved via explicit transition
  if (options.to === "approved" && !["draft", "proposed", "pending-review"].includes(from)) {
    throw new Error(`cannot approve from status ${from}`);
  }
  record.status = options.to;
  if (options.to === "approved") {
    record.approver = options.by ?? "local-approver";
    record.effectiveAt = new Date().toISOString();
  }
  record.changeHistory.push({
    at: new Date().toISOString(),
    note: options.note ?? `transition ${from} -> ${options.to}`,
    from,
    to: options.to,
    ...(options.by ? { by: options.by } : {}),
  });
  record.version = String(Number(record.version || "1") + 1);
  await storage.set(`records/${record.id}.json`, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

export async function listKnowledge(
  root: string,
  storage?: StorageProvider,
): Promise<KnowledgeRecordContract[]> {
  const store = storage ?? new FilesystemStorageProvider(root, ".agentdoctor/knowledge");
  const keys = await store.list("records");
  const out: KnowledgeRecordContract[] = [];
  for (const key of keys) {
    if (!key.endsWith(".json")) continue;
    const raw = await store.get(key.startsWith("records/") ? key : `records/${key}`);
    if (!raw) continue;
    out.push(JSON.parse(raw) as KnowledgeRecordContract);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Authoritative retrieval abstains when no approved record matches. */
export function retrieveAuthoritative(
  records: KnowledgeRecordContract[],
  query: string,
): { record: KnowledgeRecordContract | null; abstain: boolean; reason: string } {
  const q = query.toLowerCase();
  const approved = records.filter(
    (r) =>
      r.status === "approved" &&
      (r.title.toLowerCase().includes(q) || r.content.toLowerCase().includes(q)),
  );
  if (approved.length === 0) {
    return {
      record: null,
      abstain: true,
      reason: "No approved authoritative knowledge matched the query",
    };
  }
  return { record: approved[0]!, abstain: false, reason: "approved match" };
}
