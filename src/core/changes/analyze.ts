import { spawnSync } from "node:child_process";
import path from "node:path";

import { loadLatestBrain } from "../brain-cli/service.js";
import type { ProjectBrain } from "../understanding/brain/types.js";
import { resolveRepoRoot } from "../../utils/path.js";

export type ChangeKind = "added" | "modified" | "deleted" | "renamed" | "untracked" | "unknown";

export interface ChangedFile {
  path: string;
  kind: ChangeKind;
  staged: boolean;
  /** Module / component attribution when Brain evidence matches this path */
  modules?: string[];
}

export interface ImpactEdge {
  from: string;
  to: string;
  type: string;
  confidence: number;
}

export interface ChangeImpact {
  status: "observed" | "unknown";
  reason: string;
  edges: ImpactEdge[];
  relatedPaths: string[];
}

export interface ChangeReport {
  root: string;
  gitAvailable: boolean;
  head: string | null;
  since: string | null;
  files: ChangedFile[];
  summary: {
    added: number;
    modified: number;
    deleted: number;
    renamed: number;
    untracked: number;
  };
  impact?: ChangeImpact;
  limitations: string[];
}

function runGit(root: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

function parseNameStatus(line: string, staged: boolean): ChangedFile | null {
  const trimmed = line.trimEnd();
  if (!trimmed) {
    return null;
  }
  const parts = trimmed.split(/\t/);
  const code = parts[0]?.trim() ?? "";
  if (!code) {
    return null;
  }
  const kindChar = code[0] ?? "";
  let kind: ChangeKind = "unknown";
  if (kindChar === "A") kind = "added";
  else if (kindChar === "M") kind = "modified";
  else if (kindChar === "D") kind = "deleted";
  else if (kindChar === "R") kind = "renamed";
  const filePath = parts.length >= 3 ? (parts[2] ?? parts[1] ?? "") : (parts[1] ?? "");
  if (!filePath) {
    return null;
  }
  return { path: filePath.split(path.sep).join("/"), kind, staged };
}

function pathMatches(changed: string, candidate: string): boolean {
  const a = changed.replace(/^\.\//, "");
  const b = candidate.replace(/^\.\//, "").split(path.sep).join("/");
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`) || b.endsWith(`/${a}`);
}

function attributeModules(brain: ProjectBrain, filePath: string): string[] {
  const hits = new Set<string>();
  for (const component of brain.components) {
    if (pathMatches(filePath, component.path) || pathMatches(filePath, component.name)) {
      hits.add(component.name || component.id);
    }
  }
  for (const domain of brain.model.domains) {
    for (const p of domain.paths) {
      if (pathMatches(filePath, p)) {
        hits.add(domain.name || domain.id);
      }
    }
  }
  return [...hits].sort();
}

function computeImpact(brain: ProjectBrain | null, files: ChangedFile[]): ChangeImpact {
  if (!brain) {
    return {
      status: "unknown",
      reason: "No Project Brain snapshot available; run agentdoctor brain rebuild",
      edges: [],
      relatedPaths: [],
    };
  }
  const deps = brain.model.dependencies;
  if (!deps || deps.length === 0) {
    return {
      status: "unknown",
      reason: "No observed dependency edges in Project Brain",
      edges: [],
      relatedPaths: [],
    };
  }

  const changed = new Set(files.map((f) => f.path));
  const edges: ImpactEdge[] = [];
  const related = new Set<string>();

  for (const dep of deps) {
    const fromHit = [...changed].some((p) => pathMatches(p, dep.from));
    const toHit = [...changed].some((p) => pathMatches(p, dep.to));
    if (fromHit || toHit) {
      edges.push({
        from: dep.from,
        to: dep.to,
        type: dep.type,
        confidence: dep.confidence,
      });
      related.add(dep.from);
      related.add(dep.to);
    }
  }

  if (edges.length === 0) {
    return {
      status: "unknown",
      reason: "No dependency edges touch the changed files (evidence insufficient)",
      edges: [],
      relatedPaths: [],
    };
  }

  return {
    status: "observed",
    reason: `${edges.length} observed dependency edge(s) touch changed files`,
    edges: edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    relatedPaths: [...related].sort(),
  };
}

export async function analyzeChanges(options: {
  root: string;
  since?: string;
  impact?: boolean;
}): Promise<ChangeReport> {
  const root = resolveRepoRoot(options.root);
  const limitations: string[] = [];
  const probe = runGit(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!probe.ok || probe.stdout.trim() !== "true") {
    return {
      root,
      gitAvailable: false,
      head: null,
      since: options.since ?? null,
      files: [],
      summary: { added: 0, modified: 0, deleted: 0, renamed: 0, untracked: 0 },
      ...(options.impact
        ? {
            impact: {
              status: "unknown" as const,
              reason: "Git repository not available",
              edges: [],
              relatedPaths: [],
            },
          }
        : {}),
      limitations: ["Git repository not available; change intelligence degraded"],
    };
  }

  const head = runGit(root, ["rev-parse", "HEAD"]);
  const headId = head.ok ? head.stdout.trim() : null;
  const files: ChangedFile[] = [];

  if (options.since) {
    const diff = runGit(root, ["diff", "--name-status", `${options.since}...HEAD`]);
    if (!diff.ok) {
      limitations.push(
        `Unable to diff since ${options.since}: ${diff.stderr.trim() || "git error"}`,
      );
    } else {
      for (const line of diff.stdout.split(/\r?\n/)) {
        const parsed = parseNameStatus(line, false);
        if (parsed) files.push(parsed);
      }
    }
  } else {
    const staged = runGit(root, ["diff", "--cached", "--name-status"]);
    if (staged.ok) {
      for (const line of staged.stdout.split(/\r?\n/)) {
        const parsed = parseNameStatus(line, true);
        if (parsed) files.push(parsed);
      }
    }
    const unstaged = runGit(root, ["diff", "--name-status"]);
    if (unstaged.ok) {
      for (const line of unstaged.stdout.split(/\r?\n/)) {
        const parsed = parseNameStatus(line, false);
        if (parsed) files.push(parsed);
      }
    }
    const untracked = runGit(root, ["ls-files", "--others", "--exclude-standard"]);
    if (untracked.ok) {
      for (const line of untracked.stdout.split(/\r?\n/)) {
        const p = line.trim();
        if (p) {
          files.push({ path: p.split(path.sep).join("/"), kind: "untracked", staged: false });
        }
      }
    }
  }

  let brain: ProjectBrain | null = null;
  if (options.impact || files.length > 0) {
    try {
      brain = await loadLatestBrain(root);
    } catch {
      brain = null;
    }
  }

  if (brain) {
    for (const file of files) {
      const modules = attributeModules(brain, file.path);
      if (modules.length > 0) {
        file.modules = modules;
      }
    }
  } else if (options.impact) {
    limitations.push("Project Brain unavailable for module attribution");
  }

  const summary = {
    added: files.filter((f) => f.kind === "added").length,
    modified: files.filter((f) => f.kind === "modified").length,
    deleted: files.filter((f) => f.kind === "deleted").length,
    renamed: files.filter((f) => f.kind === "renamed").length,
    untracked: files.filter((f) => f.kind === "untracked").length,
  };

  const impact = options.impact ? computeImpact(brain, files) : undefined;
  if (!options.impact) {
    limitations.push(
      "Pass --impact to compute observed dependency impact from Project Brain (UNKNOWN when evidence is missing)",
    );
  }

  return {
    root,
    gitAvailable: true,
    head: headId,
    since: options.since ?? null,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    summary,
    ...(impact ? { impact } : {}),
    limitations,
  };
}
