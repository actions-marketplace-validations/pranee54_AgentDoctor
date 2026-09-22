import { spawnSync } from "node:child_process";

import { resolveRepoRoot } from "../../utils/path.js";

export interface TimeMachineCompare {
  root: string;
  left: string;
  right: string;
  changedFiles: string[];
  summary: string;
  limitations: string[];
}

function git(root: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  return { ok: r.status === 0, out: typeof r.stdout === "string" ? r.stdout : "" };
}

/**
 * Module J — Repository time machine (git-backed).
 */
export async function compareCommits(options: {
  root: string;
  left: string;
  right: string;
}): Promise<TimeMachineCompare> {
  const root = resolveRepoRoot(options.root);
  const left = options.left.trim();
  const right = options.right.trim();
  if (!isSafeGitRef(left) || !isSafeGitRef(right)) {
    return {
      root,
      left,
      right,
      changedFiles: [],
      summary: "Invalid git ref",
      limitations: ["Refs must be non-empty and must not start with '-'"],
    };
  }
  const probe = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!probe.ok || probe.out.trim() !== "true") {
    return {
      root,
      left,
      right,
      changedFiles: [],
      summary: "Git not available",
      limitations: ["Requires a git repository"],
    };
  }
  const diff = git(root, ["diff", "--name-only", `${left}...${right}`]);
  const files = diff.ok
    ? diff.out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
    : [];
  return {
    root,
    left,
    right,
    changedFiles: files,
    summary: `${files.length} path(s) differ between ${left} and ${right}`,
    limitations: [
      "Architecture/risk trend overlays are extension points; this MVP lists path diffs",
    ],
  };
}

function isSafeGitRef(ref: string): boolean {
  return Boolean(ref) && !ref.includes("\0") && !ref.startsWith("-") && !/[\r\n]/.test(ref);
}

export async function listRecentCommits(rootInput: string, limit = 20): Promise<string[]> {
  const root = resolveRepoRoot(rootInput);
  const log = git(root, ["log", `-${limit}`, "--pretty=format:%H %s"]);
  if (!log.ok) return [];
  return log.out.split(/\r?\n/).filter(Boolean);
}
