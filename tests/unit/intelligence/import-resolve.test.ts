import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  loadTsconfigPaths,
  resolveImportSpecifier,
} from "../../../src/intelligence/resolve/imports.js";

function makeFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ad-imports-"));
  fs.mkdirSync(path.join(root, "src", "utils"), { recursive: true });
  fs.mkdirSync(path.join(root, "src", "barrel"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;\n");
  fs.writeFileSync(path.join(root, "src", "b.ts"), "export const b = 2;\n");
  fs.writeFileSync(path.join(root, "src", "utils", "math.ts"), "export const pi = 3;\n");
  fs.writeFileSync(path.join(root, "src", "barrel", "index.ts"), "export * from '../a';\n");
  fs.writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@/*": ["src/*"] },
      },
    }),
  );
  return root;
}

describe("import resolution", () => {
  it("resolves relative exact, extensionless, and index/barrel", () => {
    const root = makeFixture();
    try {
      const exact = resolveImportSpecifier({
        root,
        fromFile: "src/b.ts",
        specifier: "./a.ts",
      });
      expect(exact.confidence).toBe("EXACT");
      expect(exact.resolvedPath).toBe("src/a.ts");

      const ext = resolveImportSpecifier({
        root,
        fromFile: "src/b.ts",
        specifier: "./a",
      });
      expect(ext.confidence).toBe("RESOLVED");
      expect(ext.resolvedPath).toBe("src/a.ts");

      const barrel = resolveImportSpecifier({
        root,
        fromFile: "src/b.ts",
        specifier: "./barrel",
      });
      expect(barrel.confidence).toBe("RESOLVED");
      expect(barrel.resolvedPath).toBe("src/barrel/index.ts");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves tsconfig paths and leaves unresolved packages without inventing edges", () => {
    const root = makeFixture();
    try {
      const cfg = loadTsconfigPaths(root);
      expect(cfg).not.toBeNull();
      expect(cfg?.paths["@/*"]).toEqual(["src/*"]);

      const aliased = resolveImportSpecifier({
        root,
        fromFile: "src/b.ts",
        specifier: "@/utils/math",
        tsconfig: cfg,
      });
      expect(aliased.confidence).toBe("RESOLVED");
      expect(aliased.resolvedPath).toBe("src/utils/math.ts");

      const missing = resolveImportSpecifier({
        root,
        fromFile: "src/b.ts",
        specifier: "@/does-not-exist",
        tsconfig: cfg,
      });
      expect(missing.confidence).toBe("UNRESOLVED");
      expect(missing.resolvedPath).toBeNull();

      const pkg = resolveImportSpecifier({
        root,
        fromFile: "src/b.ts",
        specifier: "lodash",
        tsconfig: cfg,
      });
      expect(pkg.confidence).toBe("UNRESOLVED");
      expect(pkg.resolvedPath).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
