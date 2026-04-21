import { Type, Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

const RespondToUserParams = Type.Object({
  response: Type.String({ description: "The final response to send to the user" }),
});

type RespondToUserParams = Static<typeof RespondToUserParams>;

/**
 * respond_to_user tool definition.
 * Agents use this tool to send a final response to the user.
 */
export const respondToUserTool: AgentTool<typeof RespondToUserParams, { final: boolean }> = {
  name: "respond_to_user",
  label: "Respond to User",
  description: "Send the final response to the user. Use this when you have completed the task and want to deliver the answer.",
  parameters: RespondToUserParams,
  execute: async (_toolCallId: string, params: RespondToUserParams): Promise<AgentToolResult<{ final: boolean }>> => {
    return {
      content: [{ type: "text" as const, text: params.response }],
      details: { final: true },
    };
  },
};
