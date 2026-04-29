import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { RuntimeTool } from "./runtime.js";
import { createRuntimeTool } from "./runtime.js";
import type { WorkspaceManager } from "./workspace.js";
import { createExecuteFileTool } from "./file-execute.js";
import { createListFilesTool } from "./file-list.js";
import { createReadFileTool } from "./file-read.js";
import { createWriteFileTool } from "./file-write.js";

export const WORKSPACE_TOOL_ID = "workspace";

export function createWorkspaceTools(workspace: WorkspaceManager): AgentTool<any>[] {
  return [
    createWriteFileTool(workspace),
    createReadFileTool(workspace),
    createListFilesTool(workspace),
    createExecuteFileTool(workspace),
  ];
}

export function createWorkspaceTool(workspace: WorkspaceManager): RuntimeTool {
  return createRuntimeTool(WORKSPACE_TOOL_ID, createWorkspaceTools(workspace));
}
