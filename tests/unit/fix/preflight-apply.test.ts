import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { applyFixPlan, buildFixPlan, scan } from "../../../src/index.js";
import { preflightSafeFixTargets } from "../../../src/core/fix/safe-target.js";
import { buildCodexConfigContent } from "../../../src/core/fix/writers/codex-config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const scratchRoot = path.resolve(here, "../../../test-results");
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function makeTemp(): Promise<string> {
  await fs.mkdir(scratchRoot, { recursive: true });
  const dir = await fs.mkdtemp(path.join(scratchRoot, "preflight-"));
  tempDirs.push(dir);
  return dir;
}

describe("Safe Fix preflight and partial apply", () => {
  it("preflight fails on symlink target before any write", async () => {
    const root = await makeTemp();
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "preflight", private: true }),
      "utf8",
    );
    await fs.writeFile(path.join(root, ".cursorrules"), "# cursor\n", "utf8");
    await fs.mkdir(path.join(root, "build"));
    await fs.writeFile(path.join(root, "build", "out.txt"), "g\n", "utf8");
    const outside = path.join(root, "outside.txt");
    await fs.writeFile(outside, "secret\n", "utf8");
    await fs.symlink(outside, path.join(root, ".cursorignore"));

    const result = await scan({ cwd: root });
    const plan = await buildFixPlan(result);
    expect(plan.actions.some((a) => a.agent === "cursor")).toBe(true);

    const applyResult = await applyFixPlan(plan, { dryRun: false });
    expect(applyResult.writtenFiles).toEqual([]);
    expect(applyResult.error).toMatch(/symlink/i);
    expect(applyResult.partial).toBe(false);
    expect(await fs.readFile(outside, "utf8")).toBe("secret\n");
  });

  it("preflight refuses symlink ancestor directories", async () => {
    const root = await makeTemp();
    const outside = await fs.mkdtemp(path.join(scratchRoot, "outside-"));
    tempDirs.push(outside);
    await fs.symlink(outside, path.join(root, ".claude"));
    await expect(preflightSafeFixTargets(root, [".claude/settings.json"])).rejects.toThrow(
      /symlink directory/i,
    );
  });

  it("preflight refuses directory Fix targets", async () => {
    const root = await makeTemp();
    await fs.mkdir(path.join(root, ".geminiignore"));
    await expect(preflightSafeFixTargets(root, [".geminiignore"])).rejects.toThrow(/directory/i);
  });

  it("preflight deduplicates target paths", async () => {
    const root = await makeTemp();
    const resolved = await preflightSafeFixTargets(root, [
      ".cursorignore",
      ".cursorignore",
      ".geminiignore",
    ]);
    expect(resolved).toEqual([".cursorignore", ".geminiignore"]);
  });

  it("reports partial apply when a later writer fails after an earlier success", async () => {
    const root = await makeTemp();
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "partial", private: true }),
      "utf8",
    );
    await fs.writeFile(path.join(root, ".cursorrules"), "# cursor\n", "utf8");
    await fs.writeFile(path.join(root, "GEMINI.md"), "# gemini\n", "utf8");
    await fs.mkdir(path.join(root, "build"));
    await fs.writeFile(path.join(root, "build", "out.txt"), "g\n", "utf8");

    const result = await scan({ cwd: root });
    const plan = await buildFixPlan(result);
    expect(plan.actions.some((a) => a.agent === "cursor")).toBe(true);
    expect(plan.actions.some((a) => a.agent === "gemini-cli")).toBe(true);

    const applyResult = await applyFixPlan(plan, {
      dryRun: false,
      simulateWriteFailureAt: ".geminiignore",
    });
    expect(applyResult.writtenFiles).toContain(".cursorignore");
    expect(applyResult.partial).toBe(true);
    expect(applyResult.failedTarget).toBe(".geminiignore");
    expect(applyResult.error).toMatch(/simulated later writer failure/);
    expect(await fs.readFile(path.join(root, ".cursorignore"), "utf8")).toContain("build/");
  });

  it("documents Codex empty-config profile initialization as intentional and idempotent", () => {
    const after = buildCodexConfigContent(null, ["build"]);
    expect(after).toContain('default_permissions = "agentdoctor_context"');
    expect(after).toContain('"build" = "deny"');
    expect(after).toContain('"." = "write"');
    const again = buildCodexConfigContent(after, ["build"]);
    expect(again.match(/"build" = "deny"/g)?.length).toBe(1);
    expect(again.match(/default_permissions = "agentdoctor_context"/g)?.length).toBe(1);
  });
});
