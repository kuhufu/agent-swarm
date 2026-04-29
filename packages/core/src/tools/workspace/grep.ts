import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { WorkspaceManager, GrepMatch } from "./manager.js";

const GrepParams = Type.Object({
  pattern: Type.String({ description: "搜索模式（正则表达式）" }),
  include: Type.Optional(Type.String({
    description: "文件过滤模式，如 *.ts、*.{ts,js}、src/**/*.ts",
  })),
  maxResults: Type.Optional(Type.Number({
    description: "最大返回匹配行数，默认 50",
    minimum: 1,
    maximum: 200,
  })),
});

interface GrepDetails {
  matches: GrepMatch[];
  total: number;
}

export function createGrepTool(
  workspace: WorkspaceManager,
): AgentTool<typeof GrepParams, GrepDetails> {
  return {
    name: "workspace_grep",
    label: "搜索文件内容",
    description: "在工作区文件中搜索匹配的内容（仅限当前会话工作区内的文件）。支持正则表达式，可用 include 按文件路径过滤。",
    parameters: GrepParams,
    execute: async (_toolCallId, params): Promise<AgentToolResult<GrepDetails>> => {
      const matches = await workspace.grep(params.pattern, {
        include: params.include,
        maxResults: params.maxResults,
      });

      if (matches.length === 0) {
        return {
          content: [{ type: "text", text: "未找到匹配内容。" }],
          details: { matches: [], total: 0 },
        };
      }

      const text = [
        `找到 ${matches.length} 处匹配:`,
        ...matches.map((m) => `  ${m.path}:${m.line}  ${m.content}`),
      ].join("\n");

      return {
        content: [{ type: "text", text }],
        details: { matches, total: matches.length },
      };
    },
  };
}
