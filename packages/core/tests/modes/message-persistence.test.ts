import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ModeExecutionContext } from "../../src/modes/types.js";
import { createMessagePersistor } from "../../src/modes/message-persistence.js";

describe("createMessagePersistor", () => {
  it("persists pending assistant and tool-result messages incrementally without duplicates", async () => {
    const storedMessages: unknown[] = [];
    const messages: AgentMessage[] = [
      { role: "user", content: "hi", timestamp: 1 } as AgentMessage,
    ];
    const ctx = {
      conversationId: "conv-1",
      storage: {
        appendMessage: async (_conversationId: string, message: unknown) => {
          storedMessages.push(message);
        },
      },
    } as unknown as ModeExecutionContext;
    const persistor = createMessagePersistor(ctx, "agent-1", messages.length, () => messages);

    messages.push({
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
      timestamp: 2,
      api: "openai-completions",
      provider: "openai",
      model: "gpt-test",
      usage: { input: 1, output: 1 },
      stopReason: "toolUse",
    } as AgentMessage);
    await persistor.persistPendingMessages();
    await persistor.persistPendingMessages();

    messages.push({
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "workspace_read_file",
      content: [{ type: "text", text: "result" }],
      details: { path: "a.txt" },
      isError: false,
      timestamp: 3,
    } as AgentMessage);
    await persistor.persistPendingMessages();

    expect(storedMessages).toHaveLength(2);
    expect(storedMessages).toEqual([
      expect.objectContaining({ role: "assistant", agentId: "agent-1" }),
      expect.objectContaining({ role: "toolResult", agentId: "agent-1", toolCallId: "call-1" }),
    ]);
  });
});
