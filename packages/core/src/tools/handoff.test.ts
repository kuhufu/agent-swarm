import { describe, it, expect } from "vitest";
import { createHandoffTool } from "./handoff.js";

describe("handoff tool", () => {
  it("throws when handoff target is not in available agent list", async () => {
    const tool = createHandoffTool([
      { id: "agent-a", name: "Agent A", description: "A" },
      { id: "agent-b", name: "Agent B", description: "B" },
    ]);

    await expect(tool.execute("call-1", {
      agentId: "agent-c",
      message: "route to c",
    })).rejects.toThrow('Invalid handoff target "agent-c"');
  });

  it("normalizes target id and returns handoff details for valid target", async () => {
    const tool = createHandoffTool([
      { id: "agent-a", name: "Agent A", description: "A" },
    ]);

    const result = await tool.execute("call-2", {
      agentId: "  agent-a  ",
      message: "handoff context",
    });

    expect(result.details).toEqual({
      handoffTo: "agent-a",
      message: "handoff context",
    });
  });
});
