import { describe, expect, it } from "vitest";

import {
  AI_PROVIDER_REQUIRED_MESSAGE,
  MockModelProvider,
  NoneModelProvider,
  createModelProvider,
  loadAiConfig,
  publicAiConfig,
  redactForModel,
} from "../../../src/ai/index.js";

describe("ai config", () => {
  it("defaults to none and not configured", () => {
    const cfg = loadAiConfig({});
    expect(cfg.provider).toBe("none");
    expect(cfg.configured).toBe(false);
  });

  it("enables mock without api key", () => {
    const cfg = loadAiConfig({ AGENTDOCTOR_AI_PROVIDER: "mock" });
    expect(cfg.provider).toBe("mock");
    expect(cfg.configured).toBe(true);
  });

  it("maps openai alias to openai-compatible", () => {
    const cfg = loadAiConfig({
      AGENTDOCTOR_AI_PROVIDER: "openai",
      AGENTDOCTOR_AI_API_KEY: "sk-test",
      AGENTDOCTOR_AI_MODEL: "gpt-test",
    });
    expect(cfg.provider).toBe("openai-compatible");
    expect(cfg.model).toBe("gpt-test");
    expect(cfg.apiKey).toBe("sk-test");
  });

  it("publicAiConfig never exposes apiKey", () => {
    const cfg = loadAiConfig({
      AGENTDOCTOR_AI_PROVIDER: "openai",
      AGENTDOCTOR_AI_API_KEY: "sk-secret-value",
    });
    const pub = publicAiConfig(cfg);
    expect(pub).not.toHaveProperty("apiKey");
    expect(JSON.stringify(pub)).not.toContain("sk-secret-value");
    expect(pub.apiKeySet).toBe(true);
  });
});

describe("redactForModel", () => {
  it("redacts common secret patterns", () => {
    const raw = "token ghp_123456789012345678901234567890123456 and OPENAI_API_KEY=sk-abc";
    const out = redactForModel(raw);
    expect(out).not.toContain("ghp_");
    expect(out).toContain("[REDACTED]");
  });
});

describe("model providers", () => {
  it("none provider returns the required-message error", async () => {
    const p = new NoneModelProvider();
    const res = await p.chat({ messages: [{ role: "user", content: "hi" }] });
    expect(res.error).toBe(AI_PROVIDER_REQUIRED_MESSAGE);
    expect(res.message.content).toBe("");
  });

  it("mock provider answers without network", async () => {
    const p = new MockModelProvider();
    const res = await p.chat({
      messages: [{ role: "user", content: "Explain auth" }],
    });
    expect(res.error).toBeUndefined();
    expect(res.aiGenerated).toBe(true);
    expect(res.message.content).toContain("[AI-GENERATED mock]");
    expect(res.message.content).toContain("Explain auth");
  });

  it("mock can emit a tool call when asked", async () => {
    const p = new MockModelProvider();
    const res = await p.chat({
      messages: [{ role: "user", content: "please call tool read_file now" }],
      tools: [{ name: "read_file", description: "read", parameters: { type: "object" } }],
    });
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]?.name).toBe("read_file");
  });

  it("createModelProvider wires env", () => {
    const p = createModelProvider(loadAiConfig({ AGENTDOCTOR_AI_PROVIDER: "mock" }));
    expect(p.id).toBe("mock");
  });

  it("anthropic/gemini are not silently swapped — fail closed to none", () => {
    const p = createModelProvider(loadAiConfig({ AGENTDOCTOR_AI_PROVIDER: "anthropic" }));
    expect(p.id).toBe("none");
  });
});
