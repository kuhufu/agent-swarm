import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { WorkspaceManager } from "./manager.js";

const WriteFileParams = Type.Object({
  path: Type.String({ description: "写入路径（相对于工作区根目录）" }),
  content: Type.String({ description: "要写入的文件内容" }),
});

interface WriteFileDetails {
  path: string;
  size: number;
}

export function createWriteFileTool(
  workspace: WorkspaceManager,
): AgentTool<typeof WriteFileParams, WriteFileDetails> {
  return {
    name: "workspace_write_file",
    label: "写入文件",
    description: "将内容写入工作目录中的文件。自动创建父目录。",
    parameters: WriteFileParams,
    execute: async (_toolCallId, params) => {
      const totalSize = await workspace.getTotalSize();
      if (totalSize > 52_428_800) {
        throw new Error("工作区总大小超过 50MB，请先清理无用文件");
      }

      const file = await workspace.writeFile(params.path, params.content);

      return {
        content: [{ type: "text", text: `文件已写入: ${file.path} (${formatSize(file.size)})` }],
        details: { path: file.path, size: file.size },
      };
    },
  };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}
