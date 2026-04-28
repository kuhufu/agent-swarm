import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { MCPClient, type MCPTool as MCPToolDef } from "./client.js";

export function createMCPToolProvider(
  client: MCPClient,
  serverId: string,
  toolDef: MCPToolDef,
): AgentTool<any, any> {
  return {
    name: `mcp_${serverId}_${toolDef.name}`,
    label: `${serverId}/${toolDef.name}`,
    description: `[${serverId}] ${toolDef.description}`,
    parameters: Type.Unsafe(toolDef.inputSchema),
    execute: async (_toolCallId: string, params: unknown, signal?: AbortSignal): Promise<AgentToolResult<any>> => {
      const result = await client.callTool(serverId, toolDef.name, params as Record<string, unknown>, signal);
      const text = result.content
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
      return {
        content: [{ type: "text", text: text || "工具执行完成" }],
        details: result.content,
      };
    },
  };
}

export function createAllMCPTools(
  client: MCPClient,
): AgentTool<any, any>[] {
  return client.getAllTools().map(({ serverId, tool }) =>
    createMCPToolProvider(client, serverId, tool),
  );
}
