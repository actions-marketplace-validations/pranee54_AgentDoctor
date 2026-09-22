import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { scan } from "../../../src/index.js";
import { renderTerminalReport } from "../../../src/reporters/terminal/report.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.resolve(here, "../../../fixtures");

describe("Copilot scan messaging", () => {
  it("treats copilot-project as full agent security analysis", async () => {
    const result = await scan({ cwd: path.join(fixturesRoot, "copilot-project") });
    expect(result.agentSecurityAnalysis).toBe("full");
    expect(result.agents.some((a) => a.id === "copilot" && a.configured)).toBe(true);

    const terminal = renderTerminalReport(result);
    expect(terminal).not.toContain("repository hygiene still applied");
    expect(terminal).toMatch(/Readiness: \d+\/100/);
    expect(terminal).toContain("GitHub Copilot");
  });

  it("flags empty Copilot instructions", async () => {
    const result = await scan({ cwd: path.join(fixturesRoot, "copilot-empty") });
    expect(result.agentSecurityAnalysis).toBe("full");
    const empty = result.findings.filter((f) => f.ruleId === "instructions/empty-instructions");
    expect(empty.some((f) => f.evidence?.path === ".github/copilot-instructions.md")).toBe(true);
    expect(empty[0]?.affectedAgents).toEqual(expect.arrayContaining(["copilot"]));
  });
});
