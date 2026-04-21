import { Type, Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

const RouteToAgentParams = Type.Object({
  agentId: Type.String({ description: "The ID of the agent to route to" }),
  message: Type.String({ description: "Message or context to send to the agent" }),
});

type RouteToAgentParams = Static<typeof RouteToAgentParams>;

/**
 * route_to_agent tool definition for Router mode.
 * The orchestrator agent uses this tool to route the conversation to a specialist agent.
 */
export function createRouteToAgentTool(availableAgents: { id: string; name: string; description: string }[]): AgentTool<typeof RouteToAgentParams, { routedTo: string; message: string }> {
  return {
    name: "route_to_agent",
    label: "Route to Agent",
    description: "Route the conversation to a specialist agent. Available agents: " +
      availableAgents.map((a) => `${a.id} (${a.name}: ${a.description})`).join(", "),
    parameters: RouteToAgentParams,
    execute: async (_toolCallId: string, params: RouteToAgentParams): Promise<AgentToolResult<{ routedTo: string; message: string }>> => {
      return {
        content: [{ type: "text" as const, text: `Routing to agent ${params.agentId}...` }],
        details: { routedTo: params.agentId, message: params.message },
      };
    },
  };
}

/**
 * Default route_to_agent tool with no agent list (agents populated at runtime).
 */
export const routeToAgentTool = createRouteToAgentTool([]);
