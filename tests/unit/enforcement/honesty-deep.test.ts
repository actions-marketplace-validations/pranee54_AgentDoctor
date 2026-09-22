import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runControlledCommand } from "../../../src/enforcement/runner.js";
import { evaluateAgentAction, EVALUATE_ONLY } from "../../../src/platform/index.js";

describe("Task5 enforcement honesty", () => {
  async function repo(): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ad-enforce-"));
    await fs.writeFile(path.join(root, "package.json"), '{"name":"enforce"}\n');
    return root;
  }

  it("policy evaluation alone never claims blocked-by-enforcement or executed", async () => {
    const root = await repo();
    const verdict = await evaluateAgentAction(root, {
      actionId: "eval-1",
      agentId: "test",
      timestamp: new Date().toISOString(),
      type: "shell",
      params: { command: "rm -rf /" },
      repositoryRoot: root,
    });
    expect(verdict.decision).toBe("block");
    expect(verdict.executionResult).toBe("not-executed");
    expect(EVALUATE_ONLY.toLowerCase()).toContain("evaluate-only");
  });

  it("controlled runner reports blocked-by-enforcement only for block decisions", async () => {
    const root = await repo();

    const blocked = await runControlledCommand({ root, command: "rm -rf /tmp/agentdoctor-demo" });
    expect(blocked.decision.decision).toBe("block");
    expect(blocked.enforced).toBe(true);
    expect(blocked.decision.executionStatus).toBe("blocked-by-enforcement");
    expect(blocked.notice).toMatch(/Blocked by AgentDoctor-controlled runner/i);

    const allowed = await runControlledCommand({ root, command: "npm test" });
    expect(allowed.decision.decision).toBe("allow");
    expect(allowed.enforced).toBe(false);
    expect(allowed.decision.executionStatus).toBe("not-executed");
    expect(allowed.notice).toMatch(/did not execute/i);

    const approval = await runControlledCommand({ root, command: "git push --force origin main" });
    expect(approval.decision.decision).toBe("require-approval");
    expect(approval.enforced).toBe(false);
    expect(approval.decision.executionStatus).toBe("not-executed");
    expect(approval.decision.approvalStatus).toBe("pending");
  });

  it("executeIfAllowed still does not execute in this release (honest not-executed)", async () => {
    const root = await repo();
    const result = await runControlledCommand({
      root,
      command: "npm test",
      executeIfAllowed: true,
    });
    expect(result.decision.decision).toBe("allow");
    expect(result.decision.executionStatus).toBe("not-executed");
  });
});
