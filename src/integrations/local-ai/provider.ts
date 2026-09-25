/**
 * Optional local AI integration.
 * Core AgentDoctor never requires a model. Providers are opt-in and must redact
 * sensitive content before any optional call. AI output must not bypass Safe Fix.
 */

export type LocalAiProviderId = "none" | "mock" | "ollama";

export interface LocalAiRequest {
  prompt: string;
  /** Already-redacted context snippets only */
  context: string[];
  maxTokens?: number;
  timeoutMs?: number;
}

export interface LocalAiResponse {
  provider: LocalAiProviderId;
  text: string;
  /** Always true for AI-generated content so callers can label output */
  aiGenerated: true;
  truncated: boolean;
  error?: string;
}

export interface LocalAiProvider {
  id: LocalAiProviderId;
  generate(request: LocalAiRequest): Promise<LocalAiResponse>;
}

const REDACT = /\b(AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|-----BEGIN [^-]+PRIVATE KEY-----)/g;

export function redactForModel(text: string): string {
  return text.replace(REDACT, "[REDACTED]");
}

export class NoneAiProvider implements LocalAiProvider {
  id: LocalAiProviderId = "none";
  async generate(_request: LocalAiRequest): Promise<LocalAiResponse> {
    return {
      provider: "none",
      text: "",
      aiGenerated: true,
      truncated: false,
      error: "Local AI disabled (deterministic mode)",
    };
  }
}

export class MockAiProvider implements LocalAiProvider {
  id: LocalAiProviderId = "mock";
  async generate(request: LocalAiRequest): Promise<LocalAiResponse> {
    const joined = redactForModel([request.prompt, ...request.context].join("\n"));
    const max = request.maxTokens ?? 256;
    const text = `[AI-GENERATED mock] Summary of ${joined.length} redacted chars.`.slice(0, max);
    return {
      provider: "mock",
      text,
      aiGenerated: true,
      truncated: joined.length > max,
    };
  }
}

/**
 * Ollama provider stub: documents integration without requiring ollama installed.
 * Calls fail closed with a clear error when the daemon is unavailable.
 */
export class OllamaAiProvider implements LocalAiProvider {
  id: LocalAiProviderId = "ollama";
  constructor(private readonly endpoint = "http://127.0.0.1:11434") {}

  async generate(request: LocalAiRequest): Promise<LocalAiResponse> {
    const timeoutMs = request.timeoutMs ?? 5_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const prompt = redactForModel(
        `${request.prompt}\n\n${request.context.map(redactForModel).join("\n")}`.slice(0, 8_000),
      );
      const res = await fetch(`${this.endpoint}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama3.2",
          prompt,
          stream: false,
          options: { num_predict: request.maxTokens ?? 256 },
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        return {
          provider: "ollama",
          text: "",
          aiGenerated: true,
          truncated: false,
          error: `ollama HTTP ${res.status}`,
        };
      }
      const data = (await res.json()) as { response?: string };
      return {
        provider: "ollama",
        text: `[AI-GENERATED] ${String(data.response ?? "").trim()}`,
        aiGenerated: true,
        truncated: false,
      };
    } catch (error) {
      return {
        provider: "ollama",
        text: "",
        aiGenerated: true,
        truncated: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createLocalAiProvider(id: LocalAiProviderId): LocalAiProvider {
  switch (id) {
    case "mock":
      return new MockAiProvider();
    case "ollama":
      return new OllamaAiProvider();
    case "none":
    default:
      return new NoneAiProvider();
  }
}
