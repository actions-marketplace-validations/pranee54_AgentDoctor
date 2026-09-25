import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import type { LanguageAdapter } from "./types.js";

function sid(kind: string, key: string): string {
  return `${kind}:${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
}

const PHP_PROBE_TIMEOUT_MS = 5_000;
const PHP_EXTRACT_TIMEOUT_MS = 15_000;

/**
 * Real PHP token extractor via `php -r` + token_get_all (requires `php` on PATH).
 * Not regex. If php is missing, capabilities are unsupported.
 * Probe timeout skips hanging Windows Store / stub `php` binaries.
 */
export function phpAvailable(): boolean {
  const r = spawnSync("php", ["-r", "echo PHP_VERSION;"], {
    encoding: "utf8",
    timeout: PHP_PROBE_TIMEOUT_MS,
    windowsHide: true,
  });
  return r.status === 0 && !r.error && Boolean(r.stdout?.trim());
}

const PHP_EXTRACTOR = `
$source = stream_get_contents(STDIN);
$path = $argv[1] ?? "stdin.php";
if ($source === false || $source === "") {
  echo json_encode(["ok" => false, "error" => "empty source", "symbols" => [], "imports" => [], "calls" => []]);
  exit(0);
}
if (strpos($source, "<?") === false) {
  $source = "<?php\\n" . $source;
}
$tokens = @token_get_all($source);
if (!is_array($tokens)) {
  echo json_encode(["ok" => false, "error" => "token_get_all failed", "symbols" => [], "imports" => [], "calls" => []]);
  exit(0);
}
$symbols = [];
$imports = [];
$calls = [];
$count = count($tokens);
for ($i = 0; $i < $count; $i++) {
  $t = $tokens[$i];
  if (!is_array($t)) continue;
  [$id, $text, $line] = $t;
  if ($id === T_FUNCTION) {
    for ($j = $i + 1; $j < $count; $j++) {
      $n = $tokens[$j];
      if (!is_array($n)) continue;
      if ($n[0] === T_STRING) {
        $symbols[] = ["name" => $n[1], "kind" => "function", "line" => $n[2]];
        break;
      }
      if ($n[0] === T_WHITESPACE || $n[0] === T_COMMENT || $n[0] === T_DOC_COMMENT) continue;
      break;
    }
  } elseif ($id === T_CLASS || $id === T_INTERFACE || $id === T_TRAIT) {
    $kind = $id === T_CLASS ? "class" : ($id === T_INTERFACE ? "interface" : "trait");
    for ($j = $i + 1; $j < $count; $j++) {
      $n = $tokens[$j];
      if (!is_array($n)) continue;
      if ($n[0] === T_STRING) {
        $symbols[] = ["name" => $n[1], "kind" => $kind, "line" => $n[2]];
        break;
      }
      if ($n[0] === T_WHITESPACE || $n[0] === T_COMMENT || $n[0] === T_DOC_COMMENT) continue;
      break;
    }
  } elseif ($id === T_USE) {
    $spec = "";
    for ($j = $i + 1; $j < $count; $j++) {
      $n = $tokens[$j];
      if (is_array($n)) {
        if ($n[0] === T_STRING || $n[0] === T_NS_SEPARATOR || $n[0] === T_NAME_QUALIFIED || $n[0] === T_NAME_FULLY_QUALIFIED) {
          $spec .= $n[1];
          continue;
        }
        if ($n[0] === T_WHITESPACE) continue;
        break;
      }
      if ($n === ";" || $n === "{") break;
    }
    if ($spec !== "") $imports[] = ["specifier" => $spec];
  } elseif ($id === T_STRING) {
    $next = $tokens[$i + 1] ?? null;
    $prev = $tokens[$i - 1] ?? null;
    $prevIsObject = is_array($prev) && ($prev[0] === T_OBJECT_OPERATOR || $prev[0] === T_NULLSAFE_OBJECT_OPERATOR || $prev[0] === T_DOUBLE_COLON);
    if ($next === "(" && !$prevIsObject) {
      $calls[] = ["callee" => $text, "line" => $line];
    }
  }
}
echo json_encode(["ok" => true, "symbols" => $symbols, "imports" => $imports, "calls" => $calls], JSON_UNESCAPED_SLASHES);
`;

export const phpAdapter: LanguageAdapter = {
  id: "php",
  extensions: [".php"],
  capabilities: () => {
    const ok = phpAvailable();
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
    if (!phpAvailable()) {
      return {
        language: "php",
        file: filePath,
        ok: false,
        capabilities: phpAdapter.capabilities(),
        symbols: [],
        imports: [],
        calls: [],
        diagnostics: ["php not available on PATH"],
        limitations: ["PHP adapter requires php CLI with token_get_all"],
      };
    }
    const r = spawnSync("php", ["-r", PHP_EXTRACTOR, "--", filePath], {
      input: source,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: PHP_EXTRACT_TIMEOUT_MS,
      windowsHide: true,
    });
    if (r.status !== 0 || !r.stdout) {
      return {
        language: "php",
        file: filePath,
        ok: false,
        capabilities: phpAdapter.capabilities(),
        symbols: [],
        imports: [],
        calls: [],
        diagnostics: [r.stderr || "php extractor failed"],
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
        language: "php",
        file: filePath,
        ok: false,
        capabilities: phpAdapter.capabilities(),
        symbols: [],
        imports: [],
        calls: [],
        diagnostics: ["invalid JSON from php extractor"],
        limitations: [],
      };
    }
    if (!parsed.ok) {
      return {
        language: "php",
        file: filePath,
        ok: false,
        capabilities: phpAdapter.capabilities(),
        symbols: [],
        imports: [],
        calls: [],
        diagnostics: [parsed.error ?? "parse error"],
        limitations: [],
      };
    }
    return {
      language: "php",
      file: filePath,
      ok: true,
      capabilities: phpAdapter.capabilities(),
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
      limitations: [
        "PHP token_get_all single-file extract — not a full php-parser AST; cross-file refs unsupported",
      ],
    };
  },
};
