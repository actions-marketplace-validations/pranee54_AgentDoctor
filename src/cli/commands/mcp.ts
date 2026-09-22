import type { ExitCode } from "../../types/index.js";
import { EXIT_CODES } from "../../types/index.js";
import { resolveRepoRoot } from "../../utils/path.js";
import { runAgentDoctorMcpStdio } from "../../mcp/agentdoctor/server.js";

/**
 * Start combined AgentDoctor MCP (Brain tools + intelligence tools) over STDIO.
 */
export async function runMcpCommand(options: {
  root: string;
  buildIfMissing?: boolean;
}): Promise<ExitCode> {
  const root = resolveRepoRoot(options.root);
  await runAgentDoctorMcpStdio({
    root,
    buildIfMissing: options.buildIfMissing !== false,
  });
  return EXIT_CODES.SUCCESS;
}
