import { aiderAdapter } from "./aider/adapter.js";
import { claudeAdapter } from "./claude/adapter.js";
import { codexAdapter } from "./codex/adapter.js";
import { copilotAdapter } from "./copilot/adapter.js";
import { geminiCliAdapter } from "./gemini/adapter.js";
import { cursorAdapter } from "./cursor/adapter.js";
import { windsurfAdapter } from "./windsurf/adapter.js";
import type { AgentAdapter } from "./types.js";

/**
 * Central registry of AI coding agent adapters.
 * Add new agents by implementing AgentAdapter and appending here.
 */
export const agentRegistry: readonly AgentAdapter[] = [
  cursorAdapter,
  claudeAdapter,
  codexAdapter,
  copilotAdapter,
  windsurfAdapter,
  geminiCliAdapter,
  aiderAdapter,
];

export function getAgentAdapter(id: string): AgentAdapter | undefined {
  return agentRegistry.find((adapter) => adapter.id === id);
}
