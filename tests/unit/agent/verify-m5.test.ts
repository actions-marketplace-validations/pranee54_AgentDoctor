import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCodingLoop } from "../../../src/agent/loop.js";
import { verifyAgentWork } from "../../../src/agent/verify.js";
import { executeAgentTool, newToolCall } from "../../../src/agent/tools/index.js";

async function tempProject(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "m5-fixture", scripts: { test: 'node -e "process.exit(0)"' } }),
  );
  await fs.writeFile(path.join(root, "src", "app.ts"), "export const app = true;\n");
  return root;
}

describe("M5 verifyAgentWork", () => {
  it("reports verified vs not-verified and never claims full correctness", async () => {
    const root = await tempProject("ad-m5-verify-");
    await executeAgentTool(
      root,
      newToolCall("s", "create_file", {
        path: "src/pages/StudentRegistration.tsx",
        content: "export function StudentRegistration() { return null; }\n",
      }),
      { allowWrite: true, approvedByHuman: true },
    );

    const report = await verifyAgentWork({
      root,
      filesChanged: ["src/pages/StudentRegistration.tsx"],
      runTests: false,
    });

    expect(report.correctnessStatus).toBe("ENGINEERING_CORRECTNESS_NOT_CLAIMED");
    expect(report.summaryText).toContain("ENGINEERING_CORRECTNESS_NOT_CLAIMED");
    expect(report.summaryText).not.toMatch(/everything is correct/i);
    expect(report.notVerified.length).toBeGreaterThan(0);
    expect(report.checks.some((c) => c.id === "change-analyze")).toBe(true);
    expect(report.checks.some((c) => c.id === "tests" && c.status === "not-run")).toBe(true);
  });
});

describe("M5 coding loop verification", () => {
  it("attaches verification after approved writes", async () => {
    const root = await tempProject("ad-m5-loop-");
    const result = await runCodingLoop({
      root,
      goal: "Create registration page",
      approvedByHuman: true,
      verify: true,
      runTests: false,
      toolCalls: [
        {
          name: "create_file",
          arguments: {
            path: "src/Reg.tsx",
            content: "export const Reg = () => null;\n",
          },
        },
      ],
    });

    expect(result.stoppedReason).toBe("completed");
    expect(result.verification).toBeDefined();
    expect(result.verification?.correctnessStatus).toBe("ENGINEERING_CORRECTNESS_NOT_CLAIMED");
    expect(result.responseText).toContain("Not verified");
    expect(result.responseText).toContain("ENGINEERING_CORRECTNESS_NOT_CLAIMED");
  }, 60_000);
});
