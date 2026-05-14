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

function createContext(outputForAgent: (agentId: string, input: string, promptIndex: number) => string): ModeExecutionContext {
  const expander = createAgentConfig("expander");
  const critic = createAgentConfig("critic");
  const swarmConfig: SwarmConfig = {
    id: "refine_swarm",
    name: "Refine Swarm",
    mode: "refine",
    agents: [expander, critic],
  };
  const agents = new Map<string, { agent: any; config: SwarmAgentConfig }>();

  return {
    swarmConfig,
    message: "帮我打磨一个需求分析 Agent 的产品想法",
    conversationId: "conv-1",
    storage: { appendMessage: vi.fn(async () => undefined) } as unknown as IStorage,
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
