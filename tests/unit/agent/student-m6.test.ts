import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { MockModelProvider } from "../../../src/ai/index.js";
import { StudentService } from "../../../src/agent/student.js";
import { defaultStudentMode, parseAgentMode } from "../../../src/agent/modes.js";
import { runLearnCommand } from "../../../src/cli/commands/learn.js";
import { EXIT_CODES } from "../../../src/types/index.js";

async function tempProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ad-m6-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "student-app", dependencies: { react: "18.0.0" } }),
  );
  await fs.writeFile(path.join(root, "src", "app.ts"), "export const app = 1;\n");
  return root;
}

describe("M6 modes + student", () => {
  it("defaults student mode to BUILD_WITH_ME", () => {
    expect(defaultStudentMode()).toBe("BUILD_WITH_ME");
    expect(parseAgentMode("learn")).toBe("LEARN");
    expect(parseAgentMode("student")).toBe("BUILD_WITH_ME");
  });

  it("explains project with truth labels and no invented DB", async () => {
    const root = await tempProject();
    const student = new StudentService({
      root,
      provider: new MockModelProvider(),
      mode: "LEARN",
    });
    const { text, sections } = await student.explainProject();
    expect(text).toContain("LEARN");
    expect(sections.some((s) => s.id === "technologies")).toBe(true);
    expect(text).not.toMatch(/PostgreSQL|MongoDB|Redis/i);
    await student.end();
  });

  it("viva questions stay grounded in detected stack", async () => {
    const root = await tempProject();
    const student = new StudentService({
      root,
      provider: new MockModelProvider(),
      mode: "LEARN",
    });
    const qs = await student.generateVivaQuestions();
    expect(qs.length).toBeGreaterThan(0);
    expect(qs.some((q) => /react/i.test(q))).toBe(true);
    await student.end();
  });

  it("learn CLI works", async () => {
    const root = await tempProject();
    const code = await runLearnCommand({ root, useMock: true, json: true });
    expect(code).toBe(EXIT_CODES.SUCCESS);
  });
});
