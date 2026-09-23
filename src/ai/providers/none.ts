import type { ChatRequest, ChatResponse, ModelMetadata, ModelProvider } from "../types.js";
import { AI_PROVIDER_REQUIRED_MESSAGE } from "../types.js";

export class NoneModelProvider implements ModelProvider {
  readonly id = "none" as const;

  metadata(): ModelMetadata {
    return {
      provider: "none",
      model: "none",
      supportsTools: false,
      supportsStreaming: false,
      supportsStructuredOutput: false,
    };
  }

  async chat(_request: ChatRequest): Promise<ChatResponse> {
    return {
      provider: "none",
      model: "none",
      message: { role: "assistant", content: "" },
      toolCalls: [],
      aiGenerated: true,
      error: AI_PROVIDER_REQUIRED_MESSAGE,
    };
  }
}
