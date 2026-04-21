import { Type } from "@sinclair/typebox";

// TODO: implement with pi-agent-core AgentTool type
export const routeToAgentTool = {
  name: "route_to_agent",
  label: "Route to Agent",
  description: "Route the conversation to a specialist agent",
  parameters: Type.Object({
    agentId: Type.String({ description: "Target agent ID" }),
    message: Type.String({ description: "Message to send to the agent" }),
  }),
  execute: async (_id: string, params: { agentId: string; message: string }) => ({
    content: [{ type: "text" as const, text: `Routing to ${params.agentId}...` }],
    details: { routedTo: params.agentId },
  }),
};
