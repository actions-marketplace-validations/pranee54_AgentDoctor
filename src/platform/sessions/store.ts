import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { appendJsonl, ensurePlatformDir, platformDir, writeJsonArtifact } from "../store.js";
import { resolveRepoRoot } from "../../utils/path.js";

export interface SessionEvent {
  id: string;
  sessionId: string;
  timestamp: string;
  type:
    | "session-start"
    | "prompt"
    | "tool-call"
    | "tool-result"
    | "file-read"
    | "file-change"
    | "command"
    | "policy"
    | "approval"
    | "error"
    | "session-end";
  summary: string;
  detail?: Record<string, string>;
  risk?: "none" | "low" | "medium" | "high" | "critical";
}

export interface AgentSession {
  id: string;
  root: string;
  agentId: string;
  userId?: string;
  model?: string;
  startedAt: string;
  endedAt?: string;
  events: SessionEvent[];
}

export async function createSession(options: {
  root: string;
  agentId: string;
  userId?: string;
  model?: string;
}): Promise<AgentSession> {
  const root = resolveRepoRoot(options.root);
  await ensurePlatformDir(root);
  const session: AgentSession = {
    id: randomUUID(),
    root,
    agentId: options.agentId,
    startedAt: new Date().toISOString(),
    events: [],
    ...(options.userId ? { userId: options.userId } : {}),
    ...(options.model ? { model: options.model } : {}),
  };
  session.events.push({
    id: randomUUID(),
    sessionId: session.id,
    timestamp: session.startedAt,
    type: "session-start",
    summary: `Session started for agent ${options.agentId}`,
    risk: "none",
  });
  await persistSession(session);
  return session;
}

export async function appendSessionEvent(
  session: AgentSession,
  event: Omit<SessionEvent, "id" | "sessionId" | "timestamp"> & { timestamp?: string },
): Promise<AgentSession> {
  const full: SessionEvent = {
    id: randomUUID(),
    sessionId: session.id,
    timestamp: event.timestamp ?? new Date().toISOString(),
    type: event.type,
    summary: event.summary,
    ...(event.detail ? { detail: event.detail } : {}),
    ...(event.risk ? { risk: event.risk } : {}),
  };
  session.events.push(full);
  await appendJsonl(session.root, path.join("sessions", `${session.id}.jsonl`), full);
  await persistSession(session);
  return session;
}

export async function endSession(session: AgentSession): Promise<AgentSession> {
  session.endedAt = new Date().toISOString();
  await appendSessionEvent(session, {
    type: "session-end",
    summary: "Session ended",
    risk: "none",
  });
  return session;
}

async function persistSession(session: AgentSession): Promise<void> {
  await writeJsonArtifact(session.root, path.join("sessions", `${session.id}.json`), session);
}

export async function loadSession(root: string, sessionId: string): Promise<AgentSession | null> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)
  ) {
    throw new Error("invalid session id");
  }
  const file = path.join(platformDir(root), "sessions", `${sessionId}.json`);
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as AgentSession;
  } catch {
    return null;
  }
}

export async function listSessions(root: string): Promise<string[]> {
  const dir = path.join(platformDir(root), "sessions");
  try {
    return (await fs.readdir(dir))
      .filter((n) => n.endsWith(".json"))
      .map((n) => n.replace(/\.json$/, ""))
      .sort();
  } catch {
    return [];
  }
}

export function exportSessionMarkdown(session: AgentSession): string {
  const lines = [
    `# Agent session ${session.id}`,
    "",
    `- Agent: ${session.agentId}`,
    `- User: ${session.userId ?? "unknown"}`,
    `- Model: ${session.model ?? "unknown"}`,
    `- Started: ${session.startedAt}`,
    `- Ended: ${session.endedAt ?? "(open)"}`,
    "",
    "## Timeline",
    "",
  ];
  for (const e of session.events) {
    lines.push(`- ${e.timestamp} **${e.type}** ${e.summary}${e.risk ? ` _(risk=${e.risk})_` : ""}`);
  }
  return `${lines.join("\n")}\n`;
}
