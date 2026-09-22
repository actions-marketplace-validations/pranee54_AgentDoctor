import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import type { LanguageAdapter } from "./types.js";

function sid(kind: string, key: string): string {
  return `${kind}:${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
}

const PYTHON_PROBE_TIMEOUT_MS = 5_000;

/**
 * Prefer real interpreters; skip hanging Windows Store `python3` stubs via timeout.
 */
function pythonCandidates(): string[] {
  return process.platform === "win32"
    ? ["python", "py", "python3"]
    : ["python3", "python"];
}

let cachedPythonBin: string | null | undefined;

/**
 * Resolve a working CPython binary, or null if none responds in time.
 */
export function resolvePythonBin(): string | null {
  if (cachedPythonBin !== undefined) return cachedPythonBin;
  for (const bin of pythonCandidates()) {
    const r = spawnSync(bin, ["-c", "import ast, json"], {
      encoding: "utf8",
      timeout: PYTHON_PROBE_TIMEOUT_MS,
      windowsHide: true,
    });
    if (r.status === 0 && !r.error) {
      cachedPythonBin = bin;
      return bin;
    }
  }
  cachedPythonBin = null;
  return null;
}

/**
 * Real Python AST via the CPython `ast` module (requires python on PATH).
 * Not regex. If no interpreter is available, capabilities are unsupported.
 */
export function pythonAvailable(): boolean {
  return resolvePythonBin() !== null;
}

const PY_EXTRACTOR = `
import ast, json, sys
source = sys.stdin.read()
path = sys.argv[1]
try:
    tree = ast.parse(source, filename=path)
except SyntaxError as e:
    print(json.dumps({"ok": False, "error": str(e), "symbols": [], "imports": [], "calls": []}))
    sys.exit(0)
symbols = []
imports = []
calls = []
for node in ast.walk(tree):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        symbols.append({"name": node.name, "kind": "function", "line": node.lineno})
    elif isinstance(node, ast.ClassDef):
        symbols.append({"name": node.name, "kind": "class", "line": node.lineno})
    elif isinstance(node, ast.Import):
        for a in node.names:
            imports.append({"specifier": a.name})
    elif isinstance(node, ast.ImportFrom):
        mod = node.module or ""
        imports.append({"specifier": mod if mod else "."})
    elif isinstance(node, ast.Call):
        try:
            callee = ast.unparse(node.func)
        except Exception:
            callee = type(node.func).__name__
        calls.append({"callee": callee})
print(json.dumps({"ok": True, "symbols": symbols, "imports": imports, "calls": calls}))
`;

export const pythonAdapter: LanguageAdapter = {
  id: "python",
  extensions: [".py"],
  capabilities: () => {
    const ok = pythonAvailable();
    const v = ok ? "supported" : "unsupported";
    return {
      parse: v,
      symbols: v,
      definitions: v,
      imports: v,
      calls: v,
      references: "unsupported",
      diagnostics: ok ? "supported" : "unsupported",
    };
  },
  async parse(filePath, source) {
    const pythonBin = resolvePythonBin();
    if (!pythonBin) {
      return {
        language: "python",
        file: filePath,
        ok: false,
        capabilities: pythonAdapter.capabilities(),
        symbols: [],
        imports: [],
        calls: [],
        diagnostics: ["python not available on PATH"],
        limitations: ["Python AST adapter requires python3/python with stdlib ast module"],
      };
    }
    const r = spawnSync(pythonBin, ["-c", PY_EXTRACTOR, filePath], {
      input: source,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 15_000,
      windowsHide: true,
    });
    if (r.status !== 0 || !r.stdout) {
      return {
        language: "python",
        file: filePath,
        ok: false,
        capabilities: pythonAdapter.capabilities(),
        symbols: [],
        imports: [],
        calls: [],
        diagnostics: [r.stderr || r.error?.message || "python extractor failed"],
        limitations: [],
      };
    }
    let parsed: {
      ok: boolean;
      error?: string;
      symbols: Array<{ name: string; kind: string; line: number }>;
      imports: Array<{ specifier: string }>;
      calls: Array<{ callee: string }>;
    };
    try {
      parsed = JSON.parse(r.stdout);
    } catch {
      return {
        language: "python",
        file: filePath,
        ok: false,
        capabilities: pythonAdapter.capabilities(),
        symbols: [],
        imports: [],
        calls: [],
        diagnostics: ["invalid JSON from python extractor"],
        limitations: [],
      };
    }
    if (!parsed.ok) {
      return {
        language: "python",
        file: filePath,
        ok: false,
        capabilities: pythonAdapter.capabilities(),
        symbols: [],
        imports: [],
        calls: [],
        diagnostics: [parsed.error ?? "parse error"],
        limitations: [],
      };
    }
    return {
      language: "python",
      file: filePath,
      ok: true,
      capabilities: pythonAdapter.capabilities(),
      symbols: parsed.symbols.map((s) => ({
        id: sid(s.kind, `${filePath}:${s.name}:${s.line}`),
        name: s.name,
        kind: s.kind,
        file: filePath,
        line: s.line,
        evidence: "ast" as const,
      })),
      imports: parsed.imports.map((i) => ({
        fromFile: filePath,
        specifier: i.specifier,
        evidence: "ast" as const,
      })),
      calls: parsed.calls.map((c) => ({
        fromFile: filePath,
        callee: c.callee,
        evidence: "ast" as const,
      })),
      diagnostics: [],
      limitations: ["Cross-file references not resolved; CPython ast single-file only"],
    };
  },
};
