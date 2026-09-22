import fs from "node:fs/promises";
import path from "node:path";

import { atomicWriteTextFile } from "../utils/fs.js";
import { isPathInsideRoot, resolveRepoRoot } from "../utils/path.js";

export function platformDir(root: string): string {
  return path.join(resolveRepoRoot(root), ".agentdoctor", "platform");
}

export async function ensurePlatformDir(root: string): Promise<string> {
  const dir = platformDir(root);
  await fs.mkdir(path.join(dir, "sessions"), { recursive: true });
  await fs.mkdir(path.join(dir, "provenance"), { recursive: true });
  await fs.mkdir(path.join(dir, "reports"), { recursive: true });
  await fs.mkdir(path.join(dir, "snapshots"), { recursive: true });
  return dir;
}

function resolveSafePlatformPath(root: string, relativeUnderPlatform: string): string {
  const dir = platformDir(root);
  if (
    relativeUnderPlatform.includes("\0") ||
    path.isAbsolute(relativeUnderPlatform) ||
    relativeUnderPlatform.split(/[/\\]/).includes("..")
  ) {
    throw new Error(`refusing unsafe platform path: ${relativeUnderPlatform}`);
  }
  const target = path.resolve(dir, relativeUnderPlatform);
  if (!isPathInsideRoot(dir, target)) {
    throw new Error(`platform path escapes store: ${relativeUnderPlatform}`);
  }
  return target;
}

export async function writeJsonArtifact(
  root: string,
  relativeUnderPlatform: string,
  value: unknown,
): Promise<string> {
  await ensurePlatformDir(root);
  const target = resolveSafePlatformPath(root, relativeUnderPlatform);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await atomicWriteTextFile(target, `${JSON.stringify(value, null, 2)}\n`);
  return target;
}

export async function writeTextArtifact(
  root: string,
  relativeUnderPlatform: string,
  body: string,
): Promise<string> {
  await ensurePlatformDir(root);
  const target = resolveSafePlatformPath(root, relativeUnderPlatform);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await atomicWriteTextFile(target, body);
  return target;
}

export async function appendJsonl(
  root: string,
  relativeUnderPlatform: string,
  record: unknown,
): Promise<void> {
  await ensurePlatformDir(root);
  const target = resolveSafePlatformPath(root, relativeUnderPlatform);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.appendFile(target, `${JSON.stringify(record)}\n`, "utf8");
}

export async function readJsonIfExists<T>(absolute: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(absolute, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
