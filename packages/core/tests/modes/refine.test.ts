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
  const appendMessage = vi.fn(async () => undefined);
  const updateLatestAssistantMessageMetadata = vi.fn(async () => undefined);
  const getMessages = vi.fn(async () => storedMessages);

  return {
    swarmConfig,
    message: "帮我打磨一个需求分析 Agent 的产品想法",
    conversationId: "conv-1",
    storage: { appendMessage, updateLatestAssistantMessageMetadata, getMessages } as unknown as IStorage,
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
    getMetadata: () => undefined,
    setMetadata: vi.fn(async () => undefined),
  };
}

function refineMetadata(input: {
  type: "expansion" | "critique" | "final_report";
  runId?: string;
  iteration: number;
  stepId?: string;
  role: "expander" | "critic";
  approved?: boolean;
}): string {
  return JSON.stringify({
    refine: {
      runId: input.runId ?? "run-1",
      stepId: input.stepId ?? `${input.type}-${input.iteration}`,
      type: input.type,
      iteration: input.iteration,
      role: input.role,
      approved: input.approved,
    },
  });
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
    expect(ctx.setMetadata).not.toHaveBeenCalled();
    expect(ctx.storage.updateLatestAssistantMessageMetadata).toHaveBeenCalledWith(
      "conv-1",
      "expander__refine_expander",
      {
        refine: expect.objectContaining({
          type: "expansion",
          iteration: 1,
          role: "expander",
        }),
      },
    );
    expect(ctx.storage.updateLatestAssistantMessageMetadata).toHaveBeenCalledWith(
      "conv-1",
      "critic__refine_critic",
      {
        refine: expect.objectContaining({
          type: "critique",
          iteration: 1,
          role: "critic",
          approved: true,
        }),
      },
    );
    expect((ctx.storage.appendMessage as any).mock.calls.filter(([, message]: any[]) =>
      message.role === "assistant" && message.content === "最终报告：核心想法明确。"
    )).toHaveLength(1);
    expect(ctx.storage.updateLatestAssistantMessageMetadata).toHaveBeenCalledWith(
      "conv-1",
      "expander__refine_expander",
      {
        refine: expect.objectContaining({
          type: "final_report",
          iteration: 1,
          role: "expander",
        }),
      },
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
          role: "assistant",
          content: "旧最终报告，不应该进入上下文。",
          metadata: refineMetadata({ type: "final_report", iteration: 1, role: "expander" }),
          timestamp: 100,
          createdAt: 100,
        },
        {
          id: "latest-report",
          role: "assistant",
          content: "上一轮最终报告，应该进入上下文。",
          metadata: refineMetadata({ type: "final_report", iteration: 2, role: "expander" }),
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

  it("resumes with critic when latest refine message is an expansion", async () => {
    const ctx = createContext(
      (agentId, input, promptIndex) => {
        if (agentId.includes("critic")) return "反馈：扩展可用。\nAPPROVED: true";
        if (input.includes("Generate the final report")) return "最终报告：从中断扩展恢复。";
        return `不应该重新扩展 ${promptIndex}`;
      },
      [
        {
          id: "expansion-1",
          agentId: "expander__refine_expander",
          role: "assistant",
          content: "已保存的拓展版本。",
          metadata: refineMetadata({ type: "expansion", iteration: 1, role: "expander" }),
          timestamp: 100,
          createdAt: 100,
        },
      ],
    );

    for await (const _event of new RefineMode().execute(ctx)) {
      // consume generator
    }

    const expander = ctx.agents.get("expander__refine_expander")?.agent as FakeAgent | undefined;
    const critic = ctx.agents.get("critic__refine_critic")?.agent as FakeAgent | undefined;
    expect(expander?.prompts).toHaveLength(1);
    expect(expander?.prompts[0]).toContain("Generate the final report");
    expect(critic?.prompts[0]).toContain("已保存的拓展版本。");
  });

  it("resumes with next expander revision when latest critique is not approved", async () => {
    const ctx = createContext(
      (agentId, input, promptIndex) => {
        if (agentId.includes("critic")) return "反馈：修订后可用。\nAPPROVED: true";
        if (input.includes("Generate the final report")) return "最终报告：修订后收敛。";
        return `修订版本 ${promptIndex}`;
      },
      [
        {
          id: "expansion-1",
          agentId: "expander__refine_expander",
          role: "assistant",
          content: "第一轮拓展。",
          metadata: refineMetadata({ type: "expansion", iteration: 1, role: "expander" }),
          timestamp: 100,
          createdAt: 100,
        },
        {
          id: "critique-1",
          agentId: "critic__refine_critic",
          role: "assistant",
          content: "第一轮反馈：需要补齐风险。\nAPPROVED: false",
          metadata: refineMetadata({ type: "critique", iteration: 1, role: "critic", approved: false }),
          timestamp: 200,
          createdAt: 200,
        },
      ],
    );

    for await (const _event of new RefineMode().execute(ctx)) {
      // consume generator
    }

    const expander = ctx.agents.get("expander__refine_expander")?.agent as FakeAgent | undefined;
    expect(expander?.prompts[0]).toContain("This is iteration 2");
    expect(expander?.prompts[0]).toContain("第一轮拓展。");
    expect(expander?.prompts[0]).toContain("第一轮反馈：需要补齐风险。");
  });

  it("resumes with final report when latest critique is approved", async () => {
    const ctx = createContext(
      (agentId, input) => {
        if (agentId.includes("critic")) return "不应该再次审视";
        if (input.includes("Generate the final report")) return "最终报告：已通过后恢复。";
        return "不应该再次拓展";
      },
      [
        {
          id: "expansion-1",
          agentId: "expander__refine_expander",
          role: "assistant",
          content: "已通过的拓展。",
          metadata: refineMetadata({ type: "expansion", iteration: 1, role: "expander" }),
          timestamp: 100,
          createdAt: 100,
        },
        {
          id: "critique-1",
          agentId: "critic__refine_critic",
          role: "assistant",
          content: "反馈：可以收敛。\nAPPROVED: true",
          metadata: refineMetadata({ type: "critique", iteration: 1, role: "critic", approved: true }),
          timestamp: 200,
          createdAt: 200,
        },
      ],
    );

    for await (const _event of new RefineMode().execute(ctx)) {
      // consume generator
    }

    const expander = ctx.agents.get("expander__refine_expander")?.agent as FakeAgent | undefined;
    const critic = ctx.agents.get("critic__refine_critic")?.agent as FakeAgent | undefined;
    expect(critic?.prompts).toHaveLength(0);
    expect(expander?.prompts).toHaveLength(1);
    expect(expander?.prompts[0]).toContain("Generate the final report");
    expect(expander?.prompts[0]).toContain("已通过的拓展。");
    expect(expander?.prompts[0]).toContain("反馈：可以收敛。");
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
