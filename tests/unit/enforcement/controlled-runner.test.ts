import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertArgsInsideRoot,
  parseArgv,
  runControlledCommand,
} from "../../../src/enforcement/runner.js";

async function repoWithAllowlist(allow: string[]): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ad-runner-"));
  await fs.chmod(root, 0o700);
  await fs.writeFile(path.join(root, "package.json"), '{"name":"runner"}\n');
  const platform = path.join(root, ".agentdoctor", "platform");
  await fs.mkdir(platform, { recursive: true });
  await fs.writeFile(
    path.join(platform, "firewall-policy.json"),
    JSON.stringify(
      {
        version: "2.0",
        defaultDecision: "require-approval",
        shellAllowlist: allow,
        rules: [],
      },
      null,
      2,
    ),
  );
  return root;
}

describe("controlled runner", () => {
  it("parses argv without shell", () => {
    expect(parseArgv(`npm --version`)).toEqual(["npm", "--version"]);
    expect(parseArgv(`echo "hello world"`)).toEqual(["echo", "hello world"]);
  });

  it("rejects path escape outside root", async () => {
    const root = await repoWithAllowlist(["npm --version"]);
    expect(() => assertArgsInsideRoot(["../../etc/passwd"], root)).toThrow(/path escape/);
  });

  it("allows npm --version via allowlist and executes", async () => {
    const root = await repoWithAllowlist(["npm --version", "npm -v"]);
    try {
      const result = await runControlledCommand({
        root,
        argv: ["npm", "--version"],
        executeIfAllowed: true,
      });
      expect(result.decision.decision).toBe("allow");
      expect(result.decision.executionStatus).toBe("executed");
      expect(result.stdout?.trim().length).toBeGreaterThan(0);
      const audit = await fs.readFile(
        path.join(root, ".agentdoctor", "audit", "execution.jsonl"),
        "utf8",
      );
      expect(audit).toContain("executed");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("blocks rm -rf without executing", async () => {
    const root = await repoWithAllowlist(["npm --version"]);
    try {
      const result = await runControlledCommand({
        root,
        command: "rm -rf /tmp/agentdoctor-should-not-run",
        executeIfAllowed: true,
      });
      expect(result.decision.decision).toBe("block");
      expect(result.decision.executionStatus).toBe("blocked-by-enforcement");
      expect(result.enforced).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("times out long-running commands", async () => {
    const root = await repoWithAllowlist(["node"]);
    try {
      const result = await runControlledCommand({
        root,
        argv: ["node", "-e", "while(true){}"],
        executeIfAllowed: true,
        timeoutMs: 400,
      });
      expect(result.decision.executionStatus).toBe("execution-failed");
      expect(result.notice.toLowerCase()).toMatch(/timeout|failed/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 15_000);

  it("fails path-escape args before spawn", async () => {
    const root = await repoWithAllowlist(["cat"]);
    try {
      const result = await runControlledCommand({
        root,
        argv: ["cat", "../../../etc/passwd"],
        executeIfAllowed: true,
      });
      expect(result.decision.executionStatus).toBe("execution-failed");
      expect(result.notice).toMatch(/path escape/i);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
