import { Type } from "@sinclair/typebox";

export const respondToUserTool = {
  name: "respond_to_user",
  label: "Respond to User",
  description: "Send the final response to the user",
  parameters: Type.Object({
    response: Type.String({ description: "Final response" }),
  }),
  execute: async (_id: string, params: { response: string }) => ({
    content: [{ type: "text" as const, text: params.response }],
    details: { final: true },
  }),
};
