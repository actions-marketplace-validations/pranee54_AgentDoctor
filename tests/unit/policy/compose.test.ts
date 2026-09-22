import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { composePolicy } from "../../../src/policy/compose.js";

describe("policy composition", () => {
  it("uses builtin when repo policy missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ad-pol-"));
    try {
      const result = await composePolicy({ root, packName: "baseline-safe" });
      expect(result.sources).toEqual(["builtin"]);
      expect(result.policy.rules.length).toBeGreaterThan(0);
      expect(result.failClosed).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("merges repo policy with precedence and fail-closes on malformed", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ad-pol2-"));
    try {
      await fs.mkdir(path.join(root, ".agentdoctor"), { recursive: true });
      await fs.writeFile(
        path.join(root, ".agentdoctor", "policy.json"),
        JSON.stringify({
          version: "2.0",
          defaultDecision: "block",
          failClosed: true,
          rules: [
            {
              id: "repo-block-curl",
              actionTypes: ["shell"],
              match: { commandContains: ["curl"] },
              decision: "block",
              reason: "repo: no curl",
              riskLevel: "high",
            },
          ],
        }),
      );
      const ok = await composePolicy({ root });
      expect(ok.sources).toEqual(["builtin", "repo"]);
      expect(ok.policy.rules[0]?.id).toBe("repo-block-curl");
      expect(ok.failClosed).toBe(true);

      await fs.writeFile(path.join(root, ".agentdoctor", "policy.json"), "{not-json");
      const bad = await composePolicy({ root });
      expect(bad.failClosed).toBe(true);
      expect(bad.validationError).toMatch(/Malformed/i);
      expect(bad.policy.defaultDecision).toBe("block");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
