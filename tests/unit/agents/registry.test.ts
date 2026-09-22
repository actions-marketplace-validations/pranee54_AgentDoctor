import { describe, expect, it } from "vitest";

import { agentRegistry, getAgentAdapter } from "../../../src/agents/registry.js";

describe("agentRegistry", () => {
  it("registers all supported agent adapters", () => {
    expect(agentRegistry.map((a) => a.id)).toEqual([
      "cursor",
      "claude-code",
      "codex",
      "copilot",
      "windsurf",
      "gemini-cli",
      "aider",
    ]);
  });

  it("looks up adapters by id", () => {
    expect(getAgentAdapter("cursor")?.displayName).toBe("Cursor");
    expect(getAgentAdapter("copilot")?.displayName).toBe("GitHub Copilot");
    expect(getAgentAdapter("windsurf")?.displayName).toBe("Windsurf");
    expect(getAgentAdapter("gemini-cli")?.displayName).toBe("Gemini CLI");
    expect(getAgentAdapter("aider")?.displayName).toBe("Aider");
    expect(getAgentAdapter("missing")).toBeUndefined();
  });

  it("exposes a stable detect() interface on every adapter", () => {
    for (const adapter of agentRegistry) {
      expect(typeof adapter.detect).toBe("function");
      expect(adapter.displayName.length).toBeGreaterThan(0);
    }
  });
});
