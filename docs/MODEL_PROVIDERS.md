# Model Providers (2.1)

**Status:** IMPLEMENTED · **Release:** NOT PERFORMED

| Provider            | Notes                        |
| ------------------- | ---------------------------- |
| `none`              | Fail closed for chat         |
| `mock`              | Deterministic tests/demo     |
| `openai-compatible` | HTTP OpenAI-compatible API   |
| `ollama`            | Ollama-compatible local HTTP |

Configure via `AGENTDOCTOR_AI_PROVIDER`, `AGENTDOCTOR_AI_API_KEY`, `AGENTDOCTOR_AI_BASE_URL`.

**NOT IMPLEMENTED:** native Anthropic / Gemini clients (do not claim).

API keys must never appear in source, Git, Brain, evidence, logs, audit, or chat memory.
