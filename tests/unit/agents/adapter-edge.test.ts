import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { detectAider } from "../../../src/agents/aider/detector.js";
import { detectCopilot } from "../../../src/agents/copilot/detector.js";
import { detectGeminiCli } from "../../../src/agents/gemini/detector.js";
import { detectWindsurf } from "../../../src/agents/windsurf/detector.js";
import { discoverFiles } from "../../../src/discovery/files.js";
import { buildFixPlan, scan } from "../../../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.resolve(here, "../../../fixtures");

async function contextFor(fixtureName: string) {
  const root = path.join(fixturesRoot, fixtureName);
  const discovery = await discoverFiles({ root });
  return { root, discovery, maxFileSizeBytes: 2 * 1024 * 1024 };
}

describe("adapter edge fixtures", () => {
  it("detects Windsurf .devin/rules", async () => {
    const result = await detectWindsurf(await contextFor("windsurf-devin"));
    expect(result.detected).toBe(true);
    expect(result.configured).toBe(true);
    expect(result.configPaths.some((p) => p.includes(".devin/rules/"))).toBe(true);
  });

  it("detects legacy .windsurfrules", async () => {
    const result = await detectWindsurf(await contextFor("windsurf-legacy"));
    expect(result.detected).toBe(true);
    expect(result.configured).toBe(true);
    expect(result.configPaths).toContain(".windsurfrules");
    expect(result.diagnostics.some((d) => d.code === "windsurf/legacy-rules")).toBe(true);
  });

  it("flags malformed Gemini settings without crashing", async () => {
    const result = await detectGeminiCli(await contextFor("gemini-malformed"));
    expect(result.detected).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "gemini/malformed-settings")).toBe(true);
  });

  it("treats empty .geminiignore as Gemini detected", async () => {
    const result = await detectGeminiCli(await contextFor("gemini-empty-ignore"));
    expect(result.detected).toBe(true);
    expect(result.configured).toBe(true);
    expect(result.metadata.hasGeminiignore).toBe(true);
  });

  it("does not treat CONVENTIONS.md alone as Aider", async () => {
    const result = await detectAider(await contextFor("aider-conventions-only"));
    expect(result.detected).toBe(false);
    expect(result.configured).toBe(false);
  });

  it("detects .aider.conf.yaml extension", async () => {
    const result = await detectAider(await contextFor("aider-yaml-ext"));
    expect(result.detected).toBe(true);
    expect(result.configured).toBe(true);
    expect(result.configPaths).toContain(".aider.conf.yaml");
  });

  it("detects multiple Copilot path instructions", async () => {
    const result = await detectCopilot(await contextFor("copilot-nested"));
    expect(result.configured).toBe(true);
    expect(Number(result.metadata.pathInstructionsCount)).toBe(2);
  });

  it("never invents Copilot or Windsurf Safe Fix writers on edge fixtures", async () => {
    for (const fixture of ["copilot-nested", "windsurf-devin", "windsurf-legacy"]) {
      const result = await scan({ cwd: path.join(fixturesRoot, fixture) });
      const plan = await buildFixPlan(result);
      expect(plan.actions.every((a) => a.agent !== "copilot" && a.agent !== "windsurf")).toBe(true);
    }
  });
});

describe("limited mode hygiene", () => {
  it("reports env exposure with limited analysis and empty affectedAgents", async () => {
    const result = await scan({ cwd: path.join(fixturesRoot, "no-agents-env") });
    expect(result.agentSecurityAnalysis).toBe("limited");
    const env = result.findings.find((f) => f.ruleId === "security/env-file-exposure");
    expect(env?.severity).toBe("critical");
    expect(env?.affectedAgents).toEqual([]);
  });
});
