import type { StoredMessage } from "./interface.js";

// TODO: implement AgentMessage ↔ StoredMessage conversion
// Will be implemented after exploring pi-agent-core's AgentMessage type

export function agentMessageToStored(_msg: any, _agentId: string): StoredMessage {
  throw new Error("Not implemented yet");
}

export function storedToAgentMessage(_msg: StoredMessage): any {
  throw new Error("Not implemented yet");
}
