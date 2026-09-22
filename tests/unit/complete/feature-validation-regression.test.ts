import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  listProposals,
  reviewProposal,
  runProjectInit,
} from "../../../src/core/brain-product/init.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const cliJs = path.join(repoRoot, "dist/cli/index.js");

describe("feature-validation regression defects", () => {
  it("brain init --json emits JSON when global --json is used by parent program", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ad-json-"));
    const result = spawnSync(process.execPath, [cliJs, "brain", "init", "--json", tmp], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const out = (result.stdout ?? "").trim();
    expect(out.startsWith("{"), `expected JSON, got: ${out.slice(0, 120)}`).toBe(true);
    const parsed = JSON.parse(out) as { storeRoot?: string; root?: string };
    expect(parsed.storeRoot ?? parsed.root).toBeTruthy();
  });

  it("brain review updates proposal markdown status to match decision", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ad-review-"));
    await fs.writeFile(path.join(tmp, "package.json"), '{"name":"t"}\n');
    const init = await runProjectInit(tmp, { projectName: "T", businessDomain: "demo" });
    const target = init.artifacts[0]!;
    expect(target.content).toMatch(/proposed/i);

    await reviewProposal({
      root: tmp,
      artifactId: target.id,
      decision: "approved",
    });

    const after = await listProposals(tmp);
    const updated = after.find((p) => p.id === target.id);
    expect(updated?.status).toBe("approved");
    expect(updated?.content).toMatch(/Status:\s*\*\*approved\*\*/i);
    expect(updated?.content).not.toMatch(/not approved/i);
  });
});
