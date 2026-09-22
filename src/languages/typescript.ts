import { createHash } from "node:crypto";
import ts from "typescript";

import type { LanguageAdapter, ParseResult } from "./types.js";

function sid(kind: string, key: string): string {
  return `${kind}:${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
}

function parseTsJs(
  filePath: string,
  source: string,
  language: "typescript" | "javascript",
): ParseResult {
  const kind = language === "typescript" ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.ES2022, true, kind);
  const symbols: ParseResult["symbols"] = [];
  const imports: ParseResult["imports"] = [];
  const calls: ParseResult["calls"] = [];
  const diagnostics: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.text;
      symbols.push({
        id: sid("fn", `${filePath}:${name}`),
        name,
        kind: "function",
        file: filePath,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        evidence: "ast",
      });
    }
    if (ts.isClassDeclaration(node) && node.name) {
      const name = node.name.text;
      symbols.push({
        id: sid("class", `${filePath}:${name}`),
        name,
        kind: "class",
        file: filePath,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        evidence: "ast",
      });
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push({
        fromFile: filePath,
        specifier: node.moduleSpecifier.text,
        evidence: "ast",
      });
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf);
      calls.push({ fromFile: filePath, callee, evidence: "ast" });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return {
    language,
    file: filePath,
    ok: true,
    capabilities: {
      parse: "supported",
      symbols: "supported",
      definitions: "supported",
      imports: "supported",
      calls: "supported",
      references: "unsupported",
      diagnostics: "unsupported",
    },
    symbols,
    imports,
    calls,
    diagnostics,
    limitations: [
      "TypeScript compiler API parse (single-file); cross-file references unsupported in adapter",
    ],
  };
}

export const typescriptAdapter: LanguageAdapter = {
  id: "typescript",
  extensions: [".ts", ".tsx", ".mts", ".cts"],
  capabilities: () => ({
    parse: "supported",
    symbols: "supported",
    definitions: "supported",
    imports: "supported",
    calls: "supported",
    references: "unsupported",
    diagnostics: "unsupported",
  }),
  async parse(filePath, source) {
    return parseTsJs(filePath, source, "typescript");
  },
};

export const javascriptAdapter: LanguageAdapter = {
  id: "javascript",
  extensions: [".js", ".jsx", ".mjs", ".cjs"],
  capabilities: () => typescriptAdapter.capabilities(),
  async parse(filePath, source) {
    return parseTsJs(filePath, source, "javascript");
  },
};
