import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { scanSecrets } from "../../../src/core/secrets/scan.js";

describe("secret findings severity vs confidence", () => {
  it("emits separate severity and confidence fields", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ad-sec-"));
    try {
      await fs.writeFile(
        path.join(root, "leak.env"),
        "AWS_KEY=AKIAIOSFODNN7EXAMPLE\napi_key=abcdefghijklmnopqrstuvwxyz012345\n",
      );
      const report = await scanSecrets({ root, enabled: true });
      expect(report.findings.length).toBeGreaterThan(0);
      for (const f of report.findings) {
        expect(f.severity).toMatch(/critical|warning/);
        expect(f.confidence).toMatch(/low|medium|high/);
        expect(f).toHaveProperty("severity");
        expect(f).toHaveProperty("confidence");
        expect(f.redactedSnippet).not.toMatch(/AKIAIOSFODNN7EXAMPLE/);
      }
      const aws = report.findings.find((f) => f.ruleId === "aws-access-key");
      expect(aws?.severity).toBe("critical");
      expect(aws?.confidence).toBe("high");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
