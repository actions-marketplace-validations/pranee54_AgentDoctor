import type { LanguageAdapter, LanguageId, ParseResult } from "./types.js";
import { detectLanguage } from "./types.js";
import { javascriptAdapter, typescriptAdapter } from "./typescript.js";
import { pythonAdapter } from "./python.js";
import { phpAdapter } from "./php.js";
import { goAdapter } from "./go.js";

function unsupportedAdapter(id: LanguageId, extensions: string[], reason: string): LanguageAdapter {
  return {
    id,
    extensions,
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
      return {
        language: id,
        file: filePath,
        ok: false,
        capabilities: this.capabilities(),
        symbols: [],
        imports: [],
        calls: [],
        diagnostics: [reason],
        limitations: [
          reason,
          "No regex fallback is offered under an AST claim — capability remains unsupported until a mature parser is integrated",
        ],
      };
    },
  };
}

/** Languages with real AST backends today (or honest unsupported stubs). */
export const languageAdapters: LanguageAdapter[] = [
  typescriptAdapter,
  javascriptAdapter,
  pythonAdapter,
  phpAdapter,
  goAdapter,
  unsupportedAdapter(
    "java",
    [".java"],
    "Java AST requires an external parser (e.g. tree-sitter-java or javaparser); not bundled",
  ),
  unsupportedAdapter(
    "kotlin",
    [".kt", ".kts"],
    "Kotlin AST requires an external parser; not bundled",
  ),
  unsupportedAdapter(
    "rust",
    [".rs"],
    "Rust AST requires syn/rustc or tree-sitter-rust; not bundled",
  ),
  unsupportedAdapter("dart", [".dart"], "Dart AST requires Dart analyzer APIs; not bundled"),
];

export function getAdapterForFile(filePath: string): LanguageAdapter | null {
  const lang = detectLanguage(filePath);
  if (lang === "unknown") return null;
  return languageAdapters.find((a) => a.id === lang) ?? null;
}

export async function parseSourceFile(filePath: string, source: string): Promise<ParseResult> {
  const adapter = getAdapterForFile(filePath);
  if (!adapter) {
    return {
      language: "unknown",
      file: filePath,
      ok: false,
      capabilities: {},
      symbols: [],
      imports: [],
      calls: [],
      diagnostics: ["unknown language"],
      limitations: ["No language adapter for this file extension"],
    };
  }
  return adapter.parse(filePath, source);
}

export { detectLanguage } from "./types.js";
export { typescriptAdapter, javascriptAdapter } from "./typescript.js";
export { pythonAdapter, pythonAvailable } from "./python.js";
export { phpAdapter, phpAvailable } from "./php.js";
export { goAdapter, goAvailable } from "./go.js";
export type { LanguageAdapter, ParseResult, LanguageId } from "./types.js";
