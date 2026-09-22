import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

import { resolveRepoRoot, isPathInsideRoot } from "../../utils/path.js";
import { atomicWriteTextFile } from "../../utils/fs.js";
import type { KnowledgeStatus } from "../../contracts/index.js";

export interface ProjectInitAnswers {
  projectName: string;
  projectType: string;
  businessDomain: string;
  languages: string[];
  frameworks: string[];
  database: string;
  deploymentModel: string;
  teamStructure: string;
  securityRequirements: string;
  preferredArchitecture: string;
  aiAgentEnvironments: string[];
}

export interface BrainProposalArtifact {
  id: string;
  kind: string;
  title: string;
  path: string;
  status: KnowledgeStatus;
  content: string;
}

export interface BrainReviewItem {
  id: string;
  artifactId: string;
  status: KnowledgeStatus;
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
}

function proposalsDir(root: string): string {
  return path.join(resolveRepoRoot(root), ".agentdoctor", "repository-brain", "proposals");
}

function reviewFile(root: string): string {
  return path.join(resolveRepoRoot(root), ".agentdoctor", "repository-brain", "reviews.json");
}

export async function ensureRepositoryBrainDirs(rootInput: string): Promise<string> {
  const root = resolveRepoRoot(rootInput);
  const base = path.join(root, ".agentdoctor", "repository-brain");
  await fs.mkdir(path.join(base, "proposals"), { recursive: true });
  await fs.mkdir(path.join(base, "snapshots"), { recursive: true });
  return base;
}

/** Generate draft proposal artifacts — never auto-approved. */
export async function runProjectInit(
  rootInput: string,
  answers: Partial<ProjectInitAnswers>,
): Promise<{ root: string; artifacts: BrainProposalArtifact[] }> {
  const root = resolveRepoRoot(rootInput);
  await ensureRepositoryBrainDirs(root);
  const filled: ProjectInitAnswers = {
    projectName: answers.projectName ?? path.basename(root),
    projectType: answers.projectType ?? "application",
    businessDomain: answers.businessDomain ?? "unknown",
    languages: answers.languages?.length ? answers.languages : ["typescript"],
    frameworks: answers.frameworks ?? [],
    database: answers.database ?? "unknown",
    deploymentModel: answers.deploymentModel ?? "unknown",
    teamStructure: answers.teamStructure ?? "unknown",
    securityRequirements: answers.securityRequirements ?? "local-first; no secrets in VCS",
    preferredArchitecture: answers.preferredArchitecture ?? "modular-monolith",
    aiAgentEnvironments: answers.aiAgentEnvironments?.length
      ? answers.aiAgentEnvironments
      : ["cursor", "claude-code"],
  };

  const docs: Array<{ kind: string; title: string; body: string }> = [
    {
      kind: "architecture-overview",
      title: "Architecture overview (proposed)",
      body: `# Architecture overview\n\nStatus: **proposed** (not approved)\n\nProject: ${filled.projectName}\nType: ${filled.projectType}\nPreferred architecture: ${filled.preferredArchitecture}\nLanguages: ${filled.languages.join(", ")}\nFrameworks: ${filled.frameworks.join(", ") || "(none specified)"}\n\nThis document is AI/tool-generated scaffolding. Human review required before treating as fact.\n`,
    },
    {
      kind: "business-domain-map",
      title: "Business domain map (proposed)",
      body: `# Business domain map\n\nPrimary domain: ${filled.businessDomain}\n\n- Core domain: ${filled.businessDomain}\n- Supporting domains: (to be filled during review)\n\nStatus: **proposed**\n`,
    },
    {
      kind: "feature-map",
      title: "Feature map (proposed)",
      body: `# Feature map\n\n1. Core product workflows for ${filled.projectName}\n2. Operator / admin surfaces\n3. Integrations\n\nStatus: **proposed**\n`,
    },
    {
      kind: "module-plan",
      title: "Module plan (proposed)",
      body: `# Module plan\n\nSuggested modules (review before creating):\n- \`core\` — domain logic\n- \`api\` — HTTP / CLI surfaces\n- \`infra\` — persistence / adapters\n\nStatus: **proposed**\n`,
    },
    {
      kind: "folder-structure",
      title: "Folder structure proposal",
      body: `# Folder structure\n\n\`\`\`\nsrc/\n  core/\n  adapters/\n  cli/\ntests/\ndocs/\n\`\`\`\n\nStatus: **proposed**\n`,
    },
    {
      kind: "domain-model",
      title: "Domain model (proposed)",
      body: `# Domain model\n\nEntities TBD for domain **${filled.businessDomain}**.\n\nStatus: **proposed**\n`,
    },
    {
      kind: "api-proposal",
      title: "API proposal",
      body: `# API proposal\n\nLocal-first CLI and optional HTTP API. No public cloud assumed.\n\nStatus: **proposed**\n`,
    },
    {
      kind: "data-model",
      title: "Data model proposal",
      body: `# Data model\n\nDatabase preference: ${filled.database}\nDefault local store: filesystem JSON under \`.agentdoctor/\`.\n\nStatus: **proposed**\n`,
    },
    {
      kind: "coding-standards",
      title: "Coding standards (proposed)",
      body: `# Coding standards\n\n- TypeScript strict\n- Deterministic analysis where claimed\n- No secrets in logs\n\nStatus: **proposed**\n`,
    },
    {
      kind: "security-rules",
      title: "Security rules (proposed)",
      body: `# Security rules\n\nRequirements: ${filled.securityRequirements}\nDeployment: ${filled.deploymentModel}\n\nStatus: **proposed**\n`,
    },
    {
      kind: "ai-agent-instructions",
      title: "AI agent instructions (proposed)",
      body: `# AI agent instructions\n\nEnvironments: ${filled.aiAgentEnvironments.join(", ")}\n\n- Prefer Project Brain / MCP evidence over guessing\n- Never treat proposed docs as approved facts\n\nStatus: **proposed**\n`,
    },
    {
      kind: "testing-strategy",
      title: "Testing strategy (proposed)",
      body: `# Testing strategy\n\n- Unit + integration + CLI smoke\n- Hostile input / path traversal cases\n\nStatus: **proposed**\n`,
    },
    {
      kind: "deployment-assumptions",
      title: "Deployment assumptions (proposed)",
      body: `# Deployment assumptions\n\nModel: ${filled.deploymentModel}\nTeam: ${filled.teamStructure}\n\nStatus: **proposed**\n`,
    },
    {
      kind: "adr-0001",
      title: "ADR-0001 Local-first storage",
      body: `# ADR-0001: Local-first storage\n\n## Status\nproposed\n\n## Context\nAgentDoctor must work offline.\n\n## Decision\nFilesystem under \`.agentdoctor/\` is default; SQLite/Postgres optional.\n\n## Consequences\nNo cloud required for core operation.\n`,
    },
  ];

  const artifacts: BrainProposalArtifact[] = [];
  const dir = proposalsDir(root);
  for (const doc of docs) {
    const id = `prop_${createHash("sha1").update(doc.kind).digest("hex").slice(0, 10)}`;
    const rel = `${doc.kind}.md`;
    const absolute = path.join(dir, rel);
    if (!isPathInsideRoot(dir, absolute)) throw new Error("proposal path escape");
    await atomicWriteTextFile(absolute, doc.body);
    artifacts.push({
      id,
      kind: doc.kind,
      title: doc.title,
      path: path.posix.join(".agentdoctor/repository-brain/proposals", rel),
      status: "proposed",
      content: doc.body,
    });
  }

  const meta = {
    version: "2.0",
    createdAt: new Date().toISOString(),
    answers: filled,
    artifactIds: artifacts.map((a) => a.id),
    notice: "All init artifacts are proposed/draft — not approved facts",
  };
  await atomicWriteTextFile(
    path.join(root, ".agentdoctor", "repository-brain", "init.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
  );

  return { root, artifacts };
}

export async function listProposals(rootInput: string): Promise<BrainProposalArtifact[]> {
  const root = resolveRepoRoot(rootInput);
  const dir = proposalsDir(root);
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return [];
  }
  const out: BrainProposalArtifact[] = [];
  const reviews = await loadReviews(root);
  for (const file of files) {
    const content = await fs.readFile(path.join(dir, file), "utf8");
    const kind = file.replace(/\.md$/, "");
    const id = `prop_${createHash("sha1").update(kind).digest("hex").slice(0, 10)}`;
    const review = reviews.find((r) => r.artifactId === id);
    out.push({
      id,
      kind,
      title: kind,
      path: `.agentdoctor/repository-brain/proposals/${file}`,
      status: review?.status ?? "proposed",
      content,
    });
  }
  return out;
}

async function loadReviews(root: string): Promise<BrainReviewItem[]> {
  try {
    const raw = await fs.readFile(reviewFile(root), "utf8");
    const parsed = JSON.parse(raw) as { items?: BrainReviewItem[] };
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

export async function reviewProposal(options: {
  root: string;
  artifactId: string;
  decision: "approved" | "rejected" | "pending-review" | "deprecated";
  by?: string;
  note?: string;
}): Promise<BrainReviewItem> {
  const root = resolveRepoRoot(options.root);
  await ensureRepositoryBrainDirs(root);
  const items = await loadReviews(root);
  const item: BrainReviewItem = {
    id: randomUUID(),
    artifactId: options.artifactId,
    status: options.decision,
    decidedBy: options.by ?? "local-reviewer",
    decidedAt: new Date().toISOString(),
    ...(options.note ? { note: options.note } : {}),
  };
  const next = [...items.filter((i) => i.artifactId !== options.artifactId), item];
  await atomicWriteTextFile(
    reviewFile(root),
    `${JSON.stringify({ version: "2.0", items: next }, null, 2)}\n`,
  );

  // Keep proposal markdown status in sync with the review decision.
  const proposals = await listProposals(root);
  const match = proposals.find((p) => p.id === options.artifactId);
  if (match) {
    const abs = path.join(root, match.path);
    if (isPathInsideRoot(root, abs)) {
      let content = await fs.readFile(abs, "utf8");
      const statusLine = `Status: **${options.decision}**`;
      if (/Status:\s*\*\*[^*]+\*\*/.test(content)) {
        content = content.replace(/Status:\s*\*\*[^*]+\*\*[^\n]*/g, statusLine);
      } else {
        content = `${statusLine}\n\n${content}`;
      }
      // Drop stale "not approved" parenthetical if present after replacement edge cases
      content = content.replace(/\s*\(not approved\)/g, "");
      await atomicWriteTextFile(abs, content.endsWith("\n") ? content : `${content}\n`);
    }
  }

  return item;
}

export async function writeBrainProductSnapshot(rootInput: string): Promise<string> {
  const root = resolveRepoRoot(rootInput);
  await ensureRepositoryBrainDirs(root);
  const proposals = await listProposals(root);
  const id = `rbs_${Date.now().toString(36)}`;
  const snapshot = {
    id,
    version: "2.0",
    createdAt: new Date().toISOString(),
    proposals: proposals.map((p) => ({
      id: p.id,
      kind: p.kind,
      status: p.status,
      path: p.path,
    })),
    notice: "Proposal statuses are human-reviewed when present; otherwise proposed/draft",
  };
  const target = path.join(root, ".agentdoctor", "repository-brain", "snapshots", `${id}.json`);
  await atomicWriteTextFile(target, `${JSON.stringify(snapshot, null, 2)}\n`);
  await atomicWriteTextFile(
    path.join(root, ".agentdoctor", "repository-brain", "snapshots", "latest.json"),
    `${JSON.stringify(snapshot, null, 2)}\n`,
  );
  return target;
}
