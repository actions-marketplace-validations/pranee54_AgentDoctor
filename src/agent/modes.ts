export type AgentMode = "LEARN" | "BUILD_WITH_ME" | "BUILD_FOR_ME" | "DEVELOPER" | "AI_AGENT";

export interface ModeProfile {
  mode: AgentMode;
  label: string;
  explanationDepth: "beginner" | "standard" | "deep";
  allowWrites: boolean;
  defaultStudentExperience: boolean;
  systemPromptAddon: string;
}

const PROFILES: Record<AgentMode, ModeProfile> = {
  LEARN: {
    mode: "LEARN",
    label: "Learn",
    explanationDepth: "beginner",
    allowWrites: false,
    defaultStudentExperience: false,
    systemPromptAddon: [
      "MODE: LEARN",
      "Explain the project using repository evidence only.",
      "Teach concepts with examples from THIS project.",
      "Do not modify files.",
      "If asked to build, explain the plan and suggest switching to BUILD_WITH_ME.",
    ].join("\n"),
  },
  BUILD_WITH_ME: {
    mode: "BUILD_WITH_ME",
    label: "Build With Me",
    explanationDepth: "beginner",
    allowWrites: true,
    defaultStudentExperience: true,
    systemPromptAddon: [
      "MODE: BUILD_WITH_ME (default student experience)",
      "Explain what will be built, teach concepts, show plan, wait for approval, then build.",
      "After changes, explain WHAT/WHY/CONCEPTS using the actual generated files.",
      "The student remains in control of every code change.",
    ].join("\n"),
  },
  BUILD_FOR_ME: {
    mode: "BUILD_FOR_ME",
    label: "Build For Me",
    explanationDepth: "standard",
    allowWrites: true,
    defaultStudentExperience: false,
    systemPromptAddon: [
      "MODE: BUILD_FOR_ME",
      "Prefer efficient implementation after approval.",
      "Still explain diffs briefly and never skip approval for writes.",
    ].join("\n"),
  },
  DEVELOPER: {
    mode: "DEVELOPER",
    label: "Developer",
    explanationDepth: "deep",
    allowWrites: true,
    defaultStudentExperience: false,
    systemPromptAddon: [
      "MODE: DEVELOPER",
      "Prefer architecture reasoning, callers/callees, and verification detail.",
    ].join("\n"),
  },
  AI_AGENT: {
    mode: "AI_AGENT",
    label: "AI Agent",
    explanationDepth: "deep",
    allowWrites: true,
    defaultStudentExperience: false,
    systemPromptAddon: [
      "MODE: AI_AGENT",
      "Full tool use after approval; still subject to AgentDoctor limits and verification.",
    ].join("\n"),
  },
};

export function getModeProfile(mode: AgentMode): ModeProfile {
  return PROFILES[mode];
}

export function defaultStudentMode(): AgentMode {
  return "BUILD_WITH_ME";
}

export function parseAgentMode(value: string | undefined | null): AgentMode | null {
  if (!value) return null;
  const key = value.trim().toUpperCase().replace(/-/g, "_");
  if (key in PROFILES) return key as AgentMode;
  const aliases: Record<string, AgentMode> = {
    LEARN: "LEARN",
    BUILD: "BUILD_WITH_ME",
    BUILD_WITH_ME: "BUILD_WITH_ME",
    BUILD_FOR_ME: "BUILD_FOR_ME",
    STUDENT: "BUILD_WITH_ME",
    DEVELOPER: "DEVELOPER",
    DEV: "DEVELOPER",
    AGENT: "AI_AGENT",
    AI_AGENT: "AI_AGENT",
  };
  return aliases[key] ?? null;
}

/**
 * Hard gate: LEARN never allows write/execute tools.
 * The model cannot override this — only ModeProfile.allowWrites matters.
 */
export function modeAllowsMutation(mode: AgentMode | undefined | null): boolean {
  if (!mode) return true; // no mode context → rely on approval flags (CLI default)
  return getModeProfile(mode).allowWrites === true;
}

export function modeBlocksToolCategory(
  mode: AgentMode | undefined | null,
  category: "read" | "write" | "execute",
): boolean {
  if (category === "read") return false;
  return !modeAllowsMutation(mode);
}
