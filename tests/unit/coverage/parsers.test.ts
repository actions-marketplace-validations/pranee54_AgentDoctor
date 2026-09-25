import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parseLcov } from "../../../src/coverage/lcov.js";
import { parseIstanbul } from "../../../src/coverage/istanbul.js";
import { parseCobertura } from "../../../src/coverage/cobertura.js";
import { loadCoverage } from "../../../src/coverage/load.js";

describe("coverage parsers", () => {
  it("parses LCOV line and function hits", () => {
    const text = `
TN:
SF:src/foo.ts
FN:10,bar
FNDA:3,bar
DA:10,3
DA:11,0
DA:12,1
LF:3
LH:2
end_of_record
`.trim();
    const cov = parseLcov(text);
    expect(cov.format).toBe("lcov");
    expect(cov.files["src/foo.ts"]?.lines[10]).toBe(3);
    expect(cov.files["src/foo.ts"]?.lines[11]).toBe(0);
    expect(cov.files["src/foo.ts"]?.functions.find((f) => f.name === "bar")?.hits).toBe(3);
    expect(cov.limitations.some((l) => /no test→source/i.test(l))).toBe(true);
  });

  it("parses Istanbul JSON with optional test map", () => {
    const json = {
      "src/foo.ts": {
        path: "src/foo.ts",
        statementMap: {
          "0": { start: { line: 1 }, end: { line: 1 } },
          "1": { start: { line: 2 }, end: { line: 2 } },
        },
        s: { "0": 5, "1": 0 },
        fnMap: {
          "0": { name: "foo", decl: { start: { line: 1 } } },
        },
        f: { "0": 2 },
        coveredByTests: ["tests/foo.test.ts"],
      },
      testMap: {
        "tests/foo.test.ts": ["src/foo.ts"],
      },
    };
    const cov = parseIstanbul(json);
    expect(cov.format).toBe("istanbul");
    expect(cov.files["src/foo.ts"]?.lines[1]).toBe(5);
    expect(cov.files["src/foo.ts"]?.lines[2]).toBe(0);
    expect(cov.files["src/foo.ts"]?.coveredByTests).toContain("tests/foo.test.ts");
    expect(cov.testToFiles?.["tests/foo.test.ts"]).toContain("src/foo.ts");
  });

  it("parses Cobertura XML class lines without DOM", () => {
    const xml = `<?xml version="1.0"?>
<coverage>
  <packages>
    <package name="src">
      <classes>
        <class name="foo" filename="src/foo.ts">
          <lines>
            <line number="1" hits="4"/>
            <line number="2" hits="0"/>
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>`;
    const cov = parseCobertura(xml);
    expect(cov.format).toBe("cobertura");
    expect(cov.files["src/foo.ts"]?.lines[1]).toBe(4);
    expect(cov.files["src/foo.ts"]?.lines[2]).toBe(0);
  });

  it("loadCoverage auto-detects by extension", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ad-cov-"));
    try {
      const lcovPath = path.join(dir, "coverage.lcov");
      await fs.writeFile(
        lcovPath,
        "SF:src/a.ts\nDA:1,1\nend_of_record\n",
      );
      const loaded = await loadCoverage(lcovPath);
      expect(loaded.format).toBe("lcov");
      expect(loaded.files["src/a.ts"]?.lines[1]).toBe(1);

      const istanbulPath = path.join(dir, "coverage-final.json");
      await fs.writeFile(
        istanbulPath,
        JSON.stringify({
          "src/b.ts": {
            path: "src/b.ts",
            statementMap: { "0": { start: { line: 3 } } },
            s: { "0": 9 },
          },
        }),
      );
      const istanbul = await loadCoverage(istanbulPath);
      expect(istanbul.format).toBe("istanbul");
      expect(istanbul.files["src/b.ts"]?.lines[3]).toBe(9);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
