import { describe, expect, it } from "vitest";

import { redactBrainForStorage } from "../../../src/core/understanding/brain/index.js";
import type { ProjectBrain } from "../../../src/core/understanding/brain/types.js";

function minimalBrain(object: string): ProjectBrain {
  return {
    schemaVersion: 1,
    snapshot: {
      id: "snap-test",
      generatedAt: "2026-01-01T00:00:00.000Z",
      root: "/tmp/repo",
      modelVersion: "test",
    },
    claims: [
      {
        id: "c1",
        kind: "fact",
        subject: "src/app.ts",
        predicate: "contains",
        object,
        status: "active",
        confidence: 0.9,
        evidenceIds: [],
      },
    ],
    evidence: [],
    ownership: { timingMs: 12, ownerships: [] },
    risks: { timingMs: 3, risks: [] },
  } as unknown as ProjectBrain;
}

describe("redactBrainForStorage", () => {
  it("scrubs password-like claim objects and zeros timing", () => {
    const redacted = redactBrainForStorage(minimalBrain("password=super-secret-value"));
    expect(redacted.claims[0]?.object).toBe("[REDACTED]");
    expect(redacted.ownership.timingMs).toBe(0);
    expect(redacted.risks.timingMs).toBe(0);
  });

  it("scrubs api_key and token-like claim text", () => {
    const key = redactBrainForStorage(minimalBrain("api_key=sk-live-ABCDEF123456"));
    expect(key.claims[0]?.object).toBe("[REDACTED]");
    const token = redactBrainForStorage(minimalBrain("auth token=xyz-secret"));
    expect(token.claims[0]?.object).toBe("[REDACTED]");
  });

  it("scrubs private-key-like PEM markers in claim text", () => {
    const redacted = redactBrainForStorage(minimalBrain("-----BEGIN RSA PRIVATE KEY-----MIIE"));
    expect(redacted.claims[0]?.object).toBe("[REDACTED]");
  });

  it("scrubs credential-like and connection-string-ish claim text", () => {
    const cred = redactBrainForStorage(minimalBrain("db credential user=admin"));
    expect(cred.claims[0]?.object).toBe("[REDACTED]");
    const secret = redactBrainForStorage(minimalBrain("connection secret=postgres://x"));
    expect(secret.claims[0]?.object).toBe("[REDACTED]");
  });

  it("redacts sensitive claim subject basenames", () => {
    const brain = minimalBrain("plain text");
    brain.claims = [
      {
        ...brain.claims[0]!,
        subject: "config/.env.local",
        object: "present",
      },
    ];
    const redacted = redactBrainForStorage(brain);
    expect(redacted.claims[0]?.subject).toBe("[REDACTED_PATH]");
  });

  it("does not redact ordinary source identifiers", () => {
    const redacted = redactBrainForStorage(minimalBrain("exports renderReport"));
    expect(redacted.claims[0]?.object).toBe("exports renderReport");
  });

  it("is idempotent across repeated rebuild redaction", () => {
    const once = redactBrainForStorage(minimalBrain("password=once"));
    const twice = redactBrainForStorage(once);
    expect(twice.claims[0]?.object).toBe("[REDACTED]");
    expect(twice.ownership.timingMs).toBe(0);
  });
});
