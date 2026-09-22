import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildIntelligenceGraph } from "../../../src/intelligence/graph/build.js";
import { startDashboardServer } from "../../../src/dashboard/server.js";
import { redactSecrets, sanitizeFindingsForExport } from "../../../src/platform/security/redact.js";

describe("Task6 symlink escape and secret redaction", () => {
  it("AST graph walker skips symlinks pointing outside the repo", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ad-symlink-"));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "ad-symlink-out-"));
    await fs.writeFile(
      path.join(outsideDir, "secret.ts"),
      'export const LEAK = "password=super-secret-value";\n',
    );
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "package.json"), '{"name":"sym"}\n');
    await fs.writeFile(path.join(root, "src", "ok.ts"), "export const ok = 1;\n");
    await fs.symlink(outsideDir, path.join(root, "src", "escaped"), "dir");
    // File symlink to outside secret
    await fs.symlink(path.join(outsideDir, "secret.ts"), path.join(root, "src", "leak.ts"), "file");
    // Symlink loop
    await fs
      .symlink(path.join(root, "loop-b"), path.join(root, "loop-a"), "dir")
      .catch(() => undefined);
    await fs
      .symlink(path.join(root, "loop-a"), path.join(root, "loop-b"), "dir")
      .catch(() => undefined);

    const graph = await buildIntelligenceGraph({ root, mode: "typescript-ast" });
    const blob = JSON.stringify(graph);
    expect(blob).not.toContain("super-secret-value");
    expect(blob).not.toContain("password=super-secret-value");
    // Should still index the real in-repo file
    expect(graph.astFilesParsed).toBeGreaterThanOrEqual(1);
  });

  it("redacts secrets from findings export and API graph samples", async () => {
    const sample = sanitizeFindingsForExport([
      {
        evidence: [
          {
            detail:
              "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.aaa.bbb password=hunter2 api_key=abcd1234efgh5678ijkl",
          },
        ],
      },
    ]);
    const detail = sample[0]!.evidence[0]!.detail;
    expect(detail).toContain("[REDACTED]");
    expect(detail).not.toContain("hunter2");
    expect(detail.toLowerCase()).not.toContain("eyJhbGciOiJIUzI1NiJ9".toLowerCase());

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ad-secretdash-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "package.json"), '{"name":"sec"}\n');
    await fs.writeFile(
      path.join(root, "src", "config.ts"),
      'export const label = "api_key=abcd1234efgh5678ijkl";\n',
    );
    await fs.writeFile(path.join(root, ".env"), "OPENAI_API_KEY=sk-secret-should-not-appear\n");
    await fs.writeFile(
      path.join(root, "id_rsa"),
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/fake\n-----END RSA PRIVATE KEY-----\n",
    );

    const server = await startDashboardServer({ root, host: "127.0.0.1", port: 0 });
    const body = await new Promise<string>((resolve, reject) => {
      http
        .get({ host: "127.0.0.1", port: server.port, path: "/api/v2/graph" }, (res) => {
          let d = "";
          res.on("data", (c) => (d += c));
          res.on("end", () => resolve(d));
        })
        .on("error", reject);
    });
    await server.close();

    expect(body).not.toContain("sk-secret-should-not-appear");
    expect(body).not.toContain("MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn");
    // Label may be redacted if matched by patterns when present in node labels
    const redactedCheck = redactSecrets("api_key=abcd1234efgh5678ijkl");
    expect(redactedCheck.redacted).toBe(true);
  });
});
