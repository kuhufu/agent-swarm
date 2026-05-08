import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { WorkspaceManager } from "./manager.js";
import { buildWorkspaceNextActions, formatWorkspaceSize, inferWorkspaceFileMeta, type WorkspaceFileMeta, type WorkspaceNextAction } from "./context.js";

const ReadFileParams = Type.Object({
  path: Type.String({ description: "要读取的文件路径（相对于工作区根目录）" }),
  maxLines: Type.Optional(Type.Number({
    description: "最大返回行数，默认 500",
    minimum: 1,
    maximum: 2000,
  })),
});

interface ReadFileDetails {
  path: string;
  size: number;
  truncated: boolean;
  meta: WorkspaceFileMeta;
  nextActions: WorkspaceNextAction[];
}

export function createReadFileTool(
  workspace: WorkspaceManager,
): AgentTool<typeof ReadFileParams, ReadFileDetails> {
  return {
    name: "workspace_read_file",
    label: "读取文件",
    description: "读取工作区中文件的内容。",
    parameters: ReadFileParams,
    execute: async (_toolCallId, params) => {
      const result = await workspace.readFile(params.path, params.maxLines ?? 500);
      const meta = inferWorkspaceFileMeta(params.path);

      let text = `文件: ${params.path} (${formatWorkspaceSize(result.size)}, ${meta.language ?? meta.kind})`;
      if (result.truncated) {
        text += "\n[文件过长，内容已截断]";
      }
      text += `\n---\n${result.content}`;

      return {
        content: [{ type: "text", text }],
        details: {
          path: params.path,
          size: result.size,
          truncated: result.truncated,
          meta,
          nextActions: buildWorkspaceNextActions({
            paths: [params.path],
            canRun: meta.kind === "code" || ["json", "html", "markdown", "text"].includes(meta.kind),
          }),
        },
      };
    },
  };
}
