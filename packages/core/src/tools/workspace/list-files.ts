import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { WorkspaceManager, FileInfo } from "./manager.js";
import { buildWorkspaceNextActions, formatWorkspaceSize, inferWorkspaceFileMeta, summarizeWorkspaceFiles, type WorkspaceNextAction } from "./context.js";

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
  count: number;
  totalSize: number;
  directories: string[];
  nextActions: WorkspaceNextAction[];
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
          content: [{
            type: "text",
            text: [
              `目录为空: ${params.path ?? "/"}`,
              "可用 workspace_write_file 创建文件，或调整 path/recursive 重新列出。",
            ].join("\n"),
          }],
          details: {
            files: [],
            count: 0,
            totalSize: 0,
            directories: [],
            nextActions: buildWorkspaceNextActions({ directory: params.path }),
          },
        };
      }

      const totalSize = files.reduce((sum, file) => sum + file.size, 0);
      const directories = [...new Set(files.map((file) => getDirectory(file.path)).filter((dir) => dir.length > 0))].sort();
      const previewableCount = files.filter((file) => inferWorkspaceFileMeta(file.path).previewable).length;

      return {
        content: [{
          type: "text",
          text: [
            `共 ${files.length} 个文件，总大小 ${formatWorkspaceSize(totalSize)}，可预览 ${previewableCount} 个。`,
            summarizeWorkspaceFiles(files),
            "后续可用 workspace_read_file 读取具体文件，workspace_grep 搜索内容，或 workspace_run_container 执行验证命令。",
          ].join("\n"),
        }],
        details: {
          files,
          count: files.length,
          totalSize,
          directories,
          nextActions: buildWorkspaceNextActions({
            paths: files.map((file) => file.path),
            directory: params.path,
            canRun: files.some((file) => inferWorkspaceFileMeta(file.path).kind === "code"),
          }),
        },
      };
    },
  };
}

function getDirectory(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(0, index) : "";
}
