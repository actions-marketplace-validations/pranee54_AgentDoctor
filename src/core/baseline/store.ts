import fs from "node:fs/promises";
import path from "node:path";

import { atomicWriteTextFile } from "../../utils/fs.js";
import { resolveRepoRoot } from "../../utils/path.js";
import type { Finding, ScanResult } from "../../types/index.js";

export interface NamedBaseline {
  name: string;
  createdAt: string;
  root: string;
  findingIds: string[];
  findingFingerprints: string[];
  counts: {
    total: number;
    critical: number;
    warning: number;
    info: number;
  };
}

function baselineDir(root: string): string {
  return path.join(root, ".agentdoctor", "baselines");
}

function safeBaselineName(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!safe || safe === "." || safe === "..") {
    throw new Error("invalid baseline name");
  }
  return safe;
}

export function fingerprintFinding(finding: Finding): string {
  return [finding.ruleId, finding.severity, finding.evidence?.path ?? "", finding.title].join("|");
}

function isNamedBaseline(value: unknown): value is NamedBaseline {
  if (!value || typeof value !== "object") return false;
  const b = value as Record<string, unknown>;
  return (
    typeof b.name === "string" &&
    typeof b.createdAt === "string" &&
    typeof b.root === "string" &&
    Array.isArray(b.findingIds) &&
    Array.isArray(b.findingFingerprints) &&
    typeof b.counts === "object" &&
    b.counts !== null
  );
}

export function baselineFromScan(name: string, scan: ScanResult): NamedBaseline {
  const fingerprints = scan.findings.map(fingerprintFinding).sort();
  return {
    name,
    createdAt: new Date().toISOString(),
    root: scan.repository.root,
    findingIds: scan.findings.map((f) => f.id).sort(),
    findingFingerprints: fingerprints,
    counts: {
      total: scan.findings.length,
      critical: scan.findings.filter((f) => f.severity === "critical").length,
      warning: scan.findings.filter((f) => f.severity === "warning").length,
      info: scan.findings.filter((f) => f.severity === "info").length,
    },
  };
}

export async function saveNamedBaseline(
  rootInput: string,
  baseline: NamedBaseline,
): Promise<string> {
  const root = resolveRepoRoot(rootInput);
  const safeName = safeBaselineName(baseline.name);
  const dir = baselineDir(root);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${safeName}.json`);
  await atomicWriteTextFile(file, `${JSON.stringify(baseline, null, 2)}\n`);
  return file;
}

export async function loadNamedBaseline(
  rootInput: string,
  name: string,
): Promise<NamedBaseline | null> {
  const root = resolveRepoRoot(rootInput);
  const safeName = safeBaselineName(name);
  try {
    const raw = await fs.readFile(path.join(baselineDir(root), `${safeName}.json`), "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`corrupt baseline JSON: ${safeName}`);
    }
    if (!isNamedBaseline(parsed)) {
      throw new Error(`corrupt baseline schema: ${safeName}`);
    }
    return parsed;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw error;
  }
}

export async function listNamedBaselines(rootInput: string): Promise<string[]> {
  const root = resolveRepoRoot(rootInput);
  try {
    const names = await fs.readdir(baselineDir(root));
    return names
      .filter((n) => n.endsWith(".json"))
      .map((n) => n.replace(/\.json$/, ""))
      .sort();
  } catch {
    return [];
  }
}

export async function deleteNamedBaseline(rootInput: string, name: string): Promise<void> {
  const root = resolveRepoRoot(rootInput);
  const safeName = safeBaselineName(name);
  const file = path.join(baselineDir(root), `${safeName}.json`);
  try {
    await fs.unlink(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(`baseline not found: ${name}`);
    }
    throw error;
  }
}

export interface BaselineDiff {
  name: string;
  /** New findings vs baseline (fingerprints) */
  added: string[];
  /** Resolved findings vs baseline */
  removed: string[];
  /** Recurring / unchanged fingerprints */
  recurring: string[];
  unchanged: number;
}

export function compareToBaseline(baseline: NamedBaseline, findings: Finding[]): BaselineDiff {
  const current = new Set(findings.map(fingerprintFinding));
  const previous = new Set(baseline.findingFingerprints);
  const added: string[] = [];
  const removed: string[] = [];
  const recurring: string[] = [];
  for (const fp of current) {
    if (!previous.has(fp)) added.push(fp);
    else recurring.push(fp);
  }
  for (const fp of previous) {
    if (!current.has(fp)) removed.push(fp);
  }
  return {
    name: baseline.name,
    added: added.sort(),
    removed: removed.sort(),
    recurring: recurring.sort(),
    unchanged: recurring.length,
  };
}

export interface BaselineTrendPoint {
  name: string;
  createdAt: string;
  counts: NamedBaseline["counts"];
}

export interface BaselineTrends {
  root: string;
  points: BaselineTrendPoint[];
  /** Count deltas between chronologically adjacent baselines (no causality claimed). */
  deltas: Array<{
    from: string;
    to: string;
    totalDelta: number;
    criticalDelta: number;
  }>;
}

export async function computeBaselineTrends(rootInput: string): Promise<BaselineTrends> {
  const root = resolveRepoRoot(rootInput);
  const names = await listNamedBaselines(root);
  const points: BaselineTrendPoint[] = [];
  for (const name of names) {
    try {
      const baseline = await loadNamedBaseline(root, name);
      if (!baseline) continue;
      points.push({
        name: baseline.name,
        createdAt: baseline.createdAt,
        counts: baseline.counts,
      });
    } catch {
      // skip corrupt for trends listing; load errors already fail-closed elsewhere
    }
  }
  points.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name));
  const deltas: BaselineTrends["deltas"] = [];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]!;
    const next = points[i]!;
    deltas.push({
      from: prev.name,
      to: next.name,
      totalDelta: next.counts.total - prev.counts.total,
      criticalDelta: next.counts.critical - prev.counts.critical,
    });
  }
  return { root, points, deltas };
}
