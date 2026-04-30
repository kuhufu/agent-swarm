/**
 * Message normalization utilities.
 * Extracted from conversation store for maintainability.
 */

import type { ChatMessage, ToolCallInfo } from "../types/index.js";

export function normalizeRole(role: unknown): ChatMessage["role"] {
  switch (role) {
    case "user":
    case "assistant":
    case "system":
    case "notification":
    case "tool_result":
      return role;
    case "toolResult":
      return "tool_result";
    default:
      return "notification";
  }
}

export function normalizeToolCalls(toolCalls: unknown): ToolCallInfo[] | undefined {
  const rawCalls = (() => {
    if (Array.isArray(toolCalls)) {
      return toolCalls;
    }
    if (typeof toolCalls === "string") {
      try {
        const parsed = JSON.parse(toolCalls) as unknown;
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        return undefined;
      }
    }
    return undefined;
  })();

  if (!rawCalls) {
    return undefined;
  }

  const normalized = rawCalls
    .map((call, index): ToolCallInfo | null => {
      if (!call || typeof call !== "object") {
        return null;
      }
      const raw = call as Record<string, unknown>;
      const id = typeof raw.id === "string"
        ? raw.id
        : (typeof raw.toolCallId === "string" ? raw.toolCallId : `tool-call-${index}`);
      const name = typeof raw.name === "string"
        ? raw.name
        : (typeof raw.toolName === "string" ? raw.toolName : "tool");
      const args = raw.arguments;
      const normalizedArguments = typeof args === "string"
        ? (() => {
          try {
            return JSON.parse(args);
          } catch {
            return args;
          }
        })()
        : (args ?? {});

      return {
        id,
        name,
        arguments: normalizedArguments,
        result: raw.result,
        isError: typeof raw.isError === "boolean" ? raw.isError : undefined,
      };
    })
    .filter((call): call is ToolCallInfo => call !== null);

  return normalized.length > 0 ? normalized : undefined;
}

export function parseMetadata(rawMetadata: unknown): Record<string, unknown> | null {
  if (typeof rawMetadata !== "string" || rawMetadata.trim().length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(rawMetadata) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function normalizeHistoryMessage(
  raw: unknown,
  resolveAgentName: (agentId?: string) => string | undefined,
): ChatMessage {
  if (!raw || typeof raw !== "object") {
    return {
      id: crypto.randomUUID(),
      role: "system",
      content: "",
      timestamp: Date.now(),
    };
  }

  const message = raw as Record<string, unknown>;
  const role = normalizeRole(message.role);
  const content = typeof message.content === "string" ? message.content : "";
  const toolCalls = normalizeToolCalls(message.toolCalls);
  const thinking = typeof message.thinking === "string" ? message.thinking : undefined;
  const agentId = typeof message.agentId === "string" ? message.agentId : undefined;
  const agentName = typeof message.agentName === "string" ? message.agentName : resolveAgentName(agentId);
  const timestamp = typeof message.timestamp === "number" ? message.timestamp : Date.now();
  const createdAt = typeof message.createdAt === "number" ? message.createdAt : undefined;
  const id = typeof message.id === "string" ? message.id : crypto.randomUUID();
  const rawMetadata = typeof message.metadata === "string" ? message.metadata : undefined;
  const metadata = rawMetadata ? parseMetadata(rawMetadata) : undefined;

  return {
    id,
    role,
    content,
    thinking,
    toolCalls,
    agentId,
    agentName,
    metadata: metadata ?? undefined,
    timestamp,
    createdAt,
  };
}

function isStandaloneClientToolResult(raw: Record<string, unknown>): boolean {
  const metadata = parseMetadata(raw.metadata);
  const details = metadata?.details;
  const source = (
    details
    && typeof details === "object"
    && !Array.isArray(details)
    && "source" in details
    && typeof (details as Record<string, unknown>).source === "string"
  )
    ? (details as Record<string, unknown>).source as string
    : "";
  if (source === "client_tool") {
    return true;
  }

  const toolName = typeof metadata?.toolName === "string" ? metadata.toolName : "";
  return toolName === "javascript_execute" || toolName === "current_time";
}

export function normalizeHistoryMessages(
  rawMessages: unknown[],
  resolveAgentName: (agentId?: string) => string | undefined,
): ChatMessage[] {
  const normalized: ChatMessage[] = [];
  const toolCallIndex = new Map<string, { messageIndex: number; toolCallIndex: number }>();

  for (const raw of rawMessages) {
    if (!raw || typeof raw !== "object") {
      normalized.push(normalizeHistoryMessage(raw, resolveAgentName));
      continue;
    }

    const message = raw as Record<string, unknown>;
    const role = normalizeRole(message.role);

    if (role === "tool_result") {
      const toolCallId = typeof message.toolCallId === "string" ? message.toolCallId : "";
      if (toolCallId && toolCallIndex.has(toolCallId)) {
        const pointer = toolCallIndex.get(toolCallId)!;
        const targetMessage = normalized[pointer.messageIndex];
        const toolCalls = targetMessage?.toolCalls;
        if (toolCalls && toolCalls[pointer.toolCallIndex]) {
          const metadata = parseMetadata(message.metadata);
          const details = metadata?.details;
          const content = typeof message.content === "string" ? message.content : "";
          const current = toolCalls[pointer.toolCallIndex];

          toolCalls[pointer.toolCallIndex] = {
            ...current,
            name: typeof metadata?.toolName === "string" ? metadata.toolName : current.name,
            isError: typeof metadata?.isError === "boolean" ? metadata.isError : current.isError,
            result: details ?? (content.trim().length > 0 ? content : current.result),
          };
        }
        continue;
      }

      if (isStandaloneClientToolResult(message)) {
        continue;
      }
    }

    const normalizedMessage = normalizeHistoryMessage(message, resolveAgentName);
    normalized.push(normalizedMessage);

    if (normalizedMessage.role === "assistant" && Array.isArray(normalizedMessage.toolCalls)) {
      normalizedMessage.toolCalls.forEach((toolCall, index) => {
        if (typeof toolCall.id === "string" && toolCall.id.trim().length > 0) {
          toolCallIndex.set(toolCall.id, {
            messageIndex: normalized.length - 1,
            toolCallIndex: index,
          });
        }
      });
    }
  }

  return normalized;
}
