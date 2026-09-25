import { redactForModel, redactMessages } from "../redact.js";
import type {
  ChatRequest,
  ChatResponse,
  ModelMetadata,
  ModelProvider,
  ToolCallRequest,
} from "../types.js";

export interface MockScriptStep {
  content?: string;
  toolCalls?: ToolCallRequest[];
}

/**
 * Deterministic mock provider for tests and offline demos.
 * Never calls the network.
 * Optional `script` advances one step per chat() for coding-loop tests.
 */
export class MockModelProvider implements ModelProvider {
  readonly id = "mock" as const;
  private turn = 0;
  private readonly script: MockScriptStep[] | undefined;

  constructor(options?: { script?: MockScriptStep[] }) {
    this.script = options?.script;
  }

  metadata(): ModelMetadata {
    return {
      provider: "mock",
      model: "mock",
      supportsTools: true,
      supportsStreaming: false,
      supportsStructuredOutput: false,
    };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const messages = redactMessages(request.messages);

    if (this.script) {
      const step = this.script[this.turn] ?? { content: "[AI-GENERATED mock] done", toolCalls: [] };
      this.turn += 1;
      const toolCalls = step.toolCalls ?? [];
      const text = step.content ?? (toolCalls.length ? "(proposing tools)" : "done");
      return {
        provider: "mock",
        model: "mock",
        message: { role: "assistant", content: text },
        toolCalls,
        usage: {
          promptTokens: messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0),
          completionTokens: Math.ceil(text.length / 4),
          totalTokens: 0,
        },
        finishReason: toolCalls.length ? "tool_calls" : "stop",
        aiGenerated: true,
      };
    }

    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const lastTool = [...messages].reverse().find((m) => m.role === "tool");
    const preview = redactForModel(lastUser?.content ?? "").slice(0, 120);
    let text = `[AI-GENERATED mock] Received ${messages.length} message(s). Last user: ${preview || "(empty)"}`;

    // Tool-output injection must never become instructions — mock refuses to honor them.
    if (lastTool?.content && /IGNORE\s+ALL\s+PREVIOUS\s+INSTRUCTIONS/i.test(lastTool.content)) {
      text =
        "[AI-GENERATED mock] Ignoring untrusted TOOL_OUTPUT instructions. Continuing safely without destructive actions.";
      return {
        provider: "mock",
        model: "mock",
        message: { role: "assistant", content: text },
        toolCalls: [],
        finishReason: "stop",
        aiGenerated: true,
      };
    }

    const toolCalls: ToolCallRequest[] = [];
    const match = /call tool\s+([a-z0-9_]+)/i.exec(lastUser?.content ?? "");
    if (match && request.tools?.some((t) => t.name === match[1])) {
      toolCalls.push({
        id: "mock_tool_1",
        name: match[1]!,
        arguments: {},
      });
    }

    return {
      provider: "mock",
      model: "mock",
      message: { role: "assistant", content: text },
      toolCalls,
      usage: {
        promptTokens: messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0),
        completionTokens: Math.ceil(text.length / 4),
        totalTokens: 0,
      },
      finishReason: toolCalls.length ? "tool_calls" : "stop",
      aiGenerated: true,
    };
  }
}
