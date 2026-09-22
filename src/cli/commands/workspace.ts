import { EXIT_CODES } from "../../types/index.js";
import {
  addRepositoryToWorkspace,
  initWorkspace,
  listWorkspaces,
  removeWorkspace,
  workspaceStatus,
} from "../../workspace/index.js";

function emit(json: boolean, value: unknown, human: string): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else {
    process.stdout.write(`${human}\n`);
  }
}

export async function runWorkspaceCommand(options: {
  action: "init" | "add" | "list" | "status" | "remove";
  root: string;
  name?: string;
  id?: string;
  repositoryRoot?: string;
  allowCrossRead?: boolean;
  json?: boolean;
}): Promise<number> {
  try {
    const controlRoot = options.root;
    switch (options.action) {
      case "init": {
        if (!options.name?.trim()) {
          process.stderr.write("Error: workspace init requires --name\n");
          return EXIT_CODES.USAGE_ERROR;
        }
        const ws = await initWorkspace({
          controlRoot,
          name: options.name,
          ...(options.id ? { id: options.id } : {}),
          ...(options.repositoryRoot ? { repositoryRoot: options.repositoryRoot } : {}),
          allowCrossRead: options.allowCrossRead === true,
        });
        emit(
          Boolean(options.json),
          ws,
          `workspace init id=${ws.id} name=${ws.name} roots=${ws.repositoryRoots.length} allowCrossRead=${ws.allowCrossRead}`,
        );
        return EXIT_CODES.SUCCESS;
      }
      case "add": {
        if (!options.id?.trim() || !options.repositoryRoot?.trim()) {
          process.stderr.write("Error: workspace add requires --id and --repo\n");
          return EXIT_CODES.USAGE_ERROR;
        }
        const ws = await addRepositoryToWorkspace({
          controlRoot,
          workspaceId: options.id,
          repositoryRoot: options.repositoryRoot,
        });
        emit(
          Boolean(options.json),
          ws,
          `workspace add id=${ws.id} roots=${ws.repositoryRoots.join(", ")}`,
        );
        return EXIT_CODES.SUCCESS;
      }
      case "list": {
        const list = await listWorkspaces(controlRoot);
        emit(
          Boolean(options.json),
          { workspaces: list },
          list.length === 0
            ? "No workspaces under .agentdoctor/workspaces/"
            : list
                .map(
                  (w) =>
                    `${w.id}\t${w.name}\troots=${w.repositoryRoots.length}\tcrossRead=${w.allowCrossRead}`,
                )
                .join("\n"),
        );
        return EXIT_CODES.SUCCESS;
      }
      case "status": {
        if (!options.id?.trim()) {
          process.stderr.write("Error: workspace status requires --id\n");
          return EXIT_CODES.USAGE_ERROR;
        }
        const status = await workspaceStatus(controlRoot, options.id);
        emit(
          Boolean(options.json),
          status,
          status.ok
            ? `workspace ${options.id} ok roots=${status.workspace?.repositoryRoots.length ?? 0}`
            : `workspace ${options.id} ${status.error ?? "degraded"} missing=${status.missingRoots.join(", ") || "none"}`,
        );
        return status.ok ? EXIT_CODES.SUCCESS : EXIT_CODES.ISSUES_OR_THRESHOLD;
      }
      case "remove": {
        if (!options.id?.trim()) {
          process.stderr.write("Error: workspace remove requires --id\n");
          return EXIT_CODES.USAGE_ERROR;
        }
        const removed = await removeWorkspace(controlRoot, options.id);
        emit(
          Boolean(options.json),
          { removed, id: options.id },
          removed ? `workspace removed ${options.id}` : `workspace not found ${options.id}`,
        );
        return removed ? EXIT_CODES.SUCCESS : EXIT_CODES.ISSUES_OR_THRESHOLD;
      }
      default:
        process.stderr.write("Error: unknown workspace action\n");
        return EXIT_CODES.USAGE_ERROR;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    return EXIT_CODES.INTERNAL_ERROR;
  }
}
