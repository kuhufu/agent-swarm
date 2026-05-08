import type { AgentEvent as PiAgentEvent } from "@mariozechner/pi-agent-core";
import type { SwarmEvent } from "../core/types.js";

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

      return null;
    case "message_end": return { type: "message_end", agentId, agentName, role: e.message.role };
    case "tool_execution_start":
      return { ...e, agentId };
    case "tool_execution_update":
      return { ...e, agentId };
    case "tool_execution_end":
      return { ...e, agentId };
    default: return null;
  }
}
