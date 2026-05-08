import type { AgentEvent as PiAgentEvent } from "@mariozechner/pi-agent-core";
import type { SwarmEvent } from "../core/types.js";

function extractToolCallFromPartial(event: Extract<PiAgentEvent, { type: "message_update" }>["assistantMessageEvent"]): {
  id?: string;
  name?: string;
  args?: unknown;
  argumentsText?: string;
} {
  const eventWithPartial = event as typeof event & {
    contentIndex?: number;
    partial?: { content?: unknown[] };
    toolCall?: unknown;
  };
  const contentIndex = typeof eventWithPartial.contentIndex === "number" ? eventWithPartial.contentIndex : undefined;
  const maybeEndToolCall = eventWithPartial.toolCall;
  const fromEnd = maybeEndToolCall
    && typeof maybeEndToolCall === "object"
    && !Array.isArray(maybeEndToolCall)
    && (maybeEndToolCall as Record<string, unknown>).type === "toolCall"
    ? maybeEndToolCall as Record<string, unknown>
    : undefined;
  const content = typeof contentIndex === "number"
    ? eventWithPartial.partial?.content?.[contentIndex]
    : undefined;
  const toolCall = fromEnd ?? (
    content
    && typeof content === "object"
    && !Array.isArray(content)
    && (content as Record<string, unknown>).type === "toolCall"
      ? content as Record<string, unknown>
      : undefined
  );
  if (!toolCall) {
    return {};
  }

  const partialJson = typeof toolCall.partialJson === "string"
    ? toolCall.partialJson
    : undefined;
  return {
    id: typeof toolCall.id === "string" ? toolCall.id : undefined,
    name: typeof toolCall.name === "string" ? toolCall.name : undefined,
    args: toolCall.arguments,
    argumentsText: partialJson,
  };
}

export function mapAgentEvent(e: PiAgentEvent, agentId: string, agentName: string): SwarmEvent | null {
  switch (e.type) {
    case "agent_start": return { type: "agent_start", agentId, agentName };
    case "agent_end": return { type: "agent_end", agentId, agentName };
    case "turn_start": return { type: "turn_start", agentId, turn: 0 };
    case "turn_end": return { type: "turn_end", agentId, turn: 0 };
    case "message_start": return { type: "message_start", agentId, agentName, role: e.message.role };
    case "message_update":
      if (e.assistantMessageEvent.type === "text_delta") {
        return { type: "message_update", agentId, delta: e.assistantMessageEvent.delta };
      }
      if (e.assistantMessageEvent.type === "thinking_delta") {
        return { type: "message_update", agentId, thinkingDelta: e.assistantMessageEvent.delta };
      }
      if (
        e.assistantMessageEvent.type === "toolcall_start"
        || e.assistantMessageEvent.type === "toolcall_delta"
        || e.assistantMessageEvent.type === "toolcall_end"
      ) {
        const toolCall = extractToolCallFromPartial(e.assistantMessageEvent);
        return {
          type: "message_update",
          agentId,
          toolCallPhase: e.assistantMessageEvent.type.replace("toolcall_", "") as "start" | "delta" | "end",
          toolCallContentIndex: e.assistantMessageEvent.contentIndex,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          toolCallArgs: toolCall.args,
          toolCallArgumentsDelta: e.assistantMessageEvent.type === "toolcall_delta"
            ? e.assistantMessageEvent.delta
            : undefined,
          toolCallArgumentsText: toolCall.argumentsText,
        };
      }

      return null;
    case "message_end": return { type: "message_end", agentId, agentName, role: e.message.role };
    case "tool_execution_start":
      return {
        type: "tool_execution_start",
        agentId,
        toolName: e.toolName,
        toolCallId: e.toolCallId,
        args: e.args,
      };
    case "tool_execution_update":
      return {
        type: "tool_execution_update",
        agentId,
        toolName: e.toolName,
        toolCallId: e.toolCallId,
        args: e.args,
        partialResult: e.partialResult,
      };
    case "tool_execution_end":
      return {
        type: "tool_execution_end",
        agentId,
        toolName: e.toolName,
        toolCallId: e.toolCallId,
        result: e.result,
        isError: e.isError,
      };
    default: return null;
  }
}
