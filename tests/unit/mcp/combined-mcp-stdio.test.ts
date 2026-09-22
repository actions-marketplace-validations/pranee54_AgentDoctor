/**
 * Full STDIO MCP session for combined `agentdoctor mcp` (Brain + intelligence tools).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

import { BRAIN_MCP_TOOL_NAMES } from "../../../src/mcp/brain/tools/registry.js";
import { INTELLIGENCE_MCP_TOOL_NAMES } from "../../../src/mcp/intelligence/registry.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const fixtureSrc = path.join(repoRoot, "fixtures/understanding-dependencies-project");
const cliPath = path.join(repoRoot, "dist/cli/index.js");

describe("Task4 combined MCP STDIO protocol", () => {
  it("initialize → tools/list → safe tool call → clean shutdown", async () => {
    await fs.access(cliPath);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-combined-"));
    await fs.cp(fixtureSrc, root, { recursive: true });

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cliPath, "mcp", "--root", root],
      stderr: "pipe",
    });

    const client = new Client({ name: "agentdoctor-combined-mcp-test", version: "0.0.0" });
    await client.connect(transport);

    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    const expected = [...BRAIN_MCP_TOOL_NAMES, ...INTELLIGENCE_MCP_TOOL_NAMES].sort();
    expect(names).toEqual(expected);

    const overview = await client.callTool({ name: "repo_overview", arguments: {} });
    expect(overview.isError).not.toBe(true);
    const text = (overview.content as Array<{ type: string; text?: string }>).find(
      (c) => c.type === "text",
    )?.text;
    expect(text).toBeTruthy();
    const parsed = JSON.parse(String(text)) as {
      ok?: boolean;
      contractsVersion?: string;
      nodeCount?: number;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.contractsVersion).toBeTruthy();
    expect(typeof parsed.nodeCount).toBe("number");

    const policy = await client.callTool({
      name: "policy_evaluate",
      arguments: { command: "rm -rf /" },
    });
    expect(policy.isError).not.toBe(true);
    const policyText = (policy.content as Array<{ type: string; text?: string }>).find(
      (c) => c.type === "text",
    )?.text;
    const policyBody = JSON.parse(String(policyText)) as {
      executionResult?: string;
      verdict?: { executionResult?: string };
    };
    expect(policyBody.executionResult).toBe("not-executed");

    await client.close();
    await fs.rm(root, { recursive: true, force: true });
  }, 180_000);
});
