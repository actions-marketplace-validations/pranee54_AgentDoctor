import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  addRepositoryToWorkspace,
  assertWorkspacePathAccess,
  initWorkspace,
  listWorkspaces,
  readFileWithinWorkspace,
  removeWorkspace,
  workspaceStatus,
} from "../../../src/workspace/index.js";

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("workspace isolation", () => {
  it("persists under .agentdoctor/workspaces/<id>.json", async () => {
    const control = await tempDir("ad-ws-ctrl-");
    const repoA = await tempDir("ad-ws-a-");
    try {
      const ws = await initWorkspace({
        controlRoot: control,
        name: "demo",
        id: "ws_demo",
        repositoryRoot: repoA,
      });
      const file = path.join(control, ".agentdoctor", "workspaces", "ws_demo.json");
      const raw = await fs.readFile(file, "utf8");
      expect(JSON.parse(raw).id).toBe(ws.id);
      const listed = await listWorkspaces(control);
      expect(listed.some((w) => w.id === "ws_demo")).toBe(true);
      const status = await workspaceStatus(control, "ws_demo");
      expect(status.ok).toBe(true);
      expect(await removeWorkspace(control, "ws_demo")).toBe(true);
    } finally {
      await fs.rm(control, { recursive: true, force: true });
      await fs.rm(repoA, { recursive: true, force: true });
    }
  });

  it("blocks cross-repo reads unless allowCrossRead", async () => {
    const control = await tempDir("ad-ws-ctrl2-");
    const repoA = await tempDir("ad-ws-a2-");
    const repoB = await tempDir("ad-ws-b2-");
    try {
      await fs.writeFile(path.join(repoA, "a.txt"), "A");
      await fs.writeFile(path.join(repoB, "b.txt"), "SECRET_B");
      const ws = await initWorkspace({
        controlRoot: control,
        name: "pair",
        id: "ws_pair",
        repositoryRoot: repoA,
        allowCrossRead: false,
      });
      await addRepositoryToWorkspace({
        controlRoot: control,
        workspaceId: ws.id,
        repositoryRoot: repoB,
      });

      const denied = assertWorkspacePathAccess({
        workspace: { ...ws, repositoryRoots: [repoA, repoB], allowCrossRead: false },
        operationRoot: repoA,
        targetPath: path.join(repoB, "b.txt"),
      });
      expect(denied.allowed).toBe(false);

      const readDenied = await readFileWithinWorkspace({
        workspace: { ...ws, repositoryRoots: [repoA, repoB], allowCrossRead: false },
        operationRoot: repoA,
        targetPath: path.join(repoB, "b.txt"),
      });
      expect(readDenied.ok).toBe(false);

      const allowed = await readFileWithinWorkspace({
        workspace: { ...ws, repositoryRoots: [repoA, repoB], allowCrossRead: true },
        operationRoot: repoA,
        targetPath: path.join(repoB, "b.txt"),
      });
      expect(allowed.ok).toBe(true);
      if (allowed.ok) expect(allowed.content).toContain("SECRET_B");

      const sameRepo = await readFileWithinWorkspace({
        workspace: { ...ws, repositoryRoots: [repoA, repoB], allowCrossRead: false },
        operationRoot: repoA,
        targetPath: path.join(repoA, "a.txt"),
      });
      expect(sameRepo.ok).toBe(true);
    } finally {
      await fs.rm(control, { recursive: true, force: true });
      await fs.rm(repoA, { recursive: true, force: true });
      await fs.rm(repoB, { recursive: true, force: true });
    }
  });
});
