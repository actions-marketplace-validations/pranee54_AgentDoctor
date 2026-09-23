import type { Tool } from "@modelcontextprotocol/sdk/types.js";

import { createModelProvider, loadAiConfig } from "../../ai/index.js";
import type { ModelProvider } from "../../ai/types.js";
import { ChatService } from "../../agent/chat/service.js";
import { buildAgentPlan } from "../../agent/plan.js";
import { executeAgentTool, newToolCall } from "../../agent/tools/index.js";
import { retrieveProjectContext } from "../../agent/context/retrieve.js";
import { summarizeProjectForChat } from "../../agent/chat/project-summary.js";

export const AGENT_MCP_TOOL_NAMES = [
  "project_context",
  "project_ask",
  "code_search",
  "file_read",
  "file_create",
  "file_edit",
  "agent_plan",
  "change_verify",
] as const;

export type AgentMcpToolName = (typeof AGENT_MCP_TOOL_NAMES)[number];

export function listAgentMcpTools(): Tool[] {
  return [
    {
      name: "project_context",
      description: "READ: Budgeted project context pack for a query (path-safe).",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "project_ask",
      description: "READ: One-shot Project Chat ask (requires AI provider; no file writes).",
      inputSchema: {
        type: "object",
        properties: { question: { type: "string" } },
        required: ["question"],
        additionalProperties: false,
      },
    },
    {
      name: "code_search",
      description: "READ: Search code via AgentDoctor graph search.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "file_read",
      description: "READ: Path-safe file read inside workspace.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
    },
    {
      name: "file_create",
      description:
        "WRITE: Create file (requires approved=true). Path-safe; never shell. Model cannot self-approve.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
          approved: { type: "boolean" },
        },
        required: ["path", "content", "approved"],
        additionalProperties: false,
      },
    },
    {
      name: "file_edit",
      description: "WRITE: Edit file (requires approved=true). Path-safe.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
          oldContent: { type: "string" },
          approved: { type: "boolean" },
        },
        required: ["path", "approved"],
        additionalProperties: false,
      },
    },
    {
      name: "agent_plan",
      description: "READ: Build a change plan without modifying files.",
      inputSchema: {
        type: "object",
        properties: { goal: { type: "string" } },
        required: ["goal"],
        additionalProperties: false,
      },
    },
    {
      name: "change_verify",
      description:
        "READ: Produce evidence/proof for current changes (may write evidence artifacts).",
      inputSchema: {
        type: "object",
        properties: { changeId: { type: "string" } },
        additionalProperties: false,
      },
    },
  ];
}

export async function invokeAgentMcpTool(
  root: string,
  name: string,
  args: Record<string, unknown>,
  options?: { provider?: ModelProvider },
): Promise<{ structured: unknown; isError: boolean }> {
  try {
    switch (name) {
      case "project_context": {
        const query = typeof args.query === "string" ? args.query : "";
        const bundle = await retrieveProjectContext({ root, query });
        return { structured: { ok: true, bundle }, isError: false };
      }
      case "project_ask": {
        const question = typeof args.question === "string" ? args.question : "";
        if (!question) {
          return {
            structured: {
              ok: false,
              error: { code: "invalid_argument", message: "question required" },
            },
            isError: true,
          };
        }
        const provider = options?.provider ?? createModelProvider(loadAiConfig());
        if (provider.id === "none") {
          return {
            structured: {
              ok: false,
              error: {
                code: "provider_none",
                message:
                  "AI chat is not configured. Set AGENTDOCTOR_AI_PROVIDER=mock (or openai-compatible). Silent mock fallback is disabled.",
              },
            },
            isError: true,
          };
        }
        const chat = new ChatService({
          root,
          provider,
          persistAudit: false,
        });
        try {
          const response = await chat.ask(question);
          return {
            structured: { ok: response.status === "ok", response },
            isError: response.status !== "ok",
          };
        } finally {
          await chat.end();
        }
      }
      case "code_search": {
        const result = await executeAgentTool(
          root,
          newToolCall("mcp", "search_code", { query: args.query }),
        );
        return { structured: result, isError: !result.ok };
      }
      case "file_read": {
        const result = await executeAgentTool(
          root,
          newToolCall("mcp", "read_file", { path: args.path }),
        );
        return { structured: result, isError: !result.ok };
      }
      case "file_create": {
        if (args.approved !== true) {
          return {
            structured: {
              ok: false,
              error: { code: "approval_required", message: "approved=true required" },
            },
            isError: true,
          };
        }
        const result = await executeAgentTool(
          root,
          newToolCall("mcp", "create_file", { path: args.path, content: args.content }),
          { allowWrite: true, approvedByHuman: true },
        );
        return { structured: result, isError: !result.ok };
      }
      case "file_edit": {
        if (args.approved !== true) {
          return {
            structured: {
              ok: false,
              error: { code: "approval_required", message: "approved=true required" },
            },
            isError: true,
          };
        }
        const result = await executeAgentTool(
          root,
          newToolCall("mcp", "edit_file", {
            path: args.path,
            content: args.content,
            oldContent: args.oldContent,
          }),
          { allowWrite: true, approvedByHuman: true },
        );
        return { structured: result, isError: !result.ok };
      }
      case "agent_plan": {
        const goal = typeof args.goal === "string" ? args.goal : "";
        const plan = await buildAgentPlan({ root, goal });
        return { structured: { ok: true, plan }, isError: false };
      }
      case "change_verify": {
        const { verifyChange } = await import("../../assurance/change.js");
        const result = await verifyChange({
          root,
          ...(typeof args.changeId === "string" ? { changeId: args.changeId } : {}),
        });
        return { structured: { ok: true, ...result }, isError: false };
      }
      default:
        return {
          structured: {
            ok: false,
            error: { code: "invalid_argument", message: `unknown agent tool: ${name}` },
          },
          isError: true,
        };
    }
  } catch (error) {
    return {
      structured: {
        ok: false,
        error: {
          code: "internal",
          message: error instanceof Error ? error.message : String(error),
        },
      },
      isError: true,
    };
  }
}

/** Convenience for tests */
export async function projectFingerprint(root: string): Promise<unknown> {
  return summarizeProjectForChat(root);
}
