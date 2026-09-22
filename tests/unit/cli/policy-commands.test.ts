import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  runPolicyCheckCommand,
  runPolicyEnforceCommand,
  runPolicyExplainCommand,
} from "../../../src/cli/commands/policy-graph-run.js";
import { EXIT_CODES } from "../../../src/types/index.js";

async function repo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ad-policy-cli-"));
  await fs.writeFile(path.join(root, "package.json"), '{"name":"p"}\n');
  const platform = path.join(root, ".agentdoctor", "platform");
  await fs.mkdir(platform, { recursive: true });
  await fs.writeFile(
    path.join(platform, "firewall-policy.json"),
    JSON.stringify({
      version: "2.0",
      defaultDecision: "require-approval",
      shellAllowlist: ["npm --version"],
      rules: [],
    }),
  );
  return root;
}

describe("policy CLI commands", () => {
  it("check / explain / enforce evaluate without execute by default", async () => {
    const root = await repo();
    try {
      const check = await runPolicyCheckCommand({
        root,
        command: "npm --version",
        json: true,
      });
      expect(check).toBe(EXIT_CODES.SUCCESS);

      const explain = await runPolicyExplainCommand({
        root,
        command: "rm -rf /tmp/x",
        json: true,
      });
      expect(explain).toBe(EXIT_CODES.SUCCESS);

      const enforce = await runPolicyEnforceCommand({
        root,
        command: "npm --version",
        execute: false,
        json: true,
      });
      expect(enforce).toBe(EXIT_CODES.SUCCESS);

      const enforceExec = await runPolicyEnforceCommand({
        root,
        command: "npm --version",
        execute: true,
        json: true,
      });
      expect(enforceExec).toBe(EXIT_CODES.SUCCESS);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
