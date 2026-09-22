import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import {
  verifyChange,
  changeStatus,
  explainChange,
  analyzeChange,
} from "../../../src/assurance/change.js";
import {
  buildProofFromEvidence,
  explainProof,
  exportProof,
  inspectProof,
  verifyProof,
} from "../../../src/assurance/proof.js";

async function tempGitRepo(withArchitecture = false): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentdoctor-proof-"));
  await fs.chmod(root, 0o700);
  const run = (args: string[]) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git failed: ${r.stderr}`);
  };
  run(["init"]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "Test"]);
  await fs.writeFile(path.join(root, "package.json"), '{"name":"t","version":"0.0.0"}\n');
  await fs.mkdir(path.join(root, "src", "core"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "cli"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "core", "a.ts"), "export const a = 1;\n");
  await fs.writeFile(
    path.join(root, "src", "cli", "b.ts"),
    'import { a } from "../core/a";\nexport const b = a;\n',
  );
  if (withArchitecture) {
    await fs.mkdir(path.join(root, ".agentdoctor"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".agentdoctor", "architecture.json"),
      JSON.stringify({
        version: "1",
        layers: [
          { id: "cli", paths: ["src/cli/"] },
          { id: "core", paths: ["src/core/"] },
        ],
        forbidden: [],
        allowed: [{ fromLayer: "cli", toLayer: "core" }],
      }),
    );
  }
  run(["add", "."]);
  run(["commit", "-m", "init"]);
  await fs.writeFile(path.join(root, "src", "core", "a.ts"), "export const a = 2;\n");
  return root;
}

describe("ChangeProof", () => {
  it("builds proof with integrity verified and correctness never claimed", async () => {
    const root = await tempGitRepo();
    try {
      const { assessment } = await verifyChange({ root });
      const proof = await buildProofFromEvidence(root, assessment.changeId);
      expect(proof.proofId.startsWith("prf_")).toBe(true);
      expect(proof.correctnessStatus).toBe("ENGINEERING_CORRECTNESS_NOT_CLAIMED");
      expect(proof.integrityStatus).toBe("HASH_INTEGRITY_VERIFIED");
      expect(proof.hashes.proofContentSha256.length).toBe(64);
      expect(proof.engineeringChecksStatus).toBe("INSUFFICIENT_EVIDENCE");
      expect(proof.verificationState).toBe("INSUFFICIENT_EVIDENCE");

      const inspected = await inspectProof(root, assessment.changeId);
      expect(inspected.ok).toBe(true);
      expect(inspected.proof?.changeId).toBe(assessment.changeId);

      const verified = await verifyProof(root, proof.proofId);
      expect(verified.ok).toBe(true);
      expect(verified.integrityStatus).toBe("HASH_INTEGRITY_VERIFIED");
      expect(verified.correctnessStatus).toBe("ENGINEERING_CORRECTNESS_NOT_CLAIMED");

      const text = explainProof(proof);
      expect(text).toContain(proof.proofId);
      expect(text.toLowerCase()).toContain("integrity");
      expect(text.toLowerCase()).toContain("not that the change is correct");

      const out = path.join(root, "exported-proof.json");
      const exported = await exportProof(root, proof.proofId, out);
      expect(exported.ok).toBe(true);
      const raw = await fs.readFile(out, "utf8");
      expect(JSON.parse(raw).proofId).toBe(proof.proofId);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("runs engineering checks when architecture contract exists", async () => {
    const root = await tempGitRepo(true);
    try {
      const { assessment } = await verifyChange({ root });
      const proof = await buildProofFromEvidence(root, assessment.changeId);
      expect(proof.integrityStatus).toBe("HASH_INTEGRITY_VERIFIED");
      expect(["PASSED", "FAILED"]).toContain(proof.engineeringChecksStatus);
      expect(["ENGINEERING_CHECKS_PASSED", "ENGINEERING_CHECKS_FAILED"]).toContain(
        proof.verificationState,
      );
      expect(proof.correctnessStatus).toBe("ENGINEERING_CORRECTNESS_NOT_CLAIMED");
      expect(proof.engineeringChecks?.architecture.contractPresent).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("detects evidence tampering as integrity failure", async () => {
    const root = await tempGitRepo();
    try {
      const { assessment } = await verifyChange({ root });
      const proof = await buildProofFromEvidence(root, assessment.changeId);
      expect(proof.integrityStatus).toBe("HASH_INTEGRITY_VERIFIED");

      const changeJson = path.join(
        root,
        ".agentdoctor",
        "evidence",
        assessment.changeId,
        "change.json",
      );
      const original = await fs.readFile(changeJson, "utf8");
      await fs.writeFile(changeJson, `${original.slice(0, -2)}\n  ,"tampered": true\n}\n`);

      const verified = await verifyProof(root, proof.proofId);
      expect(verified.ok).toBe(false);
      expect(verified.integrityStatus).toBe("HASH_INTEGRITY_FAILED");
      expect(verified.correctnessStatus).toBe("ENGINEERING_CORRECTNESS_NOT_CLAIMED");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("change explain and status surface honest labels", async () => {
    const root = await tempGitRepo();
    try {
      const { assessment } = await verifyChange({ root });
      const text = explainChange(assessment);
      expect(text).toContain(assessment.changeId);
      expect(text.toLowerCase()).toContain("does not prove correctness");

      const status = await changeStatus({ root, changeId: assessment.changeId });
      expect(status.evidencePresent).toBe(true);
      expect(status.proofPresent).toBe(true);
      expect(status.verificationStatus).toBe("verified");

      const draft = await analyzeChange({ root });
      expect(draft.verificationStatus).toBe("not-run");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
