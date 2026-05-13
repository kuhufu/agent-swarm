import { describe, expect, it } from "vitest";
import type { AgentEvent as PiAgentEvent } from "@mariozechner/pi-agent-core";
import { mapAgentEvent } from "../../src/modes/map-agent-event.js";

describe("mapAgentEvent", () => {
  it("maps tool execution start events explicitly", () => {
    const event = mapAgentEvent({
      type: "tool_execution_start",
      toolName: "workspace_write_file",
      toolCallId: "call-1",
      args: { path: "result.txt" },
    } as unknown as PiAgentEvent, "agent-1", "Agent");

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
    } as unknown as PiAgentEvent, "agent-1", "Agent");

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

  it("maps streaming tool call argument deltas", () => {
    const event = mapAgentEvent({
      type: "message_update",
      message: {
        role: "assistant",
        content: [{
          type: "toolCall",
          id: "call-1",
          name: "workspace_write_file",
          arguments: { path: "essay.txt", content: "开头" },
          partialJson: "{\"path\":\"essay.txt\",\"content\":\"开头",
        }],
      },
      assistantMessageEvent: {
        type: "toolcall_delta",
        contentIndex: 0,
        delta: "开头",
        partial: {
          role: "assistant",
          content: [{
            type: "toolCall",
            id: "call-1",
            name: "workspace_write_file",
            arguments: { path: "essay.txt", content: "开头" },
            partialJson: "{\"path\":\"essay.txt\",\"content\":\"开头",
          }],
        },
      },
    } as unknown as PiAgentEvent, "agent-1", "Agent");

    expect(event).toEqual({
      type: "message_update",
      agentId: "agent-1",
      toolCallPhase: "delta",
      toolCallContentIndex: 0,
      toolCallId: "call-1",
      toolName: "workspace_write_file",
      toolCallArgs: { path: "essay.txt", content: "开头" },
      toolCallArgumentsDelta: "开头",
      toolCallArgumentsText: "{\"path\":\"essay.txt\",\"content\":\"开头",
    });
  });
});
