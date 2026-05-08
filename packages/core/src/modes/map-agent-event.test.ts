import { describe, expect, it } from "vitest";
import type { AgentEvent as PiAgentEvent } from "@mariozechner/pi-agent-core";
import { mapAgentEvent } from "./map-agent-event.js";

describe("mapAgentEvent", () => {
  it("maps tool execution start events explicitly", () => {
    const event = mapAgentEvent({
      type: "tool_execution_start",
      toolName: "workspace_write_file",
      toolCallId: "call-1",
      args: { path: "result.txt" },
    } as PiAgentEvent, "agent-1", "Agent");

    expect(event).toEqual({
      type: "tool_execution_start",
      agentId: "agent-1",
      toolName: "workspace_write_file",
      toolCallId: "call-1",
      args: { path: "result.txt" },
    });
  });

  it("maps tool execution update partial results", () => {
    const event = mapAgentEvent({
      type: "tool_execution_update",
      toolName: "workspace_write_file",
      toolCallId: "call-1",
      args: { path: "result.txt" },
      partialResult: { progress: 0.5 },
    } as PiAgentEvent, "agent-1", "Agent");

    expect(event).toEqual({
      type: "tool_execution_update",
      agentId: "agent-1",
      toolName: "workspace_write_file",
      toolCallId: "call-1",
      args: { path: "result.txt" },
      partialResult: { progress: 0.5 },
    });
  });

  it("maps tool execution end results", () => {
    const event = mapAgentEvent({
      type: "tool_execution_end",
      toolName: "workspace_write_file",
      toolCallId: "call-1",
      result: { path: "result.txt" },
      isError: false,
    } as PiAgentEvent, "agent-1", "Agent");

    expect(event).toEqual({
      type: "tool_execution_end",
      agentId: "agent-1",
      toolName: "workspace_write_file",
      toolCallId: "call-1",
      result: { path: "result.txt" },
      isError: false,
    });
  });
});
