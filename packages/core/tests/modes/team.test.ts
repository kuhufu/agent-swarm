import { describe, expect, it, vi } from "vitest";
import type { SwarmAgentConfig, SwarmConfig, SwarmEvent } from "../../src/core/types.js";
import type { ModeExecutionContext } from "../../src/modes/types.js";
import type { IStorage } from "../../src/storage/interface.js";
import { TeamMode } from "../../src/modes/team.js";

class FakeAgent {
  public readonly state: { messages: any[] } = { messages: [] };
  public readonly prompts: string[] = [];
  private readonly listeners: Array<(event: any) => void> = [];

  constructor(
    private readonly agentId: string,
    private readonly outputText = `output from ${agentId}`,
  ) {}

  subscribe(listener: (event: any) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  async prompt(input: string): Promise<void> {
    this.prompts.push(input);
    const assistantText = this.outputText;
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

  it("routes landing-plan requests into requirements analysis roles", async () => {
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
      message: "这个 Agent Team 应该如何落地，帮我做路线图",
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

    expect(yielded.some((event) => event.type === "team_task_started" && event.role === "analyst")).toBe(true);
    expect(yielded.some((event) => event.type === "team_task_verification_started" && event.role === "critic")).toBe(true);
    expect(yielded.some((event) => event.type === "team_task_started" && event.role === "synthesizer")).toBe(true);
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
    const runUpdates = yielded.filter((event) => event.type === "team_run_update");
    const runEnd = yielded.find((event) => event.type === "team_run_end");

    expect(startedRoles).toEqual(["ideator", "synthesizer"]);
    expect(runUpdates.some((event) => event.summary?.includes("因任务预算限制"))).toBe(true);
    expect(runUpdates.some((event) => event.summary?.includes("批判审视角色"))).toBe(true);
    expect(runEnd?.summary).toContain("本次未做独立审视");
    expect([...agents.keys()].some((id) => id.includes("__team_synthesizer"))).toBe(true);
  });

  it("marks critic verification as failed when blockers are reported", async () => {
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
      message: "帮我做一个需求分析方案",
      conversationId: "conv-1",
      storage: {
        appendMessage: vi.fn(async () => undefined),
      } as unknown as IStorage,
      llmConfig: { apiKeys: {} },
      agents,
      createAgentFn: (config) => {
        const output = config.id.includes("__team_critic")
          ? "Blocker: 当前需求缺少目标用户和验收标准。"
          : `output from ${config.id}`;
        agents.set(config.id, { agent: new FakeAgent(config.id, output) as any, config });
      },
      emit: () => undefined,
      abort: () => undefined,
      isAborted: () => false,
    };

    const yielded: SwarmEvent[] = [];
    for await (const event of new TeamMode().execute(ctx)) {
      yielded.push(event);
    }

    const failedVerification = yielded.find((event) => event.type === "team_task_verification_failed");
    const runEnd = yielded.find((event) => event.type === "team_run_end");
    expect(failedVerification?.role).toBe("critic");
    expect(failedVerification?.status).toBe("failed");
    expect(failedVerification?.issues?.[0]).toContain("Blocker");
    expect(runEnd?.summary).toContain("阻塞风险");
    expect(yielded.some((event) => event.type === "team_task_started" && event.role === "synthesizer")).toBe(true);
  });

  it("does not fail critic verification for explicit no-blocker output", async () => {
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
      message: "帮我做一个需求分析方案",
      conversationId: "conv-1",
      storage: {
        appendMessage: vi.fn(async () => undefined),
      } as unknown as IStorage,
      llmConfig: { apiKeys: {} },
      agents,
      createAgentFn: (config) => {
        const output = config.id.includes("__team_critic")
          ? "No blockers. 只有轻微风险，可以继续推进。"
          : `output from ${config.id}`;
        agents.set(config.id, { agent: new FakeAgent(config.id, output) as any, config });
      },
      emit: () => undefined,
      abort: () => undefined,
      isAborted: () => false,
    };

    const yielded: SwarmEvent[] = [];
    for await (const event of new TeamMode().execute(ctx)) {
      yielded.push(event);
    }

    expect(yielded.some((event) => event.type === "team_task_verification_failed")).toBe(false);
    expect(yielded.some((event) => event.type === "team_task_verification_passed" && event.role === "critic")).toBe(true);
  });
});
