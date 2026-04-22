export function extractAssistantTextAndThinking(
  content: unknown,
): { text: string; thinking: string } {
  if (typeof content === "string") {
    return { text: content, thinking: "" };
  }

  if (!Array.isArray(content)) {
    return { text: "", thinking: "" };
  }

  const textParts: string[] = [];
  const thinkingParts: string[] = [];

  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }

    const item = part as Record<string, unknown>;
    if (item.type === "text" && typeof item.text === "string") {
      textParts.push(item.text);
      continue;
    }
    if (item.type === "thinking" && typeof item.thinking === "string") {
      thinkingParts.push(item.thinking);
    }
  }

  return {
    text: textParts.join(""),
    thinking: thinkingParts.join(""),
  };
}

export function extractAssistantErrorMessage(message: unknown): string | undefined {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return undefined;
  }

  const raw = (message as Record<string, unknown>).errorMessage;
  if (typeof raw !== "string") {
    return undefined;
  }

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function buildModelFailureMessage(
  provider: string,
  modelId: string,
  assistantErrorMessage?: string,
  stateErrorMessage?: string,
): string {
  const upstream = assistantErrorMessage?.trim();
  if (upstream && upstream.length > 0) {
    return `模型调用失败：${provider}/${modelId}；${upstream}`;
  }

  const stateError = stateErrorMessage?.trim();
  if (stateError && stateError.length > 0) {
    return `模型调用失败：${provider}/${modelId}；${stateError}`;
  }

  return `模型调用失败：${provider}/${modelId}`;
}
