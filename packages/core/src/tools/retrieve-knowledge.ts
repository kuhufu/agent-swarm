import { Type, Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { IVectorStore } from "../storage/vector-store.js";

const RetrieveParams = Type.Object({
  query: Type.String({ description: "检索查询内容" }),
  topK: Type.Optional(Type.Number({ description: "返回结果数量", default: 5 })),
});

type RetrieveParams = Static<typeof RetrieveParams>;

export function createRetrieveKnowledgeTool(store: IVectorStore): AgentTool<typeof RetrieveParams, any> {
  return {
    name: "retrieve_knowledge",
    label: "检索知识库",
    description: "从用户上传的文档知识库中检索与查询相关的内容片段。适合回答需要参考文档上下文的问题。",
    parameters: RetrieveParams,
    execute: async (_toolCallId: string, params: RetrieveParams): Promise<AgentToolResult<any>> => {
      const results = await store.search(params.query, params.topK ?? 5);
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
