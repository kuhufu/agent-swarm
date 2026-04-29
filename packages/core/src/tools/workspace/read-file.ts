import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { WorkspaceManager } from "./manager.js";

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

      let text = `文件: ${params.path} (${formatSize(result.size)})`;
      if (result.truncated) {
        text += "\n[文件过长，内容已截断]";
      }
      text += `\n---\n${result.content}`;

      return {
        content: [{ type: "text", text }],
        details: { path: params.path, size: result.size, truncated: result.truncated },
      };
    },
  };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}
