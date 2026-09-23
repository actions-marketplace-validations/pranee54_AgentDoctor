import { loadAiConfig, type AiConfig } from "./config.js";
import { NoneModelProvider } from "./providers/none.js";
import { MockModelProvider } from "./providers/mock.js";
import { OpenAiCompatibleProvider } from "./providers/openai-compatible.js";
import type { ModelProvider } from "./types.js";
import { AI_PROVIDER_REQUIRED_MESSAGE } from "./types.js";

export type { AiConfig } from "./config.js";
export { loadAiConfig, publicAiConfig } from "./config.js";
export { redactForModel, redactMessages } from "./redact.js";
export type {
  AiProviderId,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ModelMetadata,
  ModelProvider,
  ToolCallRequest,
  ToolSpec,
  TokenUsage,
} from "./types.js";
export { AI_PROVIDER_REQUIRED_MESSAGE } from "./types.js";
export { NoneModelProvider } from "./providers/none.js";
export { MockModelProvider } from "./providers/mock.js";
export { OpenAiCompatibleProvider } from "./providers/openai-compatible.js";

/**
 * Create a ModelProvider from config / env.
 * Unsupported providers (anthropic/gemini native) return none with a clear error path via none,
 * unless mapped later — for M1 only none/mock/openai-compatible/ollama-via-compatible are live.
 */
export function createModelProvider(config: AiConfig = loadAiConfig()): ModelProvider {
  switch (config.provider) {
    case "mock":
      return new MockModelProvider();
    case "openai-compatible": {
      const opts: { model: string; apiKey?: string; baseUrl?: string } = {
        model: config.model,
      };
      if (config.apiKey) opts.apiKey = config.apiKey;
      if (config.baseUrl) opts.baseUrl = config.baseUrl;
      return new OpenAiCompatibleProvider(opts);
    }
    case "ollama":
      // Ollama OpenAI-compatible endpoint when available; otherwise fail closed via HTTP errors.
      return new OpenAiCompatibleProvider({
        apiKey: config.apiKey ?? "ollama",
        baseUrl: config.baseUrl ?? "http://127.0.0.1:11434/v1",
        model: config.model,
      });
    case "anthropic":
    case "gemini":
      // Native SDKs are NOT IMPLEMENTED in M1 — fail closed via none message.
      return new NoneModelProvider();
    case "none":
    default:
      return new NoneModelProvider();
  }
}

export function requireAiProviderMessage(provider: ModelProvider): string | null {
  if (provider.id === "none") {
    return AI_PROVIDER_REQUIRED_MESSAGE;
  }
  return null;
}
