/**
 * Measured large-repo AST performance harness.
 * Writes JSON results — does not invent numbers.
 *
 * Usage: AD_PERF_FILES=120 node scripts/perf/ast-graph.mjs
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

async function generateFixture(fileCount) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ad-perf-mono-"));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "perf-mono", private: true, type: "module" }, null, 2),
  );
  await fs.writeFile(
    path.join(root, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", strict: true } }),
  );
  for (let i = 0; i < fileCount; i += 1) {
    const dir = path.join(root, "packages", `pkg${i % 10}`, "src");
    await fs.mkdir(dir, { recursive: true });
    const dep =
      i > 0 ? `import { fn${i - 1} } from "../../pkg${(i - 1) % 10}/src/mod${i - 1}.js";\n` : "";
    const body = `${dep}export function fn${i}(x: number): number { return x + ${i}; }\nexport class C${i} { value() { return fn${i}(${i}); } }\n`;
    await fs.writeFile(path.join(dir, `mod${i}.ts`), body);
  }
  return root;
}

async function main() {
  const fileCount = Number(process.env.AD_PERF_FILES ?? "120");
  const root = await generateFixture(fileCount);
  const { buildIntelligenceGraph } = await import(
    pathToFileURL(path.join(repoRoot, "dist/intelligence/graph/build.js")).href
  );

  const memBefore = process.memoryUsage();
  const t0 = performance.now();
  const cold = await buildIntelligenceGraph({ root, mode: "typescript-ast" });
  const t1 = performance.now();
  const warm = await buildIntelligenceGraph({ root, mode: "typescript-ast" });
  const t2 = performance.now();
  const memAfter = process.memoryUsage();

  const imports = (cold.edges ?? []).filter((e) => e.kind === "imports").length;
  const calls = (cold.edges ?? []).filter((e) => e.kind === "calls").length;

  const result = {
    measuredAt: new Date().toISOString(),
    host: { platform: process.platform, arch: process.arch, node: process.version },
    fixture: {
      root,
      requestedTsFiles: fileCount,
      packages: 10,
    },
    cold: {
      durationMs: Math.round(t1 - t0),
      builder: cold.builder,
      astFilesParsed: cold.astFilesParsed,
      nodes: cold.nodes?.length ?? 0,
      edges: cold.edges?.length ?? 0,
      importEdges: imports,
      callEdges: calls,
    },
    repeated: {
      durationMs: Math.round(t2 - t1),
      nodes: warm.nodes?.length ?? 0,
      edges: warm.edges?.length ?? 0,
    },
    memory: {
      rssBeforeMb: Math.round(memBefore.rss / 1024 / 1024),
      rssAfterMb: Math.round(memAfter.rss / 1024 / 1024),
      heapUsedAfterMb: Math.round(memAfter.heapUsed / 1024 / 1024),
    },
    limitations: [
      "Synthetic fixture; not a real production monorepo",
      "No claim of horizontal scalability from this single run",
      "Repeated run is still a full rebuild (incremental indexing incomplete)",
      ...(cold.limitations ?? []),
    ],
  };

  const outDir = path.join(repoRoot, "benchmarks");
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, "ast-graph-perf-latest.json");
  await fs.writeFile(outFile, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`Wrote ${outFile}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
