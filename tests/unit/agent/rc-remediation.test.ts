import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { MockModelProvider } from "../../../src/ai/index.js";
import { NoneModelProvider } from "../../../src/ai/providers/none.js";
import {
  getModeProfile,
  modeAllowsMutation,
  modeBlocksToolCategory,
} from "../../../src/agent/modes.js";
import { evaluateApproval } from "../../../src/agent/approvals.js";
import { runCodingLoop } from "../../../src/agent/loop.js";
import { executeAgentTool, newToolCall } from "../../../src/agent/tools/index.js";
import { StudentService } from "../../../src/agent/student.js";
import {
  assertWorkspacePathAccess,
  initWorkspace,
  addRepositoryToWorkspace,
} from "../../../src/workspace/index.js";
import { resolveSafeRepoPath } from "../../../src/security/paths.js";

async function tempProject(prefix: string, testExit = 0): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  await fsp.mkdir(path.join(root, "src"), { recursive: true });
  await fsp.writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: "rc-fixture",
        scripts: { test: `node -e "process.exit(${testExit})"` },
      },
      null,
      2,
    ),
  );
  await fsp.writeFile(path.join(root, "src", "app.ts"), "export const app = true;\n");
  return root;
}

describe("P1 ModeProfile.allowWrites enforcement", () => {
  it("LEARN profile has allowWrites=false and blocks write/execute categories", () => {
    expect(getModeProfile("LEARN").allowWrites).toBe(false);
    expect(modeAllowsMutation("LEARN")).toBe(false);
    expect(modeBlocksToolCategory("LEARN", "write")).toBe(true);
    expect(modeBlocksToolCategory("LEARN", "execute")).toBe(true);
    expect(modeBlocksToolCategory("LEARN", "read")).toBe(false);
  });

  it("LEARN cannot create/edit/delete even with approval flags", async () => {
    const root = await tempProject("ad-p1-learn-");
    for (const [name, args] of [
      ["create_file", { path: "src/x.ts", content: "x" }],
      ["edit_file", { path: "src/app.ts", content: "export const app = false;\n" }],
      ["delete_file", { path: "src/app.ts" }],
    ] as const) {
      const result = await executeAgentTool(root, newToolCall("t", name, args), {
        allowWrite: true,
        approvedByHuman: true,
        mode: "LEARN",
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("mode_forbidden");
    }
    const still = await fsp.readFile(path.join(root, "src", "app.ts"), "utf8");
    expect(still).toContain("app = true");
  });

  it("LEARN coding loop stops with mode_forbidden", async () => {
    const root = await tempProject("ad-p1-loop-");
    const result = await runCodingLoop({
      root,
      goal: "Add file",
      approvedByHuman: true,
      mode: "LEARN",
      toolCalls: [{ name: "create_file", arguments: { path: "src/x.ts", content: "x" } }],
    });
    expect(result.stoppedReason).toBe("mode_forbidden");
    expect(result.filesChanged).toEqual([]);
  });

  it("BUILD_WITH_ME / BUILD_FOR_ME / AI_AGENT require human approval", async () => {
    for (const mode of ["BUILD_WITH_ME", "BUILD_FOR_ME", "AI_AGENT"] as const) {
      expect(getModeProfile(mode).allowWrites).toBe(true);
      const root = await tempProject(`ad-p1-${mode}-`);
      const denied = await executeAgentTool(
        root,
        newToolCall("t", "create_file", { path: "src/n.ts", content: "n" }),
        { allowWrite: true, approvedByHuman: false, mode },
      );
      expect(denied.ok).toBe(false);
      expect(denied.error?.code).toBe("approval_required");

      const loop = await runCodingLoop({
        root,
        goal: "Add n",
        approvedByHuman: false,
        mode,
        toolCalls: [{ name: "create_file", arguments: { path: "src/n.ts", content: "n" } }],
      });
      expect(loop.stoppedReason).toBe("awaiting-approval");
      expect(loop.filesChanged).toEqual([]);
    }
  });

  it("model cannot self-approve CRITICAL or write tools", () => {
    const critical = evaluateApproval({ action: "deploy", risk: "CRITICAL" });
    expect(critical.needsHumanApproval).toBe(true);
    const write = evaluateApproval(
      { action: "tool:create_file", risk: "MEDIUM", toolName: "create_file" },
      { approvedByHuman: false },
    );
    expect(write.needsHumanApproval).toBe(true);
    expect(write.decision).not.toBe("allow");
  });
});

describe("P3 symlink escape on agent writes", () => {
  it("rejects create/edit/delete via symlink directory escape", async () => {
    const root = await tempProject("ad-p3-sym-");
    const outside = await fsp.mkdtemp(path.join(os.tmpdir(), "ad-p3-out-"));
    await fsp.writeFile(path.join(outside, "secret.txt"), "OUTSIDE_SECRET\n");
    fs.symlinkSync(outside, path.join(root, "leak"));

    expect(() => resolveSafeRepoPath(root, "leak/new.ts")).toThrow(/escapes/);

    const created = await executeAgentTool(
      root,
      newToolCall("t", "create_file", { path: "leak/evil.ts", content: "pwned" }),
      { allowWrite: true, approvedByHuman: true },
    );
    expect(created.ok).toBe(false);
    expect(created.error?.code).toBe("path_escape");

    const edited = await executeAgentTool(
      root,
      newToolCall("t", "edit_file", { path: "leak/secret.txt", content: "hacked" }),
      { allowWrite: true, approvedByHuman: true },
    );
    expect(edited.ok).toBe(false);
    expect(edited.error?.code).toBe("path_escape");

    const deleted = await executeAgentTool(
      root,
      newToolCall("t", "delete_file", { path: "leak/secret.txt" }),
      { allowWrite: true, approvedByHuman: true },
    );
    expect(deleted.ok).toBe(false);
    expect(deleted.error?.code).toBe("path_escape");

    const outsideStill = await fsp.readFile(path.join(outside, "secret.txt"), "utf8");
    expect(outsideStill).toBe("OUTSIDE_SECRET\n");
  });
});

describe("P4 agent limit enforcement", () => {
  it("stops on maxToolCalls", async () => {
    const root = await tempProject("ad-p4-tc-");
    const result = await runCodingLoop({
      root,
      goal: "two creates",
      approvedByHuman: true,
      limits: { maxToolCalls: 1, maxIterations: 50, maxFilesModified: 10 },
      toolCalls: [
        { name: "create_file", arguments: { path: "src/a.ts", content: "a" } },
        { name: "create_file", arguments: { path: "src/b.ts", content: "b" } },
      ],
      verify: false,
    });
    expect(result.stoppedReason).toBe("limit");
    expect(result.responseText).toMatch(/maxToolCalls/);
  });

  it("stops on maxIterations", async () => {
    const root = await tempProject("ad-p4-it-");
    const result = await runCodingLoop({
      root,
      goal: "iter",
      approvedByHuman: true,
      limits: { maxIterations: 1, maxToolCalls: 50 },
      toolCalls: [{ name: "create_file", arguments: { path: "src/c.ts", content: "c" } }],
      verify: false,
    });
    expect(result.stoppedReason).toBe("limit");
    expect(result.responseText).toMatch(/maxIterations/);
  });

  it("stops on maxWallTimeMs without long commands", async () => {
    const root = await tempProject("ad-p4-wall-");
    const result = await runCodingLoop({
      root,
      goal: "wall",
      approvedByHuman: true,
      limits: { maxWallTimeMs: 0, maxToolCalls: 50, maxIterations: 50 },
      toolCalls: [{ name: "create_file", arguments: { path: "src/w.ts", content: "w" } }],
      verify: false,
    });
    expect(result.stoppedReason).toBe("limit");
    expect(result.responseText).toMatch(/maxWallTimeMs/);
  });

  it("stops before exceeding maxFilesModified", async () => {
    const root = await tempProject("ad-p4-files-");
    const result = await runCodingLoop({
      root,
      goal: "files",
      approvedByHuman: true,
      limits: { maxFilesModified: 1, maxToolCalls: 50, maxIterations: 50 },
      toolCalls: [
        { name: "create_file", arguments: { path: "src/f1.ts", content: "1" } },
        { name: "create_file", arguments: { path: "src/f2.ts", content: "2" } },
      ],
      verify: false,
    });
    expect(result.stoppedReason).toBe("limit");
    expect(result.responseText).toMatch(/maxFilesModified/);
    expect(result.filesChanged.length).toBeLessThanOrEqual(1);
    await expect(fsp.access(path.join(root, "src", "f2.ts"))).rejects.toThrow();
  });

  it("truncates model context by maxContextChars", async () => {
    const root = await tempProject("ad-p4-ctx-");
    const seen: string[] = [];
    const provider = new MockModelProvider({
      script: [
        {
          content: "done",
          toolCalls: [],
        },
      ],
    });
    const orig = provider.chat.bind(provider);
    provider.chat = async (req) => {
      for (const m of req.messages) seen.push(m.content);
      return orig(req);
    };
    const huge = "X".repeat(5_000);
    const result = await runCodingLoop({
      root,
      goal: huge,
      provider,
      approvedByHuman: true,
      useModelLoop: true,
      limits: { maxContextChars: 200, maxIterations: 5, maxToolCalls: 5 },
      verify: false,
    });
    expect(result.stoppedReason).toBe("completed");
    expect(seen.some((s) => s.includes("[truncated maxContextChars]"))).toBe(true);
    expect(seen.every((s) => s.length <= 200)).toBe(true);
  });
});

describe("P5 model-driven coding loop", () => {
  it("MODEL→PLAN→approval→tools→verify; model never writes directly", async () => {
    const root = await tempProject("ad-p5-model-");
    const provider = new MockModelProvider({
      script: [
        {
          content: "reading",
          toolCalls: [{ id: "1", name: "read_file", arguments: { path: "src/app.ts" } }],
        },
        {
          content: "editing",
          toolCalls: [
            {
              id: "2",
              name: "edit_file",
              arguments: { path: "src/app.ts", content: "export const app = 'edited';\n" },
            },
          ],
        },
        { content: "done", toolCalls: [] },
      ],
    });

    const denied = await runCodingLoop({
      root,
      goal: "edit app",
      provider,
      approvedByHuman: false,
      useModelLoop: true,
      mode: "AI_AGENT",
    });
    expect(denied.stoppedReason).toBe("awaiting-approval");
    expect(await fsp.readFile(path.join(root, "src", "app.ts"), "utf8")).toContain("true");

    const provider2 = new MockModelProvider({
      script: [
        {
          content: "reading",
          toolCalls: [{ id: "1", name: "read_file", arguments: { path: "src/app.ts" } }],
        },
        {
          content: "editing",
          toolCalls: [
            {
              id: "2",
              name: "edit_file",
              arguments: { path: "src/app.ts", content: "export const app = 'edited';\n" },
            },
          ],
        },
        { content: "done", toolCalls: [] },
      ],
    });
    const ok = await runCodingLoop({
      root,
      goal: "edit app",
      provider: provider2,
      approvedByHuman: true,
      useModelLoop: true,
      mode: "AI_AGENT",
      verify: true,
    });
    expect(ok.stoppedReason).toBe("completed");
    expect(ok.filesChanged).toContain("src/app.ts");
    expect(await fsp.readFile(path.join(root, "src", "app.ts"), "utf8")).toContain("edited");
    expect(ok.verification?.correctnessStatus).toBe("ENGINEERING_CORRECTNESS_NOT_CLAIMED");
  });

  it("blocks dangerous command proposed by model", async () => {
    const root = await tempProject("ad-p5-danger-");
    const provider = new MockModelProvider({
      script: [
        {
          content: "boom",
          toolCalls: [{ id: "1", name: "run_command", arguments: { command: "rm -rf /" } }],
        },
        { content: "done", toolCalls: [] },
      ],
    });
    const result = await runCodingLoop({
      root,
      goal: "cleanup",
      provider,
      approvedByHuman: true,
      useModelLoop: true,
      verify: false,
    });
    expect(result.stoppedReason).toBe("completed");
    expect(result.toolResults.some((r) => !r.ok && r.error?.code === "blocked")).toBe(true);
  });
});

describe("P6 run-tests path", () => {
  it("EDIT → RUN TESTS pass → VERIFY reports tests", async () => {
    const root = await tempProject("ad-p6-pass-", 0);
    const result = await runCodingLoop({
      root,
      goal: "edit and test",
      approvedByHuman: true,
      toolCalls: [
        {
          name: "edit_file",
          arguments: { path: "src/app.ts", content: "export const app = 1;\n" },
        },
      ],
      verify: true,
      runTests: true,
    });
    expect(result.stoppedReason).toBe("completed");
    const tests = result.verification?.checks.find((c) => c.id === "tests");
    expect(tests?.status).toBe("passed");
    expect(result.verification?.correctnessStatus).toBe("ENGINEERING_CORRECTNESS_NOT_CLAIMED");
  });

  it("EDIT → RUN TESTS fail → VERIFY reports failure without claiming correctness", async () => {
    const root = await tempProject("ad-p6-fail-", 1);
    const result = await runCodingLoop({
      root,
      goal: "edit and fail tests",
      approvedByHuman: true,
      toolCalls: [
        {
          name: "edit_file",
          arguments: { path: "src/app.ts", content: "export const app = 2;\n" },
        },
      ],
      verify: true,
      runTests: true,
    });
    expect(result.stoppedReason).toBe("completed");
    const tests = result.verification?.checks.find((c) => c.id === "tests");
    expect(tests?.status).toBe("failed");
    expect(result.responseText).toContain("ENGINEERING_CORRECTNESS_NOT_CLAIMED");
  });
});

describe("P9 workspace isolation", () => {
  it("Project A agent cannot access Project B (repo-root + workspace gate)", async () => {
    const control = await fsp.mkdtemp(path.join(os.tmpdir(), "ad-p9-ctl-"));
    const a = await tempProject("ad-p9-a-");
    const b = await tempProject("ad-p9-b-");
    await fsp.writeFile(path.join(b, "secret.ts"), 'export const secret = "B_ONLY";\n');

    const ws = await initWorkspace({
      controlRoot: control,
      name: "iso",
      repositoryRoot: a,
      allowCrossRead: false,
    });
    await addRepositoryToWorkspace({ controlRoot: control, workspaceId: ws.id, repositoryRoot: b });
    const loaded = { ...ws, repositoryRoots: [a, b].map((r) => path.resolve(r)) };

    const cross = assertWorkspacePathAccess({
      workspace: loaded,
      operationRoot: a,
      targetPath: path.join(b, "secret.ts"),
    });
    expect(cross.allowed).toBe(false);

    const escape = await executeAgentTool(
      a,
      newToolCall("t", "read_file", { path: "../" + path.basename(b) + "/secret.ts" }),
      { workspace: loaded },
    );
    expect(escape.ok).toBe(false);
    expect(["path_escape", "workspace_denied"]).toContain(escape.error?.code);
  });
});

describe("P10 agent secret redaction", () => {
  it("redacts secrets from file read and does not echo raw key", async () => {
    const root = await tempProject("ad-p10-sec-");
    const fakeKey = "sk-test-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
    await fsp.writeFile(path.join(root, ".env"), `API_KEY=${fakeKey}\n`);
    await fsp.writeFile(
      path.join(root, "src", "config.ts"),
      `export const api_key = "${fakeKey}";\n`,
    );

    const read = await executeAgentTool(
      root,
      newToolCall("t", "read_file", { path: "src/config.ts" }),
    );
    expect(read.ok).toBe(true);
    const content = JSON.stringify(read.data);
    expect(content).not.toContain(fakeKey);
    expect(content).toContain("[REDACTED]");

    const envRead = await executeAgentTool(root, newToolCall("t", "read_file", { path: ".env" }));
    expect(envRead.ok).toBe(true);
    expect(JSON.stringify(envRead.data)).not.toContain(fakeKey);
  });
});

describe("P11 BUILD_WITH_ME reaches coding loop", () => {
  it("explains and awaits approval, then executes runCodingLoop after approve", async () => {
    const root = await tempProject("ad-p11-bwm-");
    const student = new StudentService({
      root,
      provider: new MockModelProvider(),
      mode: "BUILD_WITH_ME",
    });
    const pending = await student.buildFeature({
      goal: "Add hello module",
      approvedByHuman: false,
      toolCalls: [
        {
          name: "create_file",
          arguments: { path: "src/hello.ts", content: "export const hello = 1;\n" },
        },
      ],
    });
    expect(pending.status).toBe("awaiting-approval");
    expect(pending.coding).toBeNull();
    expect(pending.explanation).toMatch(/BUILD_WITH_ME/);
    expect(pending.teachingNotes.length).toBeGreaterThan(0);

    const done = await student.buildFeature({
      goal: "Add hello module",
      approvedByHuman: true,
      toolCalls: [
        {
          name: "create_file",
          arguments: { path: "src/hello.ts", content: "export const hello = 1;\n" },
        },
      ],
      verify: false,
    });
    expect(done.status).toBe("completed");
    expect(done.coding?.stoppedReason).toBe("completed");
    expect(done.coding?.filesChanged).toContain("src/hello.ts");
    await student.end();
  });

  it("LEARN buildFeature is mode_forbidden", async () => {
    const root = await tempProject("ad-p11-learn-");
    const student = new StudentService({
      root,
      provider: new NoneModelProvider(),
      mode: "LEARN",
    });
    const result = await student.buildFeature({
      goal: "x",
      approvedByHuman: true,
      toolCalls: [{ name: "create_file", arguments: { path: "src/x.ts", content: "x" } }],
    });
    expect(result.status).toBe("mode_forbidden");
    await student.end();
  });
});
