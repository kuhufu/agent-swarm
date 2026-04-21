import { describe, it, expect, vi } from "vitest";
import type { SwarmConfig, SwarmAgentConfig } from "../core/types.js";
import type { ModeExecutionContext } from "./types.js";
import type { IStorage } from "../storage/interface.js";
import { DebateMode } from "./debate.js";

class FakeAgent {
  public readonly state: { messages: any[] } = { messages: [] };
  private readonly listeners: Array<(event: any) => void> = [];
  public readonly prompts: string[] = [];

  constructor(private readonly responder: (input: string) => string) {}

  subscribe(listener: (event: any) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  async prompt(input: string): Promise<void> {
    this.prompts.push(input);
    this.state.messages.push({
      role: "user",
      content: input,
      timestamp: Date.now(),
    });
    const assistantText = this.responder(input);
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
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });

    this.emit({ type: "agent_start" });
    this.emit({ type: "message_start", message: { role: "assistant" } });
    this.emit({ type: "message_end", message: { role: "assistant" } });
    this.emit({ type: "agent_end" });
  }

  abort(): void {}

  private emit(event: any): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

function createAgentConfig(id: string): SwarmAgentConfig {
  return {
    id,
    name: id,
    description: `${id} description`,
    systemPrompt: `${id} system`,
    model: {
      provider: "openai",
      modelId: "gpt-4o-mini",
    },
  };
}

describe("DebateMode", () => {
  it("includes both pro and con transcript in judge prompt", async () => {
    const proAgentId = "pro";
    const conAgentId = "con";
    const judgeAgentId = "judge";

    const configs = [
      createAgentConfig(proAgentId),
      createAgentConfig(conAgentId),
      createAgentConfig(judgeAgentId),
    ];

    const swarmConfig: SwarmConfig = {
      id: "debate_swarm",
      name: "Debate Swarm",
      mode: "debate",
      agents: configs,
      debateConfig: {
        proAgent: proAgentId,
        conAgent: conAgentId,
        judgeAgent: judgeAgentId,
        rounds: 1,
      },
    };

    const proFake = new FakeAgent(() => "正方观点：甜豆腐脑更温和顺口。");
    const conFake = new FakeAgent(() => "反方观点：咸豆腐脑层次更丰富。");
    const judgeFake = new FakeAgent(() => "裁判结论");

    const agents = new Map<string, { agent: any; config: SwarmAgentConfig }>([
      [proAgentId, { agent: proFake as any, config: configs[0] }],
      [conAgentId, { agent: conFake as any, config: configs[1] }],
      [judgeAgentId, { agent: judgeFake as any, config: configs[2] }],
    ]);

    const storage = {
      appendMessage: vi.fn(async () => undefined),
    } as unknown as IStorage;

    const ctx: ModeExecutionContext = {
      swarmConfig,
      message: "甜豆腐脑 vs 咸豆腐脑",
      conversationId: "conv-1",
      storage,
      llmConfig: {
        defaultProvider: "openai",
        defaultModel: "gpt-4o-mini",
        apiKeys: {},
      },
      agents,
      createAgentFn: () => undefined,
      emit: () => undefined,
      abort: () => undefined,
      isAborted: () => false,
    };

    const mode = new DebateMode();
    for await (const _event of mode.execute(ctx)) {
      // consume stream
    }

    expect(judgeFake.prompts).toHaveLength(1);
    expect(judgeFake.prompts[0]).toContain("Debate transcript:");
    expect(judgeFake.prompts[0]).toContain("Pro: 正方观点：甜豆腐脑更温和顺口。");
    expect(judgeFake.prompts[0]).toContain("Con: 反方观点：咸豆腐脑层次更丰富。");
  });
});
