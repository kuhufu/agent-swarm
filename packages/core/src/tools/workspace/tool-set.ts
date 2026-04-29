import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { RuntimeTool } from "../runtime.js";
import { createRuntimeTool } from "../runtime.js";
import type { WorkspaceManager } from "./manager.js";
import { createExecuteFileTool } from "./execute.js";
import { createListFilesTool } from "./list-files.js";
import { createReadFileTool } from "./read-file.js";
import { createWriteFileTool } from "./write-file.js";
import { createCleanupWorkspaceContainersTool, createListWorkspaceContainersTool } from "./containers.js";

export const WORKSPACE_TOOL_ID = "workspace";

export function createWorkspaceTools(workspace: WorkspaceManager): AgentTool<any>[] {
  return [
    createWriteFileTool(workspace),
    createReadFileTool(workspace),
    createListFilesTool(workspace),
    createExecuteFileTool(workspace),
    createListWorkspaceContainersTool(workspace),
    createCleanupWorkspaceContainersTool(workspace),
  ];
}

export function createWorkspaceTool(workspace: WorkspaceManager): RuntimeTool {
  return createRuntimeTool(WORKSPACE_TOOL_ID, createWorkspaceTools(workspace));
}
