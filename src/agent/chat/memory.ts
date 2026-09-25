import { randomUUID } from "node:crypto";

import type { ChatMemorySnapshot, ChatMessage } from "./types.js";

export const DEFAULT_MAX_MEMORY_TURNS = 12;
export const DEFAULT_MAX_MEMORY_CHARS = 24_000;

/**
 * Short-term conversation memory for Project Chat.
 * Separate from platform audit sessions.
 */
export class ChatMemory {
  readonly sessionId: string;
  readonly root: string;
  private topic: string | undefined;
  private messages: ChatMessage[] = [];
  private referencedPaths: string[] = [];
  private lastContextPaths: string[] = [];
  private turnCount = 0;
  private readonly maxTurns: number;
  private readonly maxChars: number;

  constructor(options: { root: string; sessionId?: string; maxTurns?: number; maxChars?: number }) {
    this.root = options.root;
    this.sessionId = options.sessionId ?? randomUUID();
    this.maxTurns = options.maxTurns ?? DEFAULT_MAX_MEMORY_TURNS;
    this.maxChars = options.maxChars ?? DEFAULT_MAX_MEMORY_CHARS;
  }

  snapshot(): ChatMemorySnapshot {
    return {
      sessionId: this.sessionId,
      root: this.root,
      ...(this.topic ? { topic: this.topic } : {}),
      messages: [...this.messages],
      referencedPaths: [...this.referencedPaths],
      lastContextPaths: [...this.lastContextPaths],
      turnCount: this.turnCount,
    };
  }

  clear(): void {
    this.messages = [];
    this.referencedPaths = [];
    this.lastContextPaths = [];
    this.topic = undefined;
    this.turnCount = 0;
  }

  getTopic(): string | undefined {
    return this.topic;
  }

  getReferencedPaths(): string[] {
    return [...this.referencedPaths];
  }

  getLastContextPaths(): string[] {
    return [...this.lastContextPaths];
  }

  /**
   * Expand short follow-ups using the current topic.
   */
  resolveQuery(userMessage: string): string {
    const trimmed = userMessage.trim();
    const followUp =
      /^(why\??|what about (it|that|this)\??|and\??|what (files|calls|uses) (it|that|this)\??|what happens if .+|explain (it|that|this)|how\??)$/i.test(
        trimmed,
      ) || trimmed.length < 24;
    if (followUp && this.topic) {
      return `${trimmed}\n\n(Conversation topic: ${this.topic})`;
    }
    return trimmed;
  }

  addUser(content: string): void {
    this.push({ role: "user", content, at: new Date().toISOString() });
    if (!this.topic || content.trim().length > 40) {
      this.topic = content.trim().slice(0, 160);
    }
    this.turnCount += 1;
    this.trim();
  }

  addAssistant(content: string, paths: string[]): void {
    this.push({ role: "assistant", content, at: new Date().toISOString() });
    for (const p of paths) {
      if (!this.referencedPaths.includes(p)) this.referencedPaths.push(p);
    }
    this.lastContextPaths = [...paths];
    this.trim();
  }

  /**
   * Recent history for the model (user/assistant only).
   */
  historyForModel(): Array<{ role: "user" | "assistant"; content: string }> {
    return this.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  }

  private push(message: ChatMessage): void {
    this.messages.push(message);
  }

  private trim(): void {
    while (this.messages.length > this.maxTurns * 2) {
      this.messages.shift();
    }
    let chars = this.messages.reduce((n, m) => n + m.content.length, 0);
    while (chars > this.maxChars && this.messages.length > 2) {
      const removed = this.messages.shift();
      chars -= removed?.content.length ?? 0;
    }
    if (this.referencedPaths.length > 40) {
      this.referencedPaths = this.referencedPaths.slice(-40);
    }
  }
}
