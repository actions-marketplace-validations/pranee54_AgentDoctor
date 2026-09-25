import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  checkArchitecture,
  initArchitecture,
  layerForPath,
  loadArchitectureContract,
  parseArchitectureYamlSubset,
  DEFAULT_ARCHITECTURE_CONTRACT,
} from "../../../src/architecture/contract.js";
import type { RepositoryGraph } from "../../../src/platform/types.js";

function sampleGraph(): RepositoryGraph {
  return {
    root: "/tmp/repo",
    generatedAt: new Date().toISOString(),
    nodes: [
      { id: "file:src/core/a.ts", kind: "file", label: "a.ts", path: "src/core/a.ts" },
      { id: "file:src/cli/b.ts", kind: "file", label: "b.ts", path: "src/cli/b.ts" },
      { id: "file:tests/a.test.ts", kind: "test", label: "a.test.ts", path: "tests/a.test.ts" },
    ],
    edges: [
      {
        id: "e1",
        from: "file:src/core/a.ts",
        to: "file:src/cli/b.ts",
        kind: "imports",
        evidence: "inferred",
      },
      {
        id: "e2",
        from: "file:tests/a.test.ts",
        to: "file:src/core/a.ts",
        kind: "imports",
        evidence: "inferred",
      },
    ],
    limitations: [],
  };
}

describe("architecture contract", () => {
  it("assigns layers by longest path prefix", () => {
    const layers = DEFAULT_ARCHITECTURE_CONTRACT.layers;
    expect(layerForPath("src/core/foo.ts", layers)).toBe("core");
    expect(layerForPath("src/cli/program.ts", layers)).toBe("cli");
    expect(layerForPath("tests/unit/x.test.ts", layers)).toBe("tests");
  });

  it("parses JSON-compatible architecture.yml subset", () => {
    const yml = `
version: "1"
layers:
  - id: app
    paths: ["src/"]
  - id: tests
    paths: ["tests/"]
forbidden:
  - id: app-no-tests
    fromLayer: app
    toLayer: tests
    description: app must not import tests
allowed:
  - fromLayer: tests
    toLayer: app
`.trim();
    const contract = parseArchitectureYamlSubset(yml);
    expect(contract.version).toBe("1");
    expect(contract.layers).toHaveLength(2);
    expect(contract.forbidden[0]?.id).toBe("app-no-tests");
    expect(contract.allowed[0]?.fromLayer).toBe("tests");
  });

  it("detects forbidden import violations with edge evidence", () => {
    const result = checkArchitecture("/tmp/repo", sampleGraph(), DEFAULT_ARCHITECTURE_CONTRACT);
    expect(result.importEdgesChecked).toBe(2);
    const forbidden = result.violations.filter((v) => v.kind === "forbidden");
    expect(forbidden.some((v) => v.ruleId === "core-must-not-import-cli")).toBe(true);
    expect(forbidden[0]?.evidence.edgeKind).toBe("imports");
  });

  it("init writes architecture.json and load reads it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ad-arch-"));
    try {
      const written = await initArchitecture(root);
      expect(written).toContain("architecture.json");
      const loaded = await loadArchitectureContract(root);
      expect(loaded?.contract.version).toBe("1");
      expect(loaded?.contract.layers.length).toBeGreaterThan(0);
      // second init does not overwrite
      const again = await initArchitecture(root);
      expect(again).toBe(written);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
