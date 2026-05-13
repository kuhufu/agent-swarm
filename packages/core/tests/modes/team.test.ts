import { describe, expect, it, vi } from "vitest";
import type { SwarmAgentConfig, SwarmConfig, SwarmEvent } from "../../src/core/types.js";
import type { ModeExecutionContext } from "../../src/modes/types.js";
import type { IStorage } from "../../src/storage/interface.js";
import { TeamMode } from "../../src/modes/team.js";

class FakeAgent {
  public readonly state: { messages: any[] } = { messages: [] };
  public readonly prompts: string[] = [];
  private readonly listeners: Array<(event: any) => void> = [];

  constructor(private readonly agentId: string) {}

  subscribe(listener: (event: any) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  async prompt(input: string): Promise<void> {
    this.prompts.push(input);
    const assistantText = `output from ${this.agentId}`;
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
      provider: "invalid-provider",
      modelId: "fake-model",
    },
  };
}

describe("TeamMode", () => {
  it("routes brainstorming requests into generic team roles", async () => {
    const owner = createAgentConfig("owner");
    const swarmConfig: SwarmConfig = {
      id: "team_swarm",
      name: "Team Swarm",
      mode: "team",
      agents: [owner],
    };
    const agents = new Map<string, { agent: any; config: SwarmAgentConfig }>();
    const emitted: SwarmEvent[] = [];
    const storage = {
      appendMessage: vi.fn(async () => undefined),
    } as unknown as IStorage;
    const ctx: ModeExecutionContext = {
      swarmConfig,
      message: "帮我头脑风暴一个需求分析 Agent Team 的产品方案",
      conversationId: "conv-1",
      storage,
      llmConfig: { apiKeys: {} },
      agents,
      createAgentFn: (config) => {
        agents.set(config.id, { agent: new FakeAgent(config.id) as any, config });
      },
      emit: (event) => {
        emitted.push(event);
      },
      abort: () => undefined,
      isAborted: () => false,
    };

    const mode = new TeamMode();
    const yielded: SwarmEvent[] = [];
    for await (const event of mode.execute(ctx)) {
      yielded.push(event);
    }

    expect(yielded.some((event) => event.type === "team_run_start")).toBe(true);
    expect(yielded.some((event) => event.type === "team_run_end" && event.status === "completed")).toBe(true);
    expect(yielded.filter((event) => event.type === "team_task_started")).toHaveLength(3);
    expect(yielded.filter((event) => event.type === "team_task_verification_started")).toHaveLength(1);
    expect([...agents.keys()].some((id) => id.includes("__team_ideator"))).toBe(true);
    expect([...agents.keys()].some((id) => id.includes("__team_synthesizer"))).toBe(true);
    expect(emitted.length).toBeGreaterThanOrEqual(yielded.length);
  });

  it("falls back to a single owner agent for simple requests", async () => {
    const owner = createAgentConfig("owner");
    const swarmConfig: SwarmConfig = {
      id: "team_swarm",
      name: "Team Swarm",
      mode: "team",
      agents: [owner],
    };
    const agents = new Map<string, { agent: any; config: SwarmAgentConfig }>();
    const ctx: ModeExecutionContext = {
      swarmConfig,
      message: "你好",
      conversationId: "conv-1",
      storage: {
        appendMessage: vi.fn(async () => undefined),
      } as unknown as IStorage,
      llmConfig: { apiKeys: {} },
      agents,
      createAgentFn: (config) => {
        agents.set(config.id, { agent: new FakeAgent(config.id) as any, config });
      },
      emit: () => undefined,
      abort: () => undefined,
      isAborted: () => false,
    };

    const yielded: SwarmEvent[] = [];
    for await (const event of new TeamMode().execute(ctx)) {
      yielded.push(event);
    }

    expect(yielded.some((event) => event.type === "team_run_end" && event.status === "completed")).toBe(true);
    expect(yielded.some((event) => event.type.startsWith("team_task_"))).toBe(false);
    expect([...agents.keys()]).toEqual(["owner"]);
    expect((agents.get("owner")?.agent as FakeAgent | undefined)?.prompts).toEqual(["你好"]);
  });

  it("keeps a synthesizer as the final team role when task budget is small", async () => {
    const owner = createAgentConfig("owner");
    const swarmConfig: SwarmConfig = {
      id: "team_swarm",
      name: "Team Swarm",
      mode: "team",
      agents: [owner],
      maxTotalTurns: 2,
    };
    const agents = new Map<string, { agent: any; config: SwarmAgentConfig }>();
    const ctx: ModeExecutionContext = {
      swarmConfig,
      message: "帮我头脑风暴一个需求分析 Agent Team 的产品方案",
      conversationId: "conv-1",
      storage: {
        appendMessage: vi.fn(async () => undefined),
      } as unknown as IStorage,
      llmConfig: { apiKeys: {} },
      agents,
      createAgentFn: (config) => {
        agents.set(config.id, { agent: new FakeAgent(config.id) as any, config });
      },
      emit: () => undefined,
      abort: () => undefined,
      isAborted: () => false,
    };

    const yielded: SwarmEvent[] = [];
    for await (const event of new TeamMode().execute(ctx)) {
      yielded.push(event);
    }

    const startedRoles = yielded
      .filter((event) => event.type === "team_task_started")
      .map((event) => event.role);

    expect(startedRoles).toEqual(["ideator", "synthesizer"]);
    expect([...agents.keys()].some((id) => id.includes("__team_synthesizer"))).toBe(true);
  });
});
