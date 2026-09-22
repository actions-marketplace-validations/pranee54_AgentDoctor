import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  createKnowledgeRecord,
  listKnowledge,
  retrieveAuthoritative,
  transitionKnowledge,
} from "../../../src/knowledge/store.js";
import { invokeIntelligenceMcpTool } from "../../../src/mcp/intelligence/registry.js";

describe("Task3 knowledge abstention", () => {
  it("draft-only knowledge abstains; approval enables authoritative retrieval", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ad-know-abstain-"));
    await fs.writeFile(path.join(root, "package.json"), '{"name":"know"}\n');

    const draft = await createKnowledgeRecord({
      root,
      title: "Payment encryption standard",
      content: "Use AES-256-GCM for card data at rest",
      status: "draft",
    });
    expect(draft.status).toBe("draft");

    const listed = await listKnowledge(root);
    const before = retrieveAuthoritative(listed, "encryption");
    expect(before.abstain).toBe(true);
    expect(before.record).toBeNull();
    expect(before.reason).toMatch(/No approved authoritative knowledge/i);

    const mcpBefore = await invokeIntelligenceMcpTool(root, "knowledge_retrieve", {
      query: "encryption",
    });
    const mcpBody = mcpBefore.structured as {
      ok?: boolean;
      abstain?: boolean;
      record?: unknown;
      reason?: string;
    };
    expect(mcpBody.ok).toBe(true);
    expect(mcpBody.abstain).toBe(true);
    expect(mcpBody.record ?? null).toBeNull();

    await transitionKnowledge({ root, id: draft.id, to: "approved", by: "reviewer" });
    const afterList = await listKnowledge(root);
    const after = retrieveAuthoritative(afterList, "encryption");
    expect(after.abstain).toBe(false);
    expect(after.record?.id).toBe(draft.id);
    expect(after.record?.status).toBe("approved");
  });

  it("does not return draft records from knowledge_retrieve without query", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ad-know-draftlist-"));
    await createKnowledgeRecord({
      root,
      title: "Draft only policy",
      content: "Should not appear as authoritative list",
      status: "draft",
    });
    const { structured } = await invokeIntelligenceMcpTool(root, "knowledge_retrieve", {});
    const body = structured as { ok?: boolean; records?: Array<{ status: string }> };
    expect(body.ok).toBe(true);
    expect((body.records ?? []).every((r) => r.status === "approved")).toBe(true);
    expect(body.records ?? []).toHaveLength(0);
  });
});
