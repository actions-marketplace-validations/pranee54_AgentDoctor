import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { PACKAGE_VERSION } from "../../constants.js";
import { resolveRepoRoot } from "../../utils/path.js";
import { BrainMcpSession } from "../brain/session.js";
import {
  BRAIN_MCP_TOOL_NAMES,
  invokeBrainMcpTool,
  listBrainMcpTools,
} from "../brain/tools/registry.js";
import {
  INTELLIGENCE_MCP_TOOL_NAMES,
  invokeIntelligenceMcpTool,
  listIntelligenceMcpTools,
} from "../intelligence/registry.js";
import { AGENT_MCP_TOOL_NAMES, invokeAgentMcpTool, listAgentMcpTools } from "../agent/registry.js";

export interface StartAgentDoctorMcpOptions {
  root: string;
  buildIfMissing?: boolean;
}

/**
 * Combined AgentDoctor MCP server: preserves all Brain tool names and adds
 * intelligence tools. No arbitrary shell execution; policy_evaluate is evaluate-only.
 */
export async function startAgentDoctorMcpServer(
  options: StartAgentDoctorMcpOptions,
): Promise<{ server: Server; session: BrainMcpSession; root: string }> {
  const root = resolveRepoRoot(options.root);
  const session = new BrainMcpSession({
    root,
    buildIfMissing: options.buildIfMissing !== false,
  });
  await session.initialize();

  const brainNames = new Set<string>(BRAIN_MCP_TOOL_NAMES);
  const intelNames = new Set<string>(INTELLIGENCE_MCP_TOOL_NAMES);
  const agentNames = new Set<string>(AGENT_MCP_TOOL_NAMES);

  const server = new Server(
    {
      name: "agentdoctor",
      version: PACKAGE_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...listBrainMcpTools(), ...listIntelligenceMcpTools(), ...listAgentMcpTools()],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    let structured: unknown;
    let isError = false;

    if (brainNames.has(name)) {
      const result = await invokeBrainMcpTool(session, name, args);
      structured = result.structured;
      isError = result.isError;
    } else if (intelNames.has(name)) {
      const result = await invokeIntelligenceMcpTool(root, name, args);
      structured = result.structured;
      isError = result.isError;
    } else if (agentNames.has(name)) {
      const result = await invokeAgentMcpTool(root, name, args);
      structured = result.structured;
      isError = result.isError;
    } else {
      structured = {
        ok: false,
        error: { code: "invalid_argument", message: `unknown tool: ${name}` },
      };
      isError = true;
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(structured) }],
      structuredContent: structured as Record<string, unknown>,
      isError,
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  return { server, session, root };
}

export async function runAgentDoctorMcpStdio(options: StartAgentDoctorMcpOptions): Promise<void> {
  await startAgentDoctorMcpServer(options);
}
