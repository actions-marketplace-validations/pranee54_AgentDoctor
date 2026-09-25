import fs from "node:fs/promises";
import path from "node:path";

import { resolveRepoRoot, isPathInsideRoot } from "../utils/path.js";

export type PluginCapability = "rule" | "reporter" | "analyzer";

export interface AgentDoctorPluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: "2.0";
  capabilities: PluginCapability[];
  /** Declared only — runtime does not grant network/fs beyond the sandbox root. */
  requestedPermissions?: Array<"read-repo" | "none">;
  entry?: string;
}

export interface PluginLoadResult {
  manifest: AgentDoctorPluginManifest;
  root: string;
  ok: boolean;
  errors: string[];
}

export interface PluginSandbox {
  repoRoot: string;
  pluginRoot: string;
}

const ALLOWED_CAPABILITIES = new Set<PluginCapability>(["rule", "reporter", "analyzer"]);

export function validatePluginManifest(raw: unknown): {
  ok: boolean;
  manifest?: AgentDoctorPluginManifest;
  errors: string[];
} {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") {
    return { ok: false, errors: ["manifest must be an object"] };
  }
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== "string" || !m.id.trim()) errors.push("id required");
  if (typeof m.name !== "string" || !m.name.trim()) errors.push("name required");
  if (typeof m.version !== "string" || !m.version.trim()) errors.push("version required");
  if (m.apiVersion !== "2.0") errors.push('apiVersion must be "2.0"');
  if (!Array.isArray(m.capabilities) || m.capabilities.length === 0) {
    errors.push("capabilities required");
  } else {
    for (const c of m.capabilities) {
      if (!ALLOWED_CAPABILITIES.has(c as PluginCapability)) {
        errors.push(`unsupported capability: ${String(c)}`);
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  const manifest: AgentDoctorPluginManifest = {
    id: String(m.id),
    name: String(m.name),
    version: String(m.version),
    apiVersion: "2.0",
    capabilities: m.capabilities as PluginCapability[],
  };
  if (Array.isArray(m.requestedPermissions)) {
    manifest.requestedPermissions = m.requestedPermissions as NonNullable<
      AgentDoctorPluginManifest["requestedPermissions"]
    >;
  }
  if (typeof m.entry === "string") {
    manifest.entry = m.entry;
  }
  return {
    ok: true,
    errors: [],
    manifest,
  };
}

/** Discover plugins under .agentdoctor/plugins/<id>/plugin.json (validated, no network). */
export async function discoverPlugins(rootInput: string): Promise<PluginLoadResult[]> {
  const root = resolveRepoRoot(rootInput);
  const pluginsRoot = path.join(root, ".agentdoctor", "plugins");
  let dirs: string[] = [];
  try {
    const entries = await fs.readdir(pluginsRoot, { withFileTypes: true });
    dirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(pluginsRoot, e.name));
  } catch {
    return [];
  }

  const results: PluginLoadResult[] = [];
  for (const dir of dirs) {
    if (!isPathInsideRoot(pluginsRoot, dir)) continue;
    const manifestPath = path.join(dir, "plugin.json");
    try {
      const raw = JSON.parse(await fs.readFile(manifestPath, "utf8")) as unknown;
      const validated = validatePluginManifest(raw);
      if (!validated.ok || !validated.manifest) {
        results.push({
          manifest: {
            id: path.basename(dir),
            name: path.basename(dir),
            version: "0.0.0",
            apiVersion: "2.0",
            capabilities: ["analyzer"],
          },
          root: dir,
          ok: false,
          errors: validated.errors,
        });
        continue;
      }
      results.push({
        manifest: validated.manifest,
        root: dir,
        ok: true,
        errors: [],
      });
    } catch (error) {
      results.push({
        manifest: {
          id: path.basename(dir),
          name: path.basename(dir),
          version: "0.0.0",
          apiVersion: "2.0",
          capabilities: ["analyzer"],
        },
        root: dir,
        ok: false,
        errors: [error instanceof Error ? error.message : String(error)],
      });
    }
  }
  return results.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
}

export function createPluginSandbox(repoRoot: string, pluginRoot: string): PluginSandbox {
  return {
    repoRoot: resolveRepoRoot(repoRoot),
    pluginRoot: path.resolve(pluginRoot),
  };
}
