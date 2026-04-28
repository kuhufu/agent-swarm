import { Type, Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { IVectorStore } from "../storage/vector-store.js";

const RetrieveParams = Type.Object({
  query: Type.String({
    description: "检索查询内容。支持空格分隔多个关键词，按任一关键词命中召回，例如：认证 身份验证 Authentication。",
  }),
  topK: Type.Optional(Type.Number({ description: "返回结果数量", default: 5 })),
});

type RetrieveParams = Static<typeof RetrieveParams>;

interface RetrieveKnowledgeToolOptions {
  userId: string;
}

export function createRetrieveKnowledgeTool(
  store: IVectorStore,
  options: RetrieveKnowledgeToolOptions,
): AgentTool<typeof RetrieveParams, any> {
  const userId = options.userId.trim();
  if (!userId) {
    throw new Error("retrieve_knowledge requires userId");
  }

  return {
    name: "retrieve_knowledge",
    label: "检索知识库",
    description: "从用户上传的文档知识库中检索与查询相关的内容片段。适合回答需要参考文档上下文的问题。query 可使用空格分隔多个关键词，系统会按任一关键词命中召回。",
    parameters: RetrieveParams,
    execute: async (_toolCallId: string, params: RetrieveParams): Promise<AgentToolResult<any>> => {
      const results = await store.search(params.query, params.topK ?? 5, userId);
      if (results.length === 0) {
        return {
          content: [{ type: "text", text: "知识库中没有找到相关内容。" }],
          details: [],
        };
      }
      const output = results.map((r, i) =>
        `[${i + 1}] 来源: ${r.document.title}\n${r.chunk.content}`
      ).join("\n---\n");
      return {
        content: [{ type: "text", text: output }],
        details: results,
      };
    },
  };
}
