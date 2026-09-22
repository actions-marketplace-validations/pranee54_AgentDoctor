import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  INTELLIGENCE_MCP_TOOL_NAMES,
  invokeIntelligenceMcpTool,
  listIntelligenceMcpTools,
} from "../../../src/mcp/intelligence/registry.js";
import { BRAIN_MCP_TOOL_NAMES } from "../../../src/mcp/brain/tools/registry.js";
import { listPolicyPacks, getPolicyPack } from "../../../src/policy/packs.js";
import { collectOpsHealth } from "../../../src/ops/health.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("intelligence MCP + policy packs + ops", () => {
  it("lists intelligence tools without colliding with brain names", () => {
    const tools = listIntelligenceMcpTools();
    expect(tools.length).toBe(INTELLIGENCE_MCP_TOOL_NAMES.length);
    const brain = new Set<string>(BRAIN_MCP_TOOL_NAMES);
    for (const name of INTELLIGENCE_MCP_TOOL_NAMES) {
      expect(brain.has(name)).toBe(false);
    }
  });

  it(
    "repo_overview returns structured result",
    async () => {
      const { structured, isError } = await invokeIntelligenceMcpTool(repoRoot, "repo_overview", {});
      expect(isError).toBe(false);
      expect(structured).toMatchObject({ ok: true });
    },
    30_000,
  );

  it("policy_evaluate never claims execution", async () => {
    const { structured, isError } = await invokeIntelligenceMcpTool(repoRoot, "policy_evaluate", {
      command: "rm -rf /",
    });
    expect(isError).toBe(false);
    const body = structured as { executionResult?: string; verdict?: { executionResult?: string } };
    expect(body.executionResult).toBe("not-executed");
  });

  it("exposes named policy packs", () => {
    expect(listPolicyPacks()).toContain("baseline-safe");
    expect(getPolicyPack("fail-closed-ci")?.failClosed).toBe(true);
  });

  it("ops health reports version and flags", async () => {
    const health = await collectOpsHealth(repoRoot);
    expect(health.ok).toBe(true);
    expect(health.contractsVersion).toBeTruthy();
    expect(health.featureFlags.typescriptAst).toBeDefined();
  });
});
