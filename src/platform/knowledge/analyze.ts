import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { resolveRepoRoot, toPosixRelative } from "../../utils/path.js";
import type { PlatformFinding } from "../types.js";

export interface KnowledgeSource {
  id: string;
  path: string;
  sourceType: "readme" | "docs" | "agent-instructions" | "other";
  mtime: string;
  sizeBytes: number;
  trustLevel: "high" | "medium" | "low" | "unverified";
  owner: string | null;
}

export interface KnowledgeReport {
  root: string;
  sources: KnowledgeSource[];
  findings: PlatformFinding[];
  limitations: string[];
}

/**
 * Module G — Knowledge governance MVP.
 */
export async function analyzeKnowledgeGovernance(rootInput: string): Promise<KnowledgeReport> {
  const root = resolveRepoRoot(rootInput);
  const sources: KnowledgeSource[] = [];
  const findings: PlatformFinding[] = [];
  const docs: string[] = [];

  async function consider(rel: string, sourceType: KnowledgeSource["sourceType"]): Promise<void> {
    const absolute = path.join(root, rel);
    try {
      const st = await fs.stat(absolute);
      if (!st.isFile()) return;
      const id = `know_${createHash("sha1").update(rel).digest("hex").slice(0, 10)}`;
      const ageDays = (Date.now() - st.mtimeMs) / (86400 * 1000);
      const trust: KnowledgeSource["trustLevel"] =
        sourceType === "readme" ? "medium" : ageDays > 365 ? "low" : "unverified";
      sources.push({
        id,
        path: rel,
        sourceType,
        mtime: st.mtime.toISOString(),
        sizeBytes: st.size,
        trustLevel: trust,
        owner: null,
      });
      docs.push(rel);
      if (ageDays > 365) {
        findings.push({
          id: `know_stale_${id}`,
          module: "knowledge",
          severity: "low",
          title: "Stale documentation",
          message: `${rel} last modified ${Math.floor(ageDays)} days ago`,
          recommendation: "Review for accuracy against current code",
          confidence: 0.8,
          evidence: [{ kind: "verified", path: rel, detail: `mtime=${st.mtime.toISOString()}` }],
        });
      }
      if (st.size === 0) {
        findings.push({
          id: `know_empty_${id}`,
          module: "knowledge",
          severity: "medium",
          title: "Empty documentation file",
          message: rel,
          recommendation: "Fill or remove empty docs",
          confidence: 1,
          evidence: [{ kind: "verified", path: rel, detail: "size=0" }],
        });
      }
    } catch {
      // missing
    }
  }

  await consider("README.md", "readme");
  await consider("AGENTS.md", "agent-instructions");
  await consider("CLAUDE.md", "agent-instructions");
  await consider("docs/README.md", "docs");

  try {
    const docsDir = path.join(root, "docs");
    const entries = await fs.readdir(docsDir);
    for (const e of entries.filter((x) => x.endsWith(".md")).slice(0, 40)) {
      await consider(toPosixRelative(root, path.join(docsDir, e)), "docs");
    }
  } catch {
    // optional
  }

  if (sources.filter((s) => s.owner === null).length === sources.length && sources.length > 0) {
    findings.push({
      id: "know_no_owners",
      module: "knowledge",
      severity: "info",
      title: "No documentation owners detected",
      message: "CODEOWNERS/MAINTAINERS not linked to knowledge sources in this MVP",
      recommendation: "Add CODEOWNERS entries for docs/",
      confidence: 0.6,
      evidence: [{ kind: "unknown", detail: "owner metadata unavailable" }],
    });
  }

  return {
    root,
    sources: sources.sort((a, b) => a.path.localeCompare(b.path)),
    findings: findings.sort((a, b) => a.id.localeCompare(b.id)),
    limitations: [
      "Contradiction detection between docs and code is limited in this MVP",
      "Ownership requires CODEOWNERS integration (extension point)",
    ],
  };
}
