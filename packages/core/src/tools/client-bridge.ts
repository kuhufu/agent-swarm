import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

export interface ClientToolDefinition {
  name: string;
  label: string;
  description: string;
  parametersSchema?: Record<string, unknown>;
}

export interface ClientToolExecutionResult {
  content: string;
  details?: unknown;
  isError?: boolean;
}

interface CreateClientBridgeToolOptions {
  tool: ClientToolDefinition;
  execute: (request: { toolName: string; toolCallId: string; params: unknown }) => Promise<ClientToolExecutionResult>;
}

function buildParametersSchema(schema?: Record<string, unknown>) {
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    return Type.Unsafe<Record<string, unknown>>(schema);
  }
  return Type.Object({}, { additionalProperties: true });
}

export function createClientBridgeTool(options: CreateClientBridgeToolOptions): AgentTool<any, unknown> {
  const { tool, execute } = options;
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: buildParametersSchema(tool.parametersSchema),
    execute: async (toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> => {
      const result = await execute({
        toolName: tool.name,
        toolCallId,
        params,
      });

      if (result.isError) {
        throw new Error(result.content || `Tool execution failed: ${tool.name}`);
      }

      return {
        content: [{
          type: "text",
          text: result.content || "Tool executed successfully.",
        }],
        details: result.details,
      };
    },
  };
}
