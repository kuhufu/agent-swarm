import { Type, Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

const HandoffParams = Type.Object({
  agentId: Type.String({ description: "The ID of the agent to hand off to" }),
  message: Type.String({ description: "Context or summary for the next agent" }),
});

type HandoffParams = Static<typeof HandoffParams>;

/**
 * handoff tool definition for Swarm mode.
 * Agents use this tool to hand off control to another agent.
 */
export function createHandoffTool(availableAgents: { id: string; name: string; description: string }[]): AgentTool<typeof HandoffParams, { handoffTo: string; message: string }> {
  const availableAgentIds = new Set(
    availableAgents
      .map((agent) => agent.id.trim())
      .filter((agentId) => agentId.length > 0),
  );

  return {
    name: "handoff",
    label: "Hand Off",
    description: "Hand off the conversation to another agent. Available agents: " +
      availableAgents.map((a) => `${a.id} (${a.name}: ${a.description})`).join(", "),
    parameters: HandoffParams,
    execute: async (_toolCallId: string, params: HandoffParams): Promise<AgentToolResult<{ handoffTo: string; message: string }>> => {
      const targetAgentId = params.agentId.trim();
      if (!targetAgentId) {
        throw new Error("Invalid handoff target: agentId is required");
      }
      if (!availableAgentIds.has(targetAgentId)) {
        const availableList = availableAgents.map((agent) => agent.id).join(", ");
        throw new Error(
          `Invalid handoff target "${params.agentId}". Available targets: ${availableList || "none"}`,
        );
      }

      return {
        content: [{ type: "text" as const, text: `Handing off to ${targetAgentId}` }],
        details: { handoffTo: targetAgentId, message: params.message },
      };
    },
  };
}

/**
 * Default handoff tool with no agent list (agents populated at runtime).
 */
export const handoffTool = createHandoffTool([]);
