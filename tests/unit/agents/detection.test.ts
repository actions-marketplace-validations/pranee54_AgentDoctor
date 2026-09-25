import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { detectAgents } from "../../../src/agents/detect-agents.js";
import { detectCursor } from "../../../src/agents/cursor/detector.js";
import { detectClaudeCode } from "../../../src/agents/claude/detector.js";
import { detectCodex } from "../../../src/agents/codex/detector.js";
import { detectCopilot } from "../../../src/agents/copilot/detector.js";
import { detectWindsurf } from "../../../src/agents/windsurf/detector.js";
import { detectGeminiCli } from "../../../src/agents/gemini/detector.js";
import { detectAider } from "../../../src/agents/aider/detector.js";
import { discoverFiles } from "../../../src/discovery/files.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.resolve(here, "../../../fixtures");

async function contextFor(fixtureName: string) {
  const root = path.join(fixturesRoot, fixtureName);
  const discovery = await discoverFiles({ root });
  return { root, discovery, maxFileSizeBytes: 2 * 1024 * 1024 };
}

describe("Cursor detection", () => {
  it("configures cursor-project from .mdc rules", async () => {
    const result = await detectCursor(await contextFor("cursor-project"));
    expect(result.detected).toBe(true);
    expect(result.configured).toBe(true);
    expect(result.status).toBe("configured");
    expect(result.metadata.mdcRuleCount).toBe(2);
    expect(result.configFiles.some((f) => f.kind === "cursor-rule-mdc")).toBe(true);
  });

  it("flags legacy .cursorrules", async () => {
    const result = await detectCursor(await contextFor("legacy-cursor-project"));
    expect(result.detected).toBe(true);
    expect(result.configured).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "cursor/legacy-cursorrules")).toBe(true);
    expect(result.configFiles.some((f) => f.legacy)).toBe(true);
  });

  it("detects empty rules as not configured", async () => {
    const result = await detectCursor(await contextFor("empty-agent-config"));
    expect(result.detected).toBe(true);
    expect(result.configured).toBe(false);
    expect(result.status).toBe("detected");
  });
});

describe("Claude Code detection", () => {
  it("configures claude-project from CLAUDE.md and settings", async () => {
    const result = await detectClaudeCode(await contextFor("claude-project"));
    expect(result.detected).toBe(true);
    expect(result.configured).toBe(true);
    expect(result.configPaths).toEqual(
      expect.arrayContaining(["CLAUDE.md", ".claude/settings.json", ".claude/rules/testing.md"]),
    );
  });

  it("returns a diagnostic for malformed settings without crashing", async () => {
    const result = await detectClaudeCode(await contextFor("malformed-agent-config"));
    expect(result.detected).toBe(true);
    expect(result.configured).toBe(true); // CLAUDE.md is still valid
    expect(result.diagnostics.some((d) => d.code === "claude/malformed-settings")).toBe(true);
    const settings = result.configFiles.find((f) => f.kind === "claude-settings");
    expect(settings?.parseError).toBeTruthy();
  });

  it("treats empty CLAUDE.md as detected but not configured (alone)", async () => {
    const result = await detectClaudeCode(await contextFor("empty-agent-config"));
    expect(result.detected).toBe(true);
    expect(result.configured).toBe(false);
  });
});

describe("Codex detection", () => {
  it("configures codex-project from AGENTS.md and nested override", async () => {
    const result = await detectCodex(await contextFor("codex-project"));
    expect(result.detected).toBe(true);
    expect(result.configured).toBe(true);
    expect(result.configPaths).toEqual(
      expect.arrayContaining(["AGENTS.md", "packages/api/AGENTS.override.md"]),
    );
  });

  it("detects nested AGENTS.md files", async () => {
    const result = await detectCodex(await contextFor("nested-agent-config"));
    expect(result.configured).toBe(true);
    expect(Number(result.metadata.agentsMdCount)).toBeGreaterThanOrEqual(3);
  });
});

describe("Copilot detection", () => {
  it("configures copilot-project from repo and path instructions", async () => {
    const result = await detectCopilot(await contextFor("copilot-project"));
    expect(result.detected).toBe(true);
    expect(result.configured).toBe(true);
    expect(result.status).toBe("configured");
    expect(result.configPaths).toEqual(
      expect.arrayContaining([
        ".github/copilot-instructions.md",
        ".github/instructions/typescript.instructions.md",
      ]),
    );
    expect(result.metadata.repoInstructionsCount).toBe(1);
    expect(result.metadata.pathInstructionsCount).toBe(1);
  });

  it("treats empty copilot-instructions as detected but not configured", async () => {
    const result = await detectCopilot(await contextFor("copilot-empty"));
    expect(result.detected).toBe(true);
    expect(result.configured).toBe(false);
    expect(result.status).toBe("detected");
    expect(result.diagnostics.some((d) => d.code === "copilot/empty-instruction")).toBe(true);
  });
});

describe("Windsurf detection", () => {
  it("configures windsurf-project from .windsurf/rules", async () => {
    const result = await detectWindsurf(await contextFor("windsurf-project"));
    expect(result.detected).toBe(true);
    expect(result.configured).toBe(true);
    expect(result.configPaths).toEqual(expect.arrayContaining([".windsurf/rules/coding.md"]));
  });
});

describe("Gemini CLI detection", () => {
  it("configures gemini-project from GEMINI.md and settings", async () => {
    const result = await detectGeminiCli(await contextFor("gemini-project"));
    expect(result.detected).toBe(true);
    expect(result.configured).toBe(true);
    expect(result.configPaths).toEqual(
      expect.arrayContaining(["GEMINI.md", ".gemini/settings.json"]),
    );
    expect(result.metadata.hasGeminiignore).toBe(true);
  });
});

describe("Aider detection", () => {
  it("configures aider-project from conf, ignore, and conventions", async () => {
    const result = await detectAider(await contextFor("aider-project"));
    expect(result.detected).toBe(true);
    expect(result.configured).toBe(true);
    expect(result.configPaths).toEqual(
      expect.arrayContaining([".aider.conf.yml", ".aiderignore", "CONVENTIONS.md"]),
    );
  });
});

describe("detectAgents orchestration", () => {
  it("marks clean-project agents as not configured", async () => {
    const { agents } = await detectAgents(await contextFor("clean-project"));
    expect(agents.every((a) => !a.configured)).toBe(true);
    expect(agents.every((a) => !a.detected)).toBe(true);
  });

  it("marks cursor, claude-code, and codex configured on multi-agent-project", async () => {
    const { agents } = await detectAgents(await contextFor("multi-agent-project"));
    const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
    expect(byId.cursor?.configured).toBe(true);
    expect(byId["claude-code"]?.configured).toBe(true);
    expect(byId.codex?.configured).toBe(true);
    expect(byId.copilot?.configured).toBe(false);
  });

  it("marks copilot configured on copilot-project", async () => {
    const { agents } = await detectAgents(await contextFor("copilot-project"));
    const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
    expect(byId.copilot?.configured).toBe(true);
    expect(byId.cursor?.configured).toBe(false);
  });
});
