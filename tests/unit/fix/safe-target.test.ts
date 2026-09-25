import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { resolveSafeFixWritePath } from "../../../src/core/fix/safe-target.js";
import { writeCursorignore } from "../../../src/core/fix/writers/cursorignore.js";
import { writeSimpleIgnore } from "../../../src/core/fix/writers/simple-ignore.js";
import {
  assertSafeCodexDenyKey,
  formatTomlDenyAssignment,
} from "../../../src/core/fix/writers/codex-config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const scratchRoot = path.resolve(here, "../../../test-results");
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function makeTemp(): Promise<string> {
  await fs.mkdir(scratchRoot, { recursive: true });
  const dir = await fs.mkdtemp(path.join(scratchRoot, "safe-fix-"));
  tempDirs.push(dir);
  return dir;
}

describe("Safe Fix target hardening", () => {
  it("refuses non-allowlisted Fix targets", async () => {
    const root = await makeTemp();
    await expect(resolveSafeFixWritePath(root, ".env")).rejects.toThrow(/not allowlisted/);
  });

  it("refuses writing through a symlink Fix target", async () => {
    const root = await makeTemp();
    const outside = path.join(root, "outside-secret.txt");
    await fs.writeFile(outside, "secret\n", "utf8");
    const link = path.join(root, ".cursorignore");
    await fs.symlink(outside, link);
    await expect(writeCursorignore(root, "build/\n")).rejects.toThrow(/symlink/);
    expect(await fs.readFile(outside, "utf8")).toBe("secret\n");
  });

  it("refuses symlink .geminiignore write-through", async () => {
    const root = await makeTemp();
    const outside = path.join(root, "leaked.txt");
    await fs.writeFile(outside, "keep\n", "utf8");
    await fs.symlink(outside, path.join(root, ".geminiignore"));
    await expect(writeSimpleIgnore(root, ".geminiignore", "build/\n")).rejects.toThrow(/symlink/);
    expect(await fs.readFile(outside, "utf8")).toBe("keep\n");
  });

  it("escapes quotes in Codex deny keys", () => {
    expect(formatTomlDenyAssignment('weird"path')).toBe('"weird\\"path" = "deny"');
  });

  it("refuses Codex deny keys with control characters", () => {
    expect(() => assertSafeCodexDenyKey("bad\nkey")).toThrow(/control characters/);
  });

  it("refuses directory Fix targets", async () => {
    const root = await makeTemp();
    await fs.mkdir(path.join(root, ".aiderignore"));
    await expect(resolveSafeFixWritePath(root, ".aiderignore")).rejects.toThrow(/directory/);
  });
});
