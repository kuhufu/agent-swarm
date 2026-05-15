import type { Message, AssistantMessage, ToolResultMessage, ToolCall, TextContent, ThinkingContent, ImageContent } from "@mariozechner/pi-ai";
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
      // Store full ContentPart array as JSON
      stored.content = JSON.stringify(msg.content);
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
    // Try to parse content as JSON ContentPart array
    const parts = parseUserContent(stored.content);
    return {
      role: "user",
      content: parts.length === 1 && parts[0]?.type === "text"
        ? (parts[0] as TextContent).text
        : (parts.length > 0 ? parts : ""),
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
    // For restored history context, avoid replaying raw tool calls into the model context.
    // Keep text/thinking only; if the assistant turn only contained tool calls,
    // best-effort extract a human-readable response from known call arguments.
    if (content.length === 0 && stored.toolCalls) {
      try {
        const calls = JSON.parse(stored.toolCalls) as Array<{ arguments?: Record<string, unknown> }>;
        const recoveredTexts = calls
          .map((call) => {
            const args = call.arguments;
            if (!args || typeof args !== "object") {
              return "";
            }
            if (typeof args.response === "string") {
              return args.response;
            }
            if (typeof args.message === "string") {
              return args.message;
            }
            if (typeof args.content === "string") {
              return args.content;
            }
            return "";
          })
          .filter((text) => text.trim().length > 0);
        if (recoveredTexts.length > 0) {
          content.push({ type: "text", text: recoveredTexts.join("\n") });
        }
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
    // Persisted tool results are user-visible content in this project.
    // Restore them as assistant text for robust cross-provider context continuity.
    return {
      role: "assistant",
      content: stored.content ? [{ type: "text" as const, text: stored.content }] : [],
      api: "anthropic-messages",
      provider: "restored",
      model: "restored",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: stored.timestamp,
    } as AssistantMessage;
  }

  // Fallback: treat as user message.
  return {
    role: "user",
    content: stored.content ?? "",
    timestamp: stored.timestamp,
  };
}

/**
 * Parse stored user message content back into ContentPart array.
 * Supports both new JSON array format and legacy plain text.
 */
function parseUserContent(content: string | null | undefined): (TextContent | ImageContent)[] {
  if (!content) return [];

  // Try parsing as JSON array (new format)
  if (content.startsWith("[") && content.includes('"type"')) {
    try {
      const parsed = JSON.parse(content) as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
      if (Array.isArray(parsed) && parsed.length > 0) {
        const parts: (TextContent | ImageContent)[] = [];
        for (const item of parsed) {
          if (item.type === "text" && typeof item.text === "string") {
            parts.push({ type: "text", text: item.text });
          } else if (item.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string") {
            parts.push({ type: "image", data: item.data, mimeType: item.mimeType });
          }
        }
        return parts;
      }
    } catch { /* fall through to legacy handling */ }
  }

  // Legacy: plain text string
  return [{ type: "text" as const, text: content }];
}
