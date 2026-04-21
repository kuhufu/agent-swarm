import { Type } from "@sinclair/typebox";

export const handoffTool = {
  name: "handoff",
  label: "Hand Off",
  description: "Hand off the conversation to another agent",
  parameters: Type.Object({
    agentId: Type.String({ description: "Agent to hand off to" }),
    message: Type.String({ description: "Context for the next agent" }),
  }),
  execute: async (_id: string, params: { agentId: string; message: string }) => ({
    content: [{ type: "text" as const, text: `Handing off to ${params.agentId}` }],
    details: { handoffTo: params.agentId },
  }),
};
