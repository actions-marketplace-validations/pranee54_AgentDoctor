import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { discoverPlugins, type AgentDoctorPluginManifest } from "./sdk.js";
import { isPathInsideRoot, resolveRepoRoot } from "../utils/path.js";

export interface PluginAnalyzerNote {
  pluginId: string;
  severity: "info" | "warning";
  message: string;
}

export interface PluginAnalyzerResult {
  pluginId: string;
  ok: boolean;
  notes: PluginAnalyzerNote[];
  error?: string;
}

export interface PluginAnalyzerContext {
  repoRoot: string;
  /** Relative paths the host already knows about — plugins must not scan arbitrary FS */
  knownRelativePaths: readonly string[];
}

export type PluginAnalyzeFn = (
  ctx: PluginAnalyzerContext,
) =>
  | Promise<{ notes?: Array<{ severity?: string; message: string }> }>
  | { notes?: Array<{ severity?: string; message: string }> };

/**
 * Run analyzer-capability plugins with per-plugin error isolation and timeouts.
 * Declarative JSON entry (`hooks.json`) or JS/MJS `analyze` export.
 * No network APIs are provided; crashes do not abort other plugins.
 */
export async function runPluginAnalyzers(
  rootInput: string,
  options?: { knownRelativePaths?: string[]; timeoutMs?: number },
): Promise<PluginAnalyzerResult[]> {
  const repoRoot = resolveRepoRoot(rootInput);
  const plugins = await discoverPlugins(repoRoot);
  const known = options?.knownRelativePaths ?? [];
  const timeoutMs = options?.timeoutMs ?? 3_000;
  const results: PluginAnalyzerResult[] = [];

  for (const plugin of plugins) {
    if (!plugin.ok) {
      results.push({
        pluginId: plugin.manifest.id,
        ok: false,
        notes: [],
        error: plugin.errors.join("; ") || "invalid plugin",
      });
      continue;
    }
    if (!plugin.manifest.capabilities.includes("analyzer")) {
      continue;
    }
    try {
      results.push(await runOneAnalyzer(repoRoot, plugin.manifest, plugin.root, known, timeoutMs));
    } catch (error) {
      results.push({
        pluginId: plugin.manifest.id,
        ok: false,
        notes: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
}

async function runOneAnalyzer(
  repoRoot: string,
  manifest: AgentDoctorPluginManifest,
  pluginRoot: string,
  knownRelativePaths: readonly string[],
  timeoutMs: number,
): Promise<PluginAnalyzerResult> {
  const entry = manifest.entry ?? "hooks.json";
  const entryPath = path.resolve(pluginRoot, entry);
  if (!isPathInsideRoot(pluginRoot, entryPath)) {
    return {
      pluginId: manifest.id,
      ok: false,
      notes: [],
      error: "plugin entry escapes plugin root",
    };
  }

  const ctx: PluginAnalyzerContext = {
    repoRoot,
    knownRelativePaths,
  };

  if (entry.endsWith(".json")) {
    const raw = JSON.parse(await fs.readFile(entryPath, "utf8")) as {
      notes?: Array<{ severity?: string; message: string }>;
    };
    return normalizeNotes(manifest, raw.notes ?? []);
  }

  const mod = await withTimeout(import(pathToFileURL(entryPath).href), timeoutMs);
  const analyze: PluginAnalyzeFn | undefined =
    (mod as { analyze?: PluginAnalyzeFn }).analyze ??
    (mod as { default?: PluginAnalyzeFn }).default;
  if (typeof analyze !== "function") {
    return {
      pluginId: manifest.id,
      ok: false,
      notes: [],
      error: "plugin entry missing analyze() export",
    };
  }

  const out = await withTimeout(Promise.resolve(analyze(ctx)), timeoutMs);
  return normalizeNotes(manifest, out?.notes ?? []);
}

function normalizeNotes(
  manifest: AgentDoctorPluginManifest,
  notes: Array<{ severity?: string; message: string }>,
): PluginAnalyzerResult {
  return {
    pluginId: manifest.id,
    ok: true,
    notes: notes
      .filter((n) => typeof n.message === "string" && n.message.trim().length > 0)
      .map((n) => ({
        pluginId: manifest.id,
        severity: n.severity === "warning" ? ("warning" as const) : ("info" as const),
        message: n.message.slice(0, 500),
      })),
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`plugin timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
