import { Type, Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { IWikiStore } from "../storage/wiki-store.js";

const SearchWikiParams = Type.Object({
  query: Type.String({
    description: "检索查询内容。支持关键词、概念名、同义词或自然语言问题。",
  }),
  topK: Type.Optional(Type.Number({ description: "返回结果数量", default: 5 })),
});

type SearchWikiParams = Static<typeof SearchWikiParams>;

interface SearchWikiToolOptions {
  userId: string;
}

export function createSearchWikiTool(
  store: IWikiStore,
  options: SearchWikiToolOptions,
): AgentTool<typeof SearchWikiParams, any> {
  const userId = options.userId.trim();
  if (!userId) {
    throw new Error("search_wiki requires userId");
  }

  return {
    name: "search_wiki",
    label: "检索 Wiki",
    description: "从用户的 LLM Wiki 中检索结构化知识页面、要点和来源声明。适合回答需要参考长期知识库的问题。",
    parameters: SearchWikiParams,
    execute: async (_toolCallId: string, params: SearchWikiParams): Promise<AgentToolResult<any>> => {
      const results = await store.search(params.query, params.topK ?? 5, userId);
      if (results.length === 0) {
        return {
          content: [{ type: "text", text: "Wiki 中没有找到相关知识。" }],
          details: [],
        };
      }

      const output = results.map((result, index) => {
        const claims = result.claims.length > 0
          ? `\n要点:\n${result.claims.map((claim) => `- ${claim.text}`).join("\n")}`
          : "";
        const tags = result.page.tags.length > 0 ? `\n标签: ${result.page.tags.join(", ")}` : "";
        return [
          `[${index + 1}] ${result.page.title}`,
          result.page.summary,
          tags,
          claims,
          `正文:\n${result.page.content}`,
        ].filter(Boolean).join("\n");
      }).join("\n---\n");

      return {
        content: [{ type: "text", text: output }],
        details: results,
      };
    },
  };
}
