import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { WorkspaceManager, FileInfo } from "./manager.js";

const ListFilesParams = Type.Object({
  path: Type.Optional(Type.String({
    description: "要列出的目录路径（相对于工作区根目录），默认为根目录",
  })),
  recursive: Type.Optional(Type.Boolean({
    description: "是否递归列出所有子目录中的文件，为 false 时只列出当前目录下的直接文件。默认 true",
  })),
});

type ListFilesParams = Static<typeof ListFilesParams>;

interface ListFilesDetails {
  files: FileInfo[];
}

export function createListFilesTool(
  workspace: WorkspaceManager,
): AgentTool<typeof ListFilesParams, ListFilesDetails> {
  return {
    name: "workspace_list_files",
    label: "列出文件",
    description: "列出工作区中的文件。",
    parameters: ListFilesParams,
    execute: async (_toolCallId, params) => {
      const files = await workspace.listFiles(params.path, params.recursive);

      if (files.length === 0) {
        return {
          content: [{ type: "text", text: `目录为空: ${params.path ?? "/"}` }],
          details: { files: [] },
        };
      }

      return {
        content: [{ type: "text", text: `共 ${files.length} 个文件` }],
        details: { files },
      };
    },
  };
}

function buildTree(files: FileInfo[]): string[] {
  const lines: string[] = [];
  for (const file of files) {
    const indent = "  ".repeat(file.path.split("/").length - 1);
    const name = file.path.split("/").pop() ?? file.path;
    lines.push(`${indent}${name} (${formatSize(file.size)})`);
  }
  return lines;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}
