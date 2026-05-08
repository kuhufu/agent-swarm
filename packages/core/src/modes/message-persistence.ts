import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import type { ModeExecutionContext } from "./types.js";
import { messageToStored } from "../storage/message-mapper.js";

export function createMessagePersistor(
  ctx: ModeExecutionContext,
  agentId: string,
  initialMessageCount: number,
  getMessages: () => AgentMessage[],
): { persistPendingMessages: () => Promise<void> } {
  let persistedMessageCount = initialMessageCount;
  let persistChain = Promise.resolve();

  const persistPendingMessages = () => {
    persistChain = persistChain.then(async () => {
      const messages = getMessages();
      const pendingMessages = messages.slice(persistedMessageCount);
      for (const message of pendingMessages) {
        if (!isPersistablePiMessage(message) || message.role === "user") {
          continue;
        }
        await ctx.storage.appendMessage(
          ctx.conversationId,
          messageToStored(message, agentId),
        );
      }
      persistedMessageCount = messages.length;
    });
    return persistChain;
  };

  return { persistPendingMessages };
}

function isPersistablePiMessage(message: AgentMessage): message is Message {
  return typeof message === "object"
    && message !== null
    && "role" in message
    && (message.role === "user" || message.role === "assistant" || message.role === "toolResult");
}
