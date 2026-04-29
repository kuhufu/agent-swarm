import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { WorkspaceManager, FileInfo } from "./workspace.js";

const ListFilesParams = Type.Object({
  path: Type.Optional(Type.String({
    description: "要列出的目录路径（相对于工作区根目录），默认为根目录",
  })),
});

interface ListFilesDetails {
  files: FileInfo[];
}

export function createListFilesTool(
  workspace: WorkspaceManager,
): AgentTool<typeof ListFilesParams, ListFilesDetails> {
  return {
    name: "list_files",
    label: "列出文件",
    description: "列出工作区中的文件。",
    parameters: ListFilesParams,
    execute: async (_toolCallId, params) => {
      const files = await workspace.listFiles(params.path);

      if (files.length === 0) {
        return {
          content: [{ type: "text", text: `目录为空: ${params.path ?? "/"}` }],
          details: { files: [] },
        };
      }

      const tree = buildTree(files);
      const text = tree.length > 0 ? tree.join("\n") : `目录为空: ${params.path ?? "/"}`;

      return {
        content: [{ type: "text", text: `工作区 (${files.length} 个文件):\n${text}` }],
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
