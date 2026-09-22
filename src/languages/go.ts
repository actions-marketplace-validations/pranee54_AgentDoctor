import { spawnSync } from "node:child_process";

import type { LanguageAdapter, ParseResult } from "./types.js";

/**
 * Go toolchain bridge placeholder.
 * Prefer real `go/ast` via `go run` when the Go toolchain is present; until an
 * extractor is bundled, capability remains unsupported even if `go` exists.
 * Today: always unsupported (no bundled extractor; avoids fake AST claims).
 */
export function goAvailable(): boolean {
  const r = spawnSync("go", ["version"], { encoding: "utf8" });
  return r.status === 0;
}

export const goAdapter: LanguageAdapter = {
  id: "go",
  extensions: [".go"],
  capabilities: () => ({
    parse: "unsupported",
    symbols: "unsupported",
    definitions: "unsupported",
    references: "unsupported",
    imports: "unsupported",
    calls: "unsupported",
    diagnostics: "unsupported",
  }),
  async parse(filePath, _source): Promise<ParseResult> {
    const hasGo = goAvailable();
    return {
      language: "go",
      file: filePath,
      ok: false,
      capabilities: goAdapter.capabilities(),
      symbols: [],
      imports: [],
      calls: [],
      diagnostics: [
        hasGo
          ? "Go toolchain present but AgentDoctor go/ast extractor is not bundled yet"
          : "go not available on PATH",
      ],
      limitations: [
        "Go AST requires a go/ast bridge or tree-sitter-go; not shipped in this package",
        "Capability remains unsupported — no regex fallback under an AST claim",
      ],
    };
  },
};
