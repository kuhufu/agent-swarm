import type { Message, AssistantMessage, ToolResultMessage, ToolCall, TextContent, ThinkingContent } from "@mariozechner/pi-ai";
import type { StoredMessage } from "./interface.js";

/**
 * Convert pi-ai Message to StoredMessage for persistence.
 */
export function messageToStored(msg: Message, agentId?: string): StoredMessage {
  const stored: StoredMessage = {
    id: crypto.randomUUID(),
    agentId: agentId ?? null,
    role: msg.role,
    timestamp: msg.timestamp,
    createdAt: Date.now(),
  };

  if (msg.role === "user") {
    if (typeof msg.content === "string") {
      stored.content = msg.content;
    } else {
      stored.content = msg.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => c.text)
        .join("\n");
    }
  } else if (msg.role === "assistant") {
    const assistantMsg = msg as AssistantMessage;
    const textParts: string[] = [];
    const thinkingParts: string[] = [];
    const toolCalls: ToolCall[] = [];

    for (const part of assistantMsg.content) {
      if (part.type === "text") {
        textParts.push(part.text);
      } else if (part.type === "thinking") {
        thinkingParts.push(part.thinking);
      } else if (part.type === "toolCall") {
        toolCalls.push(part);
      }
    }

    stored.content = textParts.join("\n") || null;
    stored.thinking = thinkingParts.join("\n") || null;
    stored.toolCalls = toolCalls.length > 0 ? JSON.stringify(toolCalls) : null;
    stored.metadata = JSON.stringify({
      provider: assistantMsg.provider,
      model: assistantMsg.model,
      stopReason: assistantMsg.stopReason,
      usage: assistantMsg.usage,
    });
  } else if (msg.role === "toolResult") {
    const toolMsg = msg as ToolResultMessage;
    stored.toolCallId = toolMsg.toolCallId;
    stored.content = toolMsg.content
      .filter((c): c is TextContent => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    stored.metadata = JSON.stringify({
      toolName: toolMsg.toolName,
      isError: toolMsg.isError,
      details: toolMsg.details,
    });
  }

  return stored;
}

/**
 * Convert StoredMessage back to pi-ai Message format.
 * Note: This is a simplified reconstruction. Full round-trip fidelity
 * requires storing the original JSON.
 */
export function storedToMessage(stored: StoredMessage): Message {
  if (stored.role === "user") {
    return {
      role: "user",
      content: stored.content ?? "",
      timestamp: stored.timestamp,
    };
  }

  if (stored.role === "assistant") {
    const content: (TextContent | ThinkingContent | ToolCall)[] = [];

    if (stored.content) {
      content.push({ type: "text", text: stored.content });
    }
    if (stored.thinking) {
      content.push({ type: "thinking", thinking: stored.thinking });
    }
    if (stored.toolCalls) {
      try {
        const calls: ToolCall[] = JSON.parse(stored.toolCalls);
        content.push(...calls);
      } catch { /* ignore */ }
    }

    let meta: any = {};
    if (stored.metadata) {
      try { meta = JSON.parse(stored.metadata); } catch { /* ignore */ }
    }

    return {
      role: "assistant",
      content,
      api: "anthropic-messages",
      provider: meta.provider ?? "anthropic",
      model: meta.model ?? "unknown",
      usage: meta.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: meta.stopReason ?? "stop",
      timestamp: stored.timestamp,
    } as AssistantMessage;
  }

  if (stored.role === "toolResult") {
    let meta: any = {};
    if (stored.metadata) {
      try { meta = JSON.parse(stored.metadata); } catch { /* ignore */ }
    }

    return {
      role: "toolResult",
      toolCallId: stored.toolCallId ?? "",
      toolName: meta.toolName ?? "unknown",
      content: stored.content ? [{ type: "text" as const, text: stored.content }] : [],
      isError: meta.isError ?? false,
      details: meta.details,
      timestamp: stored.timestamp,
    } as ToolResultMessage;
  }

  // Fallback: treat as user message
  return {
    role: "user",
    content: stored.content ?? "",
    timestamp: stored.timestamp,
  };
}
