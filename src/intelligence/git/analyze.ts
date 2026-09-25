import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

import { resolveRepoRoot } from "../../utils/path.js";

export interface HotspotFile {
  path: string;
  commits: number;
  authors: string[];
  busFactor: number;
  method: string;
}

export interface GitIntelligenceReport {
  root: string;
  gitAvailable: boolean;
  hotspots: HotspotFile[];
  coChanges: Array<{ a: string; b: string; together: number; method: string }>;
  limitations: string[];
}

function git(root: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return { ok: r.status === 0, out: typeof r.stdout === "string" ? r.stdout : "" };
}

/**
 * Git engineering intelligence — methods disclosed on every metric.
 */
export async function analyzeGitIntelligence(rootInput: string): Promise<GitIntelligenceReport> {
  const root = resolveRepoRoot(rootInput);
  const probe = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!probe.ok || probe.out.trim() !== "true") {
    return {
      root,
      gitAvailable: false,
      hotspots: [],
      coChanges: [],
      limitations: ["Requires a git repository"],
    };
  }

  const log = git(root, ["log", "--name-only", "--pretty=format:===%an", "-n", "200"]);
  const authorsByFile = new Map<string, Set<string>>();
  const commitsByFile = new Map<string, number>();
  const commitFiles: string[][] = [];
  let currentAuthor = "unknown";
  let bucket: string[] = [];

  for (const line of log.out.split(/\r?\n/)) {
    if (line.startsWith("===")) {
      if (bucket.length) commitFiles.push(bucket);
      bucket = [];
      currentAuthor = line.slice(3).trim() || "unknown";
      continue;
    }
    const file = line.trim();
    if (!file || file.includes("\0")) continue;
    bucket.push(file);
    commitsByFile.set(file, (commitsByFile.get(file) ?? 0) + 1);
    if (!authorsByFile.has(file)) authorsByFile.set(file, new Set());
    authorsByFile.get(file)!.add(currentAuthor);
  }
  if (bucket.length) commitFiles.push(bucket);

  const hotspots: HotspotFile[] = [...commitsByFile.entries()]
    .map(([path, commits]) => {
      const authors = [...(authorsByFile.get(path) ?? [])].sort();
      return {
        path,
        commits,
        authors,
        busFactor: authors.length,
        method:
          "count of file appearances in last ≤200 commits; busFactor=distinct authors in that window",
      };
    })
    .sort((a, b) => b.commits - a.commits || a.path.localeCompare(b.path))
    .slice(0, 50);

  const pairCounts = new Map<string, number>();
  for (const files of commitFiles) {
    const uniq = [...new Set(files)].sort();
    for (let i = 0; i < uniq.length; i += 1) {
      for (let j = i + 1; j < Math.min(uniq.length, i + 8); j += 1) {
        const key = `${uniq[i]}||${uniq[j]}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const coChanges = [...pairCounts.entries()]
    .filter(([, n]) => n >= 2)
    .map(([key, together]) => {
      const [a, b] = key.split("||");
      return {
        a: a!,
        b: b!,
        together,
        method: "pair co-occurrence in same commit (window ≤200; capped pairs per commit)",
      };
    })
    .sort((x, y) => y.together - x.together)
    .slice(0, 40);

  return {
    root,
    gitAvailable: true,
    hotspots,
    coChanges,
    limitations: [
      "Hotspots use recent commit window only (not full history)",
      "Bus factor is author cardinality in window — not organizational coverage",
      "Bug-fix history is not classified in this MVP",
    ],
  };
}

export function deadCodeCategory(options: {
  exported: boolean;
  referenced: boolean;
  frameworkEntry: boolean;
  dynamicHint: boolean;
}): {
  category:
    | "confirmed-unreachable"
    | "probably-unused"
    | "possibly-unused"
    | "public-api"
    | "framework-discovered"
    | "reflection-sensitive"
    | "dynamic-reference-risk"
    | "unknown";
  confidence: number;
  explanation: string;
} {
  if (options.frameworkEntry) {
    return {
      category: "framework-discovered",
      confidence: 0.4,
      explanation:
        "Looks like a framework entry — do not mark dead without framework adapter proof",
    };
  }
  if (options.dynamicHint) {
    return {
      category: "dynamic-reference-risk",
      confidence: 0.3,
      explanation: "Dynamic/reflection-style reference risk",
    };
  }
  if (options.exported && !options.referenced) {
    return {
      category: "public-api",
      confidence: 0.55,
      explanation: "Exported but no static references observed — may be public API",
    };
  }
  if (!options.exported && !options.referenced) {
    return {
      category: "possibly-unused",
      confidence: 0.5,
      explanation: "No static references; not confirmed unreachable across all loaders",
    };
  }
  if (!options.exported && options.referenced) {
    return { category: "unknown", confidence: 0.2, explanation: "Referenced locally" };
  }
  return { category: "unknown", confidence: 0.2, explanation: "Insufficient evidence" };
}

export function stableMetricId(kind: string, path: string): string {
  return `git_${createHash("sha1").update(`${kind}:${path}`).digest("hex").slice(0, 12)}`;
}
