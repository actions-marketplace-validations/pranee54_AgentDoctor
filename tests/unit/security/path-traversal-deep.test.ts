import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { invokeIntelligenceMcpTool } from "../../../src/mcp/intelligence/registry.js";
import { assertSafeRepoTarget } from "../../../src/mcp/intelligence/path-safety.js";
import { startDashboardServer } from "../../../src/dashboard/server.js";

async function makeRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ad-pathtrav-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), '{"name":"pathtrav"}\n');
  await fs.writeFile(
    path.join(root, "src", "app.ts"),
    "export function hello(): string { return 'ok'; }\n",
  );
  // Secret outside repo — must never be readable via tools
  const outside = path.join(os.tmpdir(), `ad-outside-secret-${Date.now()}.txt`);
  await fs.writeFile(outside, "TOP_SECRET_OUTSIDE=should-not-leak\n");
  await fs.writeFile(path.join(root, ".outside-path"), outside);
  return root;
}

describe("Task1 path-traversal security", () => {
  it("rejects traversal / absolute / encoded / null-byte targets in dependency_lookup", async () => {
    const root = await makeRepo();
    const outside = (await fs.readFile(path.join(root, ".outside-path"), "utf8")).trim();

    const payloads = [
      "../",
      "../../etc/passwd",
      path.join("..", "..", "etc", "passwd"),
      outside,
      "/etc/passwd",
      "C:\\Windows\\System32\\config\\sam",
      "..\\..\\windows\\system32",
      "%2e%2e%2fetc%2fpasswd",
      "..%2f..%2fetc%2fpasswd",
      "src/app.ts\0../../etc/passwd",
      "....//....//etc/passwd",
    ];

    for (const target of payloads) {
      const { structured, isError } = await invokeIntelligenceMcpTool(root, "dependency_lookup", {
        target,
      });
      const body = structured as {
        ok?: boolean;
        error?: { code?: string; message?: string };
        edges?: unknown;
      };
      const blob = JSON.stringify(structured);
      expect(blob, `payload=${JSON.stringify(target)}`).not.toContain("TOP_SECRET_OUTSIDE");
      // Echoing a rejected hostile string is ok; must not return outside file contents
      expect(blob, `payload=${JSON.stringify(target)}`).not.toContain("TOP_SECRET_OUTSIDE");
      if (body.ok === false) {
        expect(body.error?.code === "path_escape" || body.error?.code === "invalid_argument").toBe(
          true,
        );
        expect(body.error?.message ?? "").not.toContain(outside);
        expect(body.error?.message ?? "").not.toMatch(/\/Users\/|\/home\/|\/etc\//);
      } else {
        const edges = (body.edges ?? []) as unknown[];
        expect(Array.isArray(edges)).toBe(true);
        expect(edges.length).toBe(0);
        // Successful empty lookups must not be for escape payloads containing ..
        if (String(target).includes("..") || String(target).includes("\0")) {
          expect.fail(`escape payload should be rejected: ${JSON.stringify(target)}`);
        }
      }
      void isError;
    }

    // Valid in-repo relative path still works (or empty if not indexed as path key)
    const valid = await invokeIntelligenceMcpTool(root, "dependency_lookup", {
      target: "src/app.ts",
    });
    expect((valid.structured as { ok: boolean }).ok).toBe(true);
  });

  it("assertSafeRepoTarget throws safe errors without leaking outside paths", () => {
    const root = "/tmp/repo-root-example";
    expect(() => assertSafeRepoTarget(root, "../../etc/passwd")).toThrow(
      /path escapes repository root|invalid target/,
    );
    try {
      assertSafeRepoTarget(root, "/etc/passwd");
      expect.unreachable("should throw");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      expect(msg).toBe("path escapes repository root");
      expect(msg).not.toContain("/etc/passwd");
    }
  });

  it("dashboard rejects hostile pathnames and keeps valid /api/v2/graph working", async () => {
    const root = await makeRepo();
    const server = await startDashboardServer({ root, host: "127.0.0.1", port: 0 });
    const port = server.port;

    const get = async (pathname: string): Promise<{ status: number; body: string }> =>
      new Promise((resolve, reject) => {
        http
          .get({ host: "127.0.0.1", port, path: pathname }, (res) => {
            let d = "";
            res.on("data", (c) => (d += c));
            res.on("end", () => resolve({ status: res.statusCode ?? 0, body: d }));
          })
          .on("error", reject);
      });

    const hostile = await get("/api/v2/graph/../../etc/passwd");
    expect(hostile.status).toBe(400);
    expect(hostile.body).not.toContain("TOP_SECRET");

    const encoded = await get("/api/v2/%2e%2e/%2e%2e/etc/passwd");
    expect(encoded.status).toBe(400);

    const ok = await get("/api/v2/graph");
    expect(ok.status).toBe(200);
    const parsed = JSON.parse(ok.body) as { builder?: string; nodeCount?: number };
    expect(parsed.builder).toBeTruthy();
    expect(typeof parsed.nodeCount).toBe("number");

    await server.close();
  });
});
