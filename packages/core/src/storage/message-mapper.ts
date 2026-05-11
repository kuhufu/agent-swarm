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
      const textParts: string[] = [];
      const images: ImageContent[] = [];
      for (const part of msg.content) {
        if (part.type === "text") {
          textParts.push(part.text);
        } else if (part.type === "image") {
          images.push(part);
        }
      }
      stored.content = textParts.join("\n");
      if (images.length > 0) {
        const existingMeta = stored.metadata ? JSON.parse(stored.metadata) : {};
        existingMeta.images = images.map((img) => ({ data: img.data, mimeType: img.mimeType }));
        stored.metadata = JSON.stringify(existingMeta);
      }
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
    const parts: (TextContent | ImageContent)[] = [];
    if (stored.content) {
      parts.push({ type: "text", text: stored.content });
    }
    // Restore images from metadata
    if (stored.metadata) {
      try {
        const meta = JSON.parse(stored.metadata);
        if (Array.isArray(meta.images)) {
          for (const img of meta.images) {
            if (typeof img.data === "string" && typeof img.mimeType === "string") {
              parts.push({ type: "image", data: img.data, mimeType: img.mimeType });
            }
          }
        }
      } catch { /* ignore */ }
    }
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

  // Fallback: treat as user message
  return {
    role: "user",
    content: stored.content ?? "",
    timestamp: stored.timestamp,
  };
}
