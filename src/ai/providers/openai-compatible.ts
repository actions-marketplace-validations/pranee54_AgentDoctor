import { redactMessages } from "../redact.js";
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ModelMetadata,
  ModelProvider,
  ToolCallRequest,
} from "../types.js";

export interface OpenAiCompatibleOptions {
  apiKey?: string;
  baseUrl?: string;
  model: string;
  timeoutMs?: number;
}

/**
 * Minimal OpenAI-compatible Chat Completions client (custom base URL supported).
 * Uses Node fetch. Does not silently fall back to another provider.
 */
export class OpenAiCompatibleProvider implements ModelProvider {
  readonly id = "openai-compatible" as const;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: OpenAiCompatibleOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  metadata(): ModelMetadata {
    return {
      provider: "openai-compatible",
      model: this.model,
      supportsTools: true,
      supportsStreaming: false,
      supportsStructuredOutput: false,
    };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (
      !this.apiKey &&
      !this.baseUrl.includes("localhost") &&
      !this.baseUrl.includes("127.0.0.1")
    ) {
      return {
        provider: "openai-compatible",
        model: this.model,
        message: { role: "assistant", content: "" },
        toolCalls: [],
        aiGenerated: true,
        error: "AI provider unavailable: AGENTDOCTOR_AI_API_KEY is not set.",
      };
    }

    const messages = redactMessages(request.messages).map((m) => ({
      role: m.role === "tool" ? "tool" : m.role,
      content: m.content,
      ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
      ...(m.name ? { name: m.name } : {}),
    }));

    const body: Record<string, unknown> = {
      model: request.model ?? this.model,
      messages,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 2048,
    };
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    request.signal?.addEventListener("abort", onAbort);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }

      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return {
          provider: "openai-compatible",
          model: this.model,
          message: { role: "assistant", content: "" },
          toolCalls: [],
          aiGenerated: true,
          error: `AI provider unavailable: HTTP ${res.status}${errText ? ` (${errText.slice(0, 200)})` : ""}`,
        };
      }

      const data = (await res.json()) as {
        model?: string;
        choices?: Array<{
          finish_reason?: string;
          message?: {
            role?: string;
            content?: string | null;
            tool_calls?: Array<{
              id: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };

      const choice = data.choices?.[0];
      const rawTools = choice?.message?.tool_calls ?? [];
      const toolCalls: ToolCallRequest[] = rawTools.map((tc) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function?.arguments ?? "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }
        return {
          id: tc.id,
          name: tc.function?.name ?? "unknown",
          arguments: args,
        };
      });

      const message: ChatMessage = {
        role: "assistant",
        content: String(choice?.message?.content ?? ""),
      };

      return {
        provider: "openai-compatible",
        model: data.model ?? this.model,
        message,
        toolCalls,
        ...(data.usage
          ? {
              usage: {
                ...(data.usage.prompt_tokens !== undefined
                  ? { promptTokens: data.usage.prompt_tokens }
                  : {}),
                ...(data.usage.completion_tokens !== undefined
                  ? { completionTokens: data.usage.completion_tokens }
                  : {}),
                ...(data.usage.total_tokens !== undefined
                  ? { totalTokens: data.usage.total_tokens }
                  : {}),
              },
            }
          : {}),
        ...(choice?.finish_reason ? { finishReason: choice.finish_reason } : {}),
        aiGenerated: true,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        provider: "openai-compatible",
        model: this.model,
        message: { role: "assistant", content: "" },
        toolCalls: [],
        aiGenerated: true,
        error: `AI provider unavailable: ${msg}`,
      };
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
    }
  }
}
