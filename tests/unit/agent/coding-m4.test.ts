import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCodingLoop } from "../../../src/agent/loop.js";
import { executeAgentTool, newToolCall } from "../../../src/agent/tools/index.js";
import { EXIT_CODES } from "../../../src/types/index.js";
import { runAgentCommand } from "../../../src/cli/commands/agent.js";

async function tempProject(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "m4-fixture", scripts: { test: 'node -e "process.exit(0)"' } }, null, 2),
  );
  await fs.writeFile(path.join(root, "src", "app.ts"), "export const app = true;\n");
  return root;
}

describe("M4 file tools", () => {
  it("creates, edits with oldContent, and produces diffs under approval", async () => {
    const root = await tempProject("ad-m4-write-");
    const created = await executeAgentTool(
      root,
      newToolCall("s", "create_file", {
        path: "src/pages/StudentRegistration.tsx",
        content: "export function StudentRegistration() { return null; }\n",
      }),
      { allowWrite: true, approvedByHuman: true },
    );
    expect(created.ok).toBe(true);
    expect((created.data as { action: string }).action).toBe("create");
    expect((created.data as { diff: string }).diff).toContain("+export function");

    const edited = await executeAgentTool(
      root,
      newToolCall("s", "edit_file", {
        path: "src/pages/StudentRegistration.tsx",
        oldContent: "return null;",
        content: "return <div>Register</div>;",
      }),
      { allowWrite: true, approvedByHuman: true },
    );
    expect(edited.ok).toBe(true);
    const text = await fs.readFile(path.join(root, "src/pages/StudentRegistration.tsx"), "utf8");
    expect(text).toContain("Register");
  });

  it("rejects path escape on create and edit", async () => {
    const root = await tempProject("ad-m4-escape-");
    const bad = await executeAgentTool(
      root,
      newToolCall("s", "create_file", { path: "../../etc/evil", content: "x" }),
      { allowWrite: true, approvedByHuman: true },
    );
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe("path_escape");
  });

  it("requires approval for delete (HIGH)", async () => {
    const root = await tempProject("ad-m4-del-");
    await fs.writeFile(path.join(root, "src", "tmp.ts"), "x\n");
    const denied = await executeAgentTool(
      root,
      newToolCall("s", "delete_file", { path: "src/tmp.ts" }),
      { allowWrite: true, approvedByHuman: false },
    );
    expect(denied.ok).toBe(false);
    expect(denied.error?.code).toBe("approval_required");

    const ok = await executeAgentTool(
      root,
      newToolCall("s", "delete_file", { path: "src/tmp.ts" }),
      { allowWrite: true, approvedByHuman: true },
    );
    expect(ok.ok).toBe(true);
  });
});

describe("M4 controlled commands", () => {
  it("blocks rm -rf via controlled runner", async () => {
    const root = await tempProject("ad-m4-rm-");
    const result = await executeAgentTool(
      root,
      newToolCall("s", "run_command", { command: "rm -rf /tmp/x" }),
      { allowExecute: true, approvedByHuman: true },
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("blocked");
  });

  it("runs a safe argv command when approved", async () => {
    const root = await tempProject("ad-m4-cmd-");
    const result = await executeAgentTool(
      root,
      newToolCall("s", "run_command", { argv: ["npm", "--version"] }),
      { allowExecute: true, approvedByHuman: true },
    );
    expect(result.ok).toBe(true);
    expect(String((result.data as { stdout?: string }).stdout ?? "")).toMatch(/\d+\.\d+/);
  });
});

describe("M4 coding loop", () => {
  it("stops for approval and does not write", async () => {
    const root = await tempProject("ad-m4-loop-deny-");
    const result = await runCodingLoop({
      root,
      goal: "Create student registration page",
      approvedByHuman: false,
      toolCalls: [
        {
          name: "create_file",
          arguments: { path: "src/Reg.tsx", content: "export const Reg = 1;\n" },
        },
      ],
    });
    expect(result.stoppedReason).toBe("awaiting-approval");
    await expect(fs.access(path.join(root, "src/Reg.tsx"))).rejects.toBeTruthy();
  });

  it("applies approved create ops and returns diffs", async () => {
    const root = await tempProject("ad-m4-loop-ok-");
    const result = await runCodingLoop({
      root,
      goal: "Create student registration page",
      approvedByHuman: true,
      verify: false,
      toolCalls: [
        {
          name: "create_file",
          arguments: {
            path: "src/pages/StudentRegistration.tsx",
            content: "export function StudentRegistration() { return null; }\n",
          },
        },
      ],
      limits: { maxIterations: 10, maxToolCalls: 10 },
    });
    expect(result.stoppedReason).toBe("completed");
    expect(result.filesChanged).toContain("src/pages/StudentRegistration.tsx");
    expect(result.diffs.join("\n")).toContain("StudentRegistration");
    const body = await fs.readFile(path.join(root, "src/pages/StudentRegistration.tsx"), "utf8");
    expect(body).toContain("StudentRegistration");
  });

  it("stops on maxToolCalls limit", async () => {
    const root = await tempProject("ad-m4-limit-");
    const result = await runCodingLoop({
      root,
      goal: "spam tools",
      approvedByHuman: true,
      toolCalls: [
        { name: "inspect_project", arguments: {} },
        { name: "inspect_project", arguments: {} },
        { name: "inspect_project", arguments: {} },
      ],
      limits: { maxToolCalls: 1, maxIterations: 20 },
    });
    expect(result.stoppedReason).toBe("limit");
  });
});

describe("M4 CLI apply", () => {
  it("refuses --apply without --approve", async () => {
    const root = await tempProject("ad-m4-cli-");
    const code = await runAgentCommand({
      root,
      goal: "x",
      apply: true,
      approve: false,
    });
    expect(code).toBe(EXIT_CODES.USAGE_ERROR);
  });

  it("applies ops with --approve --apply", async () => {
    const root = await tempProject("ad-m4-cli-apply-");
    const ops = JSON.stringify([
      {
        name: "create_file",
        arguments: { path: "src/Hello.ts", content: "export const hello = 1;\n" },
      },
    ]);
    const code = await runAgentCommand({
      root,
      goal: "Add hello",
      approve: true,
      apply: true,
      applyOpsJson: ops,
      json: true,
      verify: false,
    });
    expect(code).toBe(EXIT_CODES.SUCCESS);
    expect(await fs.readFile(path.join(root, "src/Hello.ts"), "utf8")).toContain("hello");
  });
});
