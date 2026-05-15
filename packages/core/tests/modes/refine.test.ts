import { describe, expect, it, vi } from "vitest";
import type { SwarmAgentConfig, SwarmConfig, SwarmEvent } from "../../src/core/types.js";
import type { ModeExecutionContext } from "../../src/modes/types.js";
import type { IStorage } from "../../src/storage/interface.js";
import { RefineMode } from "../../src/modes/refine.js";

class FakeAgent {
  public readonly state: { messages: any[] } = { messages: [] };
  public readonly prompts: string[] = [];

  constructor(
    private readonly agentId: string,
    private readonly outputForPrompt: (input: string, promptIndex: number) => string,
  ) {}

  subscribe(listener: (event: any) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  private listener?: (event: any) => void;

  async prompt(input: string): Promise<void> {
    this.prompts.push(input);
    const assistantText = this.outputForPrompt(input, this.prompts.length);
    this.state.messages.push({ role: "user", content: input, timestamp: Date.now() });
    this.state.messages.push({
      role: "assistant",
      content: [{ type: "text", text: assistantText }],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "fake-model",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });
    this.emit({ type: "agent_start" });
    this.emit({ type: "message_start", message: { role: "assistant" } });
    this.emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: assistantText }],
        stopReason: "stop",
      },
    });
    this.emit({ type: "agent_end" });
  }

  abort(): void {}

  private emit(event: any): void {
    this.listener?.(event);
  }
}

function createAgentConfig(id: string): SwarmAgentConfig {
  return {
    id,
    name: id,
    description: `${id} description`,
    systemPrompt: `${id} system`,
    model: {
      provider: "invalid-provider",
      modelId: "fake-model",
    },
  };
}

function createContext(
  outputForAgent: (agentId: string, input: string, promptIndex: number) => string,
  storedMessages: Awaited<ReturnType<IStorage["getMessages"]>> = [],
  initialMetadata: Record<string, unknown> = {},
): ModeExecutionContext {
  const expander = createAgentConfig("expander");
  const critic = createAgentConfig("critic");
  const swarmConfig: SwarmConfig = {
    id: "refine_swarm",
    name: "Refine Swarm",
    mode: "refine",
    agents: [expander, critic],
  };
  const agents = new Map<string, { agent: any; config: SwarmAgentConfig }>();
  const metadata = new Map<string, unknown>();
  for (const [key, value] of Object.entries(initialMetadata)) {
    metadata.set(key, value);
  }
  const appendMessage = vi.fn(async () => undefined);
  const updateLatestAssistantMessageRole = vi.fn(async () => undefined);
  const getMessages = vi.fn(async () => storedMessages);

  return {
    swarmConfig,
    message: "帮我打磨一个需求分析 Agent 的产品想法",
    conversationId: "conv-1",
    storage: { appendMessage, updateLatestAssistantMessageRole, getMessages } as unknown as IStorage,
    llmConfig: { apiKeys: {} },
    agents,
    createAgentFn: (config) => {
      agents.set(config.id, {
        agent: new FakeAgent(config.id, (input, promptIndex) => outputForAgent(config.id, input, promptIndex)) as any,
        config,
      });
    },
    emit: () => undefined,
    abort: () => undefined,
    isAborted: () => false,
    getMetadata: (key: string) => metadata.get(key),
    setMetadata: vi.fn(async (key: string, value: unknown) => {
      metadata.set(key, value);
    }),
  };
}

describe("RefineMode", () => {
  it("runs expander, critic, and final report when critic approves", async () => {
    const ctx = createContext((agentId, input, promptIndex) => {
      if (agentId.includes("critic")) return "反馈：已经足够清晰。\nAPPROVED: true";
      if (input.includes("Generate the final report")) return "最终报告：核心想法明确。";
      return `拓展版本 ${promptIndex}`;
    });

    const yielded: SwarmEvent[] = [];
    for await (const event of new RefineMode().execute(ctx)) {
      yielded.push(event);
    }

    expect(yielded.some((event) => event.type === "refine_run_start")).toBe(true);
    expect(yielded.some((event) => event.type === "refine_step_completed" && event.output?.includes("拓展版本"))).toBe(true);
    expect(yielded.some((event) => event.type === "refine_review_completed" && event.approved === true)).toBe(true);
    expect(yielded.some((event) => event.type === "refine_final_report_completed" && event.output?.includes("最终报告"))).toBe(true);
    expect(yielded.some((event) => event.type === "refine_run_end" && event.status === "completed")).toBe(true);
    expect(ctx.setMetadata).toHaveBeenCalledWith("refineResults", [
      expect.objectContaining({
        iteration: 1,
        expanded: "拓展版本 1",
        critique: "反馈：已经足够清晰。\nAPPROVED: true",
        approved: true,
      }),
    ]);
    expect((ctx.storage.appendMessage as any).mock.calls.filter(([, message]: any[]) =>
      message.role === "assistant" && message.content === "最终报告：核心想法明确。"
    )).toHaveLength(1);
    expect(ctx.storage.updateLatestAssistantMessageRole).toHaveBeenCalledWith(
      "conv-1",
      "expander__refine_expander",
      "final_report",
      { type: "refine_final_report" },
    );
  });

  it("uses only the latest previous final report as explicit refine context", async () => {
    const ctx = createContext(
      (agentId, input, promptIndex) => {
        if (agentId.includes("critic")) return "反馈：可以收敛。\nAPPROVED: true";
        if (input.includes("Generate the final report")) return "最终报告：新版本。";
        return `拓展版本 ${promptIndex}`;
      },
      [
        {
          id: "old-report",
          role: "final_report",
          content: "旧最终报告，不应该进入上下文。",
          timestamp: 100,
          createdAt: 100,
        },
        {
          id: "latest-report",
          role: "final_report",
          content: "上一轮最终报告，应该进入上下文。",
          timestamp: 200,
          createdAt: 200,
        },
      ],
    );

    const yielded: SwarmEvent[] = [];
    for await (const event of new RefineMode().execute(ctx)) {
      yielded.push(event);
    }

    const expander = ctx.agents.get("expander__refine_expander")?.agent as FakeAgent | undefined;
    const firstPrompt = expander?.prompts[0] ?? "";
    expect(yielded.some((event) =>
      event.type === "refine_run_start"
      && event.summary?.includes("上一轮最终报告"),
    )).toBe(true);
    expect(firstPrompt).toContain("Previous final report from the last completed run:");
    expect(firstPrompt).toContain("上一轮最终报告，应该进入上下文。");
    expect(firstPrompt).not.toContain("旧最终报告，不应该进入上下文。");
    expect(firstPrompt).not.toContain("Historical final reports");
  });

  it("limits fallback refineResults context to recent iterations when no final report exists", async () => {
    const ctx = createContext(
      (agentId, input, promptIndex) => {
        if (agentId.includes("critic")) return "反馈：可以收敛。\nAPPROVED: true";
        if (input.includes("Generate the final report")) return "最终报告：基于最近轮次。";
        return `拓展版本 ${promptIndex}`;
      },
      [],
      {
        refineResults: [
          { iteration: 1, expanded: "旧拓展 1", critique: "旧反馈 1", approved: false },
          { iteration: 2, expanded: "旧拓展 2", critique: "旧反馈 2", approved: false },
          { iteration: 3, expanded: "旧拓展 3", critique: "旧反馈 3", approved: false },
        ],
      },
    );

    for await (const _event of new RefineMode().execute(ctx)) {
      // consume generator
    }

    const expander = ctx.agents.get("expander__refine_expander")?.agent as FakeAgent | undefined;
    const firstPrompt = expander?.prompts[0] ?? "";
    expect(firstPrompt).not.toContain("旧拓展 1");
    expect(firstPrompt).toContain("旧拓展 2");
    expect(firstPrompt).toContain("旧拓展 3");
    expect(ctx.setMetadata).toHaveBeenCalledWith("refineResults", [
      expect.objectContaining({ iteration: 1 }),
      expect.objectContaining({ iteration: 2 }),
      expect.objectContaining({ iteration: 3 }),
      expect.objectContaining({ iteration: 1, expanded: "拓展版本 1" }),
    ]);
  });

  it("continues revision until the default iteration limit", async () => {
    const ctx = createContext((agentId, input, promptIndex) => {
      if (agentId.includes("critic")) return "还需要补齐风险与下一步。\nAPPROVED: false";
      if (input.includes("Generate the final report")) return "最终报告：基于上限收敛。";
      return `拓展版本 ${promptIndex}`;
    });

    const yielded: SwarmEvent[] = [];
    for await (const event of new RefineMode().execute(ctx)) {
      yielded.push(event);
    }

    expect(yielded.filter((event) => event.type === "refine_step_completed")).toHaveLength(3);
    expect(yielded.filter((event) => event.type === "refine_revision_requested")).toHaveLength(2);
    expect(yielded.some((event) => event.type === "refine_final_report_completed")).toBe(true);
    expect(yielded.some((event) =>
      event.type === "refine_run_end"
      && event.status === "completed"
      && event.iteration === 3,
    )).toBe(true);
  });
});
