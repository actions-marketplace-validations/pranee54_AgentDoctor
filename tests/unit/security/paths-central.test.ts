import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  PathEscapeError,
  assertInsideRepo,
  resolveSafeRepoPath,
  safeRelPath,
} from "../../../src/security/paths.js";

describe("central path safety", () => {
  it("accepts in-repo relative paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ad-paths-ok-"));
    fs.writeFileSync(path.join(root, "a.ts"), "export {}\n");
    const abs = resolveSafeRepoPath(root, "a.ts");
    expect(abs).toBe(fs.realpathSync(path.join(root, "a.ts")));
    expect(safeRelPath(root, "a.ts")).toBe("a.ts");
    expect(() => assertInsideRepo(root, "a.ts")).not.toThrow();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("rejects .., encoded traversal, null bytes, and absolute escapes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ad-paths-bad-"));
    const cases = [
      "../etc/passwd",
      "%2e%2e%2fetc%2fpasswd",
      "..%2f..%2fetc%2fpasswd",
      "a.ts\0../x",
      "/etc/passwd",
      "C:\\Windows\\System32\\config\\sam",
      "....//....//etc/passwd",
    ];
    for (const c of cases) {
      expect(() => resolveSafeRepoPath(root, c), `case=${JSON.stringify(c)}`).toThrow(
        PathEscapeError,
      );
      try {
        resolveSafeRepoPath(root, c);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        expect(msg).not.toContain("/etc/passwd");
        expect(msg).not.toMatch(/TOP_SECRET/);
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("rejects symlink realpath escape", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ad-paths-sym-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ad-paths-out-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "SECRET\n");
    const link = path.join(root, "leak");
    try {
      fs.symlinkSync(outside, link);
    } catch {
      // Some CI environments disallow symlinks — skip.
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
      return;
    }
    expect(() => resolveSafeRepoPath(root, "leak/secret.txt")).toThrow(PathEscapeError);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
});
