import type { Tool } from "@modelcontextprotocol/sdk/types.js";

import {
  handleArchitectureTool,
  handleCallGraphLookup,
  handleCodeHealthTool,
  handleCodebaseSearch,
  handleDependencyLookup,
  handleKnowledgeTool,
  handlePolicyEvalTool,
  handleRefactorImpactTool,
  handleRepoOverview,
  handleSymbolLookup,
  handleTestImpactTool,
} from "./handlers.js";

export const INTELLIGENCE_MCP_TOOL_NAMES = [
  "repo_overview",
  "codebase_search",
  "symbol_lookup",
  "dependency_lookup",
  "call_graph_lookup",
  "test_impact",
  "refactor_impact",
  "code_health",
  "architecture_info",
  "knowledge_retrieve",
  "policy_evaluate",
] as const;

export type IntelligenceMcpToolName = (typeof INTELLIGENCE_MCP_TOOL_NAMES)[number];

const emptyObjectSchema = {
  type: "object" as const,
  properties: {},
  additionalProperties: false as const,
};

export function listIntelligenceMcpTools(): Tool[] {
  return [
    {
      name: "repo_overview",
      description:
        "READ: Repository intelligence overview (graph builder, node/edge counts, limitations). No shell execution.",
      inputSchema: emptyObjectSchema,
    },
    {
      name: "codebase_search",
      description: "READ: Search graph nodes by label/path substring. Bounded to 50 hits.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "symbol_lookup",
      description: "READ: Lookup symbols/functions/classes/interfaces by name.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      name: "dependency_lookup",
      description: "READ: Edges connected to a graph node (id/path/label).",
      inputSchema: {
        type: "object",
        properties: { target: { type: "string" } },
        required: ["target"],
        additionalProperties: false,
      },
    },
    {
      name: "call_graph_lookup",
      description: "READ: Call edges involving a symbol (best-effort; AST when available).",
      inputSchema: {
        type: "object",
        properties: { symbol: { type: "string" } },
        required: ["symbol"],
        additionalProperties: false,
      },
    },
    {
      name: "test_impact",
      description:
        "READ: Test-impact analysis for current git changes. Coverage-backed mapping not bundled.",
      inputSchema: emptyObjectSchema,
    },
    {
      name: "refactor_impact",
      description: "READ: Rename/refactor blast radius for a symbol.",
      inputSchema: {
        type: "object",
        properties: { symbol: { type: "string" } },
        required: ["symbol"],
        additionalProperties: false,
      },
    },
    {
      name: "code_health",
      description: "READ: Git hotspot / engineering intelligence with method disclosure.",
      inputSchema: emptyObjectSchema,
    },
    {
      name: "architecture_info",
      description: "READ: C4-style views inferred from graph evidence (labeled proposed/inferred).",
      inputSchema: emptyObjectSchema,
    },
    {
      name: "knowledge_retrieve",
      description:
        "READ: Governed knowledge retrieval. Abstains when no approved authoritative record matches.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        additionalProperties: false,
      },
    },
    {
      name: "policy_evaluate",
      description:
        "READ: Evaluate a shell command against local policy. Never executes. Always executionResult=not-executed.",
      inputSchema: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
        additionalProperties: false,
      },
    },
  ];
}

export async function invokeIntelligenceMcpTool(
  root: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ structured: unknown; isError: boolean }> {
  try {
    switch (name) {
      case "repo_overview":
        return { structured: await handleRepoOverview(root), isError: false };
      case "codebase_search":
        return { structured: await handleCodebaseSearch(root, args), isError: false };
      case "symbol_lookup":
        return { structured: await handleSymbolLookup(root, args), isError: false };
      case "dependency_lookup":
        return { structured: await handleDependencyLookup(root, args), isError: false };
      case "call_graph_lookup":
        return { structured: await handleCallGraphLookup(root, args), isError: false };
      case "test_impact":
        return { structured: await handleTestImpactTool(root), isError: false };
      case "refactor_impact":
        return { structured: await handleRefactorImpactTool(root, args), isError: false };
      case "code_health":
        return { structured: await handleCodeHealthTool(root), isError: false };
      case "architecture_info":
        return { structured: await handleArchitectureTool(root), isError: false };
      case "knowledge_retrieve":
        return { structured: await handleKnowledgeTool(root, args), isError: false };
      case "policy_evaluate":
        return { structured: await handlePolicyEvalTool(root, args), isError: false };
      default:
        return {
          structured: {
            ok: false,
            error: { code: "invalid_argument", message: `unknown intelligence tool: ${name}` },
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
