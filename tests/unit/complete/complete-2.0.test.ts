import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CONTRACTS_VERSION, clampConfidence } from "../../../src/contracts/index.js";
import { platformFindingToContract } from "../../../src/contracts/adapters.js";
import {
  runProjectInit,
  listProposals,
  reviewProposal,
} from "../../../src/core/brain-product/init.js";
import { buildIntelligenceGraph } from "../../../src/intelligence/graph/build.js";
import { deadCodeCategory, analyzeGitIntelligence } from "../../../src/intelligence/git/analyze.js";
import { buildC4Views } from "../../../src/architecture/c4.js";
import {
  createKnowledgeRecord,
  transitionKnowledge,
  retrieveAuthoritative,
  listKnowledge,
} from "../../../src/knowledge/store.js";
import { FilesystemStorageProvider, MemoryStorageProvider } from "../../../src/storage/provider.js";
import { runControlledCommand, appendAuditChain } from "../../../src/enforcement/runner.js";
import { registerLocalDevUser, authenticateLocalDev, authorize } from "../../../src/team/auth.js";

async function tempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentdoctor-complete-"));
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "complete-tmp", private: true }, null, 2),
  );
  await mkdir(path.join(dir, "src"), { recursive: true });
  await writeFile(
    path.join(dir, "src", "main.ts"),
    `export function hello(x: string): string {\n  return x;\n}\nexport class Greeter {\n  hi() { return hello("a"); }\n}\n`,
  );
  return dir;
}

describe("AgentDoctor 2.0 complete implementation", () => {
  it("shared contracts adapt platform findings", () => {
    expect(CONTRACTS_VERSION).toContain("contracts");
    expect(clampConfidence(2)).toBe(1);
    const c = platformFindingToContract({
      id: "f1",
      module: "m",
      severity: "low",
      title: "t",
      message: "m",
      recommendation: "r",
      confidence: 0.5,
      evidence: [{ kind: "verified", detail: "d", path: "a.ts", line: 1 }],
    });
    expect(c.evidence[0]?.kind).toBe("observed");
    expect(c.analysisVersion).toBe(CONTRACTS_VERSION);
  });

  it("init writes proposed artifacts and review can approve", async () => {
    const root = await tempRepo();
    try {
      const { artifacts } = await runProjectInit(root, {
        projectName: "Demo",
        businessDomain: "commerce",
      });
      expect(artifacts.length).toBeGreaterThan(5);
      expect(artifacts.every((a) => a.status === "proposed")).toBe(true);
      const listed = await listProposals(root);
      expect(listed.length).toBe(artifacts.length);
      const reviewed = await reviewProposal({
        root,
        artifactId: listed[0]!.id,
        decision: "approved",
        by: "tester",
      });
      expect(reviewed.status).toBe("approved");
      const after = await listProposals(root);
      expect(after.find((a) => a.id === listed[0]!.id)?.status).toBe("approved");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("typescript AST graph builder extracts imports and symbols", async () => {
    const root = await tempRepo();
    try {
      const graph = await buildIntelligenceGraph({ root, mode: "typescript-ast" });
      expect(graph.builder).toBe("typescript-ast");
      expect(graph.astFilesParsed).toBeGreaterThan(0);
      expect(graph.nodes.some((n) => n.kind === "function" && n.label === "hello")).toBe(true);
      expect(graph.edges.some((e) => e.kind === "imports" || e.kind === "calls")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to regex when forced", async () => {
    const root = await tempRepo();
    try {
      const graph = await buildIntelligenceGraph({ root, mode: "regex" });
      expect(graph.builder).toBe("regex");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("dead-code categories avoid unjustified certainty", () => {
    expect(
      deadCodeCategory({
        exported: true,
        referenced: false,
        frameworkEntry: false,
        dynamicHint: false,
      }).category,
    ).toBe("public-api");
    expect(
      deadCodeCategory({
        exported: false,
        referenced: false,
        frameworkEntry: true,
        dynamicHint: false,
      }).category,
    ).toBe("framework-discovered");
  });

  it("git intel degrades without git", async () => {
    const root = await tempRepo();
    try {
      const report = await analyzeGitIntelligence(root);
      expect(report.gitAvailable).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("c4 views are labeled inferred/observed", async () => {
    const root = await tempRepo();
    try {
      const graph = await buildIntelligenceGraph({ root, mode: "auto" });
      const views = buildC4Views(graph);
      expect(views.map((v) => v.level)).toContain("system-context");
      expect(views.every((v) => v.limitations.length > 0)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("knowledge governance abstains without approved records", async () => {
    const root = await tempRepo();
    try {
      const draft = await createKnowledgeRecord({
        root,
        title: "Security policy",
        content: "No secrets in git",
      });
      expect(draft.status).toBe("draft");
      const listed = await listKnowledge(root);
      const abs = retrieveAuthoritative(listed, "secrets");
      expect(abs.abstain).toBe(true);
      const approved = await transitionKnowledge({
        root,
        id: draft.id,
        to: "approved",
        by: "reviewer",
      });
      expect(approved.status).toBe("approved");
      const hit = retrieveAuthoritative(await listKnowledge(root), "secrets");
      expect(hit.abstain).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("storage providers work", async () => {
    const mem = new MemoryStorageProvider();
    await mem.set("a/b", "x");
    expect(await mem.get("a/b")).toBe("x");
    const root = await tempRepo();
    try {
      const fsStore = new FilesystemStorageProvider(root);
      await fsStore.set("k.json", '{"ok":true}\n');
      expect(await fsStore.get("k.json")).toContain("ok");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("controlled runner blocks destructive commands without executing", async () => {
    const root = await tempRepo();
    try {
      const result = await runControlledCommand({ root, command: "rm -rf /" });
      expect(result.enforced).toBe(true);
      expect(result.decision.executionStatus).toBe("blocked-by-enforcement");
      const chain = appendAuditChain(null, result.decision);
      expect(chain.hash).toHaveLength(64);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("local-dev team auth is real password auth not ?user=", async () => {
    const root = await tempRepo();
    try {
      await registerLocalDevUser({
        root,
        username: "alice",
        password: "password123",
        role: "admin",
      });
      const session = await authenticateLocalDev({
        root,
        username: "alice",
        password: "password123",
      });
      const ok = await authorize(root, session.token, "member");
      expect(ok.ok).toBe(true);
      await expect(
        authenticateLocalDev({ root, username: "alice", password: "wrong-password" }),
      ).rejects.toThrow(/invalid/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
