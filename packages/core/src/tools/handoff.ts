import { Type, Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

const HandoffParams = Type.Object({
  agentId: Type.String({ description: "The ID of the agent to hand off to" }),
  message: Type.Optional(Type.String({ description: "Context or summary for the next agent" })),
  reason: Type.Optional(Type.String({ description: "Why this handoff is needed" })),
  task: Type.Optional(Type.String({ description: "The specific task the target agent should perform" })),
  context: Type.Optional(Type.String({ description: "Relevant context for the target agent" })),
  expectedOutput: Type.Optional(Type.String({ description: "Expected output from the target agent" })),
  returnToAgentId: Type.Optional(Type.String({ description: "Optional agent ID to return to after completion" })),
});

type HandoffParams = Static<typeof HandoffParams>;
export interface HandoffDetails {
  handoffTo: string;
  message: string;
  reason?: string;
  task?: string;
  context?: string;
  expectedOutput?: string;
  returnToAgentId?: string;
}

/**
 * handoff tool definition for Swarm mode.
 * Agents use this tool to hand off control to another agent.
 */
export function createHandoffTool(availableAgents: { id: string; name: string; description: string }[]): AgentTool<typeof HandoffParams, HandoffDetails> {
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
    execute: async (_toolCallId: string, params: HandoffParams): Promise<AgentToolResult<HandoffDetails>> => {
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

      const message = params.message?.trim() ?? "";
      const reason = params.reason?.trim();
      const task = params.task?.trim();
      const context = params.context?.trim();
      const expectedOutput = params.expectedOutput?.trim();
      const returnToAgentId = params.returnToAgentId?.trim();

      return {
        content: [{ type: "text" as const, text: `Handing off to ${targetAgentId}` }],
        details: {
          handoffTo: targetAgentId,
          message,
          ...(reason ? { reason } : {}),
          ...(task ? { task } : {}),
          ...(context ? { context } : {}),
          ...(expectedOutput ? { expectedOutput } : {}),
          ...(returnToAgentId ? { returnToAgentId } : {}),
        },
      };
    },
  };
}

/**
 * Default handoff tool with no agent list (agents populated at runtime).
 */
export const handoffTool = createHandoffTool([]);
