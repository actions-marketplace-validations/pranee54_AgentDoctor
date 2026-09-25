import { retrieveProjectContext } from "./context/retrieve.js";
import { summarizeProjectForChat } from "./chat/project-summary.js";
import { wrapProjectData } from "./chat/prompts.js";
import { createChatService, type ChatService } from "./chat/service.js";
import type { ModelProvider } from "../ai/index.js";
import { defaultStudentMode, getModeProfile, modeAllowsMutation, type AgentMode } from "./modes.js";
import { buildAgentPlan, formatAgentPlan } from "./plan.js";
import { runCodingLoop, type CodingLoopResult } from "./loop.js";
import type { AgentToolName } from "./tools/types.js";
import { resolveRepoRoot } from "../utils/path.js";

export interface StudentDocSection {
  id: string;
  title: string;
  body: string;
  truth: "VERIFIED" | "INFERRED" | "UNKNOWN";
}

export interface BuildWithMeResult {
  mode: AgentMode;
  explanation: string;
  teachingNotes: string[];
  planText: string;
  coding: CodingLoopResult | null;
  evidenceText: string;
  status: "awaiting-approval" | "mode_forbidden" | "completed" | "failed" | "limit";
}

/**
 * Student-oriented surface on the same AgentRuntime/ChatService (no separate engine).
 */
export class StudentService {
  readonly root: string;
  readonly mode: AgentMode;
  readonly chat: ChatService;
  private readonly provider: ModelProvider;

  constructor(options: { root: string; provider: ModelProvider; mode?: AgentMode }) {
    this.root = resolveRepoRoot(options.root);
    this.mode = options.mode ?? defaultStudentMode();
    this.provider = options.provider;
    const profile = getModeProfile(this.mode);
    this.chat = createChatService({
      root: this.root,
      provider: this.provider,
      systemPromptAddon: profile.systemPromptAddon,
    });
  }

  async explainProject(): Promise<{ text: string; sections: StudentDocSection[] }> {
    const summary = await summarizeProjectForChat(this.root);
    const context = await retrieveProjectContext({
      root: this.root,
      query: "project architecture modules technologies",
      budgetTokens: 4_000,
    });

    const sections: StudentDocSection[] = [
      {
        id: "purpose",
        title: "Project",
        body: `${summary.name} at ${summary.root}`,
        truth: "VERIFIED",
      },
      {
        id: "technologies",
        title: "Technologies",
        body:
          [
            summary.languages.length ? `Languages: ${summary.languages.join(", ")}` : null,
            summary.frameworks.length ? `Frameworks: ${summary.frameworks.join(", ")}` : null,
            summary.packageManagers.length
              ? `Package managers: ${summary.packageManagers.join(", ")}`
              : null,
          ]
            .filter(Boolean)
            .join("\n") || "UNKNOWN — limited detector signals",
        truth: summary.languages.length ? "VERIFIED" : "UNKNOWN",
      },
      {
        id: "testing",
        title: "Testing",
        body: summary.hasTests
          ? "Test-like paths were detected in the repository."
          : "UNKNOWN — no clear test layout detected.",
        truth: summary.hasTests ? "VERIFIED" : "UNKNOWN",
      },
      {
        id: "evidence",
        title: "Evidence files",
        body:
          context.citations
            .filter((c) => c.path)
            .slice(0, 8)
            .map((c) => `- ${c.path}`)
            .join("\n") || "UNKNOWN — no files retrieved",
        truth: context.citations.some((c) => c.path) ? "VERIFIED" : "UNKNOWN",
      },
    ];

    const text = [
      "",
      "LEARN — Project explanation (evidence-backed)",
      "",
      ...sections.flatMap((s) => [`[${s.truth}] ${s.title}`, s.body, ""]),
      wrapProjectData(context.rendered).slice(0, 2_000),
      "",
      "Ask: How does X work? What should I learn next? Switch to Build With Me to implement a feature.",
      "",
    ].join("\n");

    return { text, sections };
  }

  async generateVivaQuestions(): Promise<string[]> {
    const summary = await summarizeProjectForChat(this.root);
    const questions: string[] = [];
    if (summary.frameworks.length) {
      questions.push(`Why did you choose ${summary.frameworks[0]} for this project?`);
    }
    if (summary.languages.length) {
      questions.push(`Explain how ${summary.languages[0]} is used in your modules.`);
    }
    if (summary.hasTests) {
      questions.push("How do you test the critical paths of this project?");
    } else {
      questions.push(
        "What testing strategy would fit this repository? (UNKNOWN today — propose based on stack only if evidenced.)",
      );
    }
    questions.push("Explain the main data flow from user request to response.");
    questions.push(
      "What would break if you removed the authentication/authorization layer (if present)?",
    );
    questions.push("List security controls you implemented and where they live in the repo.");
    // Only keep questions grounded — drop tech invention
    return questions.slice(0, 8);
  }

  async generateProjectDocumentation(): Promise<StudentDocSection[]> {
    const { sections } = await this.explainProject();
    const viva = await this.generateVivaQuestions();
    return [
      ...sections,
      {
        id: "abstract",
        title: "Abstract",
        body: `This document summarizes the ${sections[0]?.body ?? "project"} using AgentDoctor repository evidence. Claims without evidence are marked UNKNOWN.`,
        truth: "INFERRED",
      },
      {
        id: "objectives",
        title: "Objectives",
        body: "UNKNOWN — objectives are not stored as structured metadata; derive from README only when present in evidence.",
        truth: "UNKNOWN",
      },
      {
        id: "limitations",
        title: "Limitations",
        body: "Generated documentation may omit undocumented modules. External services are not verified.",
        truth: "VERIFIED",
      },
      {
        id: "viva",
        title: "Viva questions",
        body: viva.map((q, i) => `${i + 1}. ${q}`).join("\n"),
        truth: "INFERRED",
      },
    ];
  }

  /**
   * BUILD_WITH_ME / BUILD_FOR_ME: explain → plan → teach → approve → runCodingLoop → explain diffs.
   * Reuses the shared coding engine; does not duplicate mutation logic.
   */
  async buildFeature(options: {
    goal: string;
    approvedByHuman: boolean;
    toolCalls?: Array<{ name: AgentToolName; arguments: Record<string, unknown> }>;
    useModelLoop?: boolean;
    verify?: boolean;
    runTests?: boolean;
  }): Promise<BuildWithMeResult> {
    const mode = this.mode;
    if (!modeAllowsMutation(mode)) {
      return {
        mode,
        explanation: `Mode ${mode} forbids writes (allowWrites=false). Switch to BUILD_WITH_ME.`,
        teachingNotes: [],
        planText: "",
        coding: null,
        evidenceText: "",
        status: "mode_forbidden",
      };
    }

    const plan = await buildAgentPlan({ root: this.root, goal: options.goal });
    const planText = formatAgentPlan(plan);
    const teach =
      mode === "BUILD_WITH_ME"
        ? [
            "We will change only the files listed in the plan after your approval.",
            "Each write goes through AgentDoctor tools (path-safe); the model cannot write files directly.",
            "After edits we verify with change/evidence/proof signals — ENGINEERING_CORRECTNESS_NOT_CLAIMED.",
          ]
        : ["Efficient build after approval; brief diffs; same safety gates."];

    const explanation = [
      "",
      `${mode} — what will be built`,
      "",
      `Goal: ${options.goal}`,
      "",
      "Relevant concepts:",
      ...teach.map((t) => `- ${t}`),
      "",
      planText,
      "",
    ].join("\n");

    if (!options.approvedByHuman) {
      return {
        mode,
        explanation,
        teachingNotes: teach,
        planText,
        coding: null,
        evidenceText: "No files modified (approval required).",
        status: "awaiting-approval",
      };
    }

    const coding = await runCodingLoop({
      root: this.root,
      goal: options.goal,
      provider: this.provider,
      approvedByHuman: true,
      mode,
      plan,
      ...(options.toolCalls ? { toolCalls: options.toolCalls } : {}),
      ...(options.useModelLoop !== undefined ? { useModelLoop: options.useModelLoop } : {}),
      verify: options.verify !== false,
      runTests: options.runTests === true,
    });

    const evidenceText = [
      coding.responseText,
      "",
      mode === "BUILD_WITH_ME"
        ? "What changed: see files and diffs above. Why: to satisfy the approved plan. Concepts: controlled tools + verification."
        : "Changes applied under approval; see verification summary.",
      "",
    ].join("\n");

    const status =
      coding.stoppedReason === "completed"
        ? "completed"
        : coding.stoppedReason === "limit"
          ? "limit"
          : coding.stoppedReason === "awaiting-approval"
            ? "awaiting-approval"
            : coding.stoppedReason === "mode_forbidden"
              ? "mode_forbidden"
              : "failed";

    return {
      mode,
      explanation,
      teachingNotes: [...teach, ...(coding.teachingNotes ?? [])],
      planText,
      coding,
      evidenceText,
      status,
    };
  }

  async end(): Promise<void> {
    await this.chat.end();
  }
}
