import { describe, it, expect, vi } from "vitest";
import type { SwarmConfig, SwarmAgentConfig, SwarmEvent } from "../core/types.js";
import type { ModeExecutionContext } from "./types.js";
import type { IStorage } from "../storage/interface.js";
import { SwarmMode } from "./swarm-mode.js";

interface FakeAgentOptions {
  assistantText: string;
  handoffTo?: string;
  handoffMessage?: string;
  handoffDetails?: Record<string, unknown>;
  handoffToolName?: string;
  skipAgentEnd?: boolean;
}

class FakeAgent {
  public readonly state: { messages: any[] } = { messages: [] };
  public readonly prompts: string[] = [];
  private readonly listeners: Array<(event: any) => void> = [];
  private readonly options: FakeAgentOptions;

  constructor(options: FakeAgentOptions) {
    this.options = options;
  }

  subscribe(listener: (event: any) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    };
  }

  async prompt(input: string): Promise<void> {
    this.prompts.push(input);
    this.state.messages.push({
      role: "user",
      content: input,
      timestamp: Date.now(),
    });
    this.state.messages.push({
      role: "assistant",
      content: [{ type: "text", text: this.options.assistantText }],
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

    if (this.options.handoffTo) {
      const toolName = this.options.handoffToolName ?? "handoff";
      this.emit({
        type: "tool_execution_start",
        toolName,
        toolCallId: "handoff-call",
        args: {
          agentId: this.options.handoffTo,
          message: this.options.handoffMessage ?? "",
        },
      });
      this.emit({
        type: "tool_execution_end",
        toolName,
        toolCallId: "handoff-call",
        args: {
          agentId: this.options.handoffTo,
          message: this.options.handoffMessage ?? "",
        },
        result: {
          details: {
            handoffTo: this.options.handoffTo,
            message: this.options.handoffMessage ?? "",
            ...(this.options.handoffDetails ?? {}),
          },
        },
        isError: false,
      });
    }

    this.emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: this.options.assistantText }],
        stopReason: "stop",
      },
    });
    if (!this.options.skipAgentEnd) {
      this.emit({ type: "agent_end" });
    }
  }

  abort(): void {}

  private emit(event: any): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

class HangingHandoffAgent {
  public readonly state: { messages: any[] } = { messages: [] };
  public readonly prompts: string[] = [];
  public aborted = false;
  private readonly listeners: Array<(event: any) => void> = [];
  private readonly handoffTo: string;
  private readonly handoffMessage: string;
  private resolvePrompt: (() => void) | null = null;

  constructor(handoffTo: string, handoffMessage: string) {
    this.handoffTo = handoffTo;
    this.handoffMessage = handoffMessage;
  }

  subscribe(listener: (event: any) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    };
  }

  async prompt(input: string): Promise<void> {
    this.prompts.push(input);
    this.state.messages.push({
      role: "user",
      content: input,
      timestamp: Date.now(),
    });
    this.state.messages.push({
      role: "assistant",
      content: [{ type: "text", text: "handoff then hang" }],
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
      type: "tool_execution_start",
      toolName: "handoff",
      toolCallId: "handoff-call",
      args: {
        agentId: this.handoffTo,
        message: this.handoffMessage,
      },
    });
    this.emit({
      type: "tool_execution_end",
      toolName: "handoff",
      toolCallId: "handoff-call",
      args: {
        agentId: this.handoffTo,
        message: this.handoffMessage,
      },
      result: {
        details: {
          handoffTo: this.handoffTo,
          message: this.handoffMessage,
        },
      },
      isError: false,
    });

    return new Promise<void>((resolve) => {
      this.resolvePrompt = resolve;
    });
  }

  abort(): void {
    this.aborted = true;
    if (this.resolvePrompt) {
      const resolve = this.resolvePrompt;
      this.resolvePrompt = null;
      resolve();
    }
  }

  private emit(event: any): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

class ContinueAfterHandoffAgent {
  public readonly state: { messages: any[] } = { messages: [] };
  public readonly prompts: string[] = [];
  public aborted = false;
  private readonly listeners: Array<(event: any) => void> = [];
  private readonly handoffTo: string;

  constructor(handoffTo: string) {
    this.handoffTo = handoffTo;
  }

  subscribe(listener: (event: any) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    };
  }

  async prompt(input: string): Promise<void> {
    this.prompts.push(input);
    this.emit({ type: "agent_start" });
    this.emit({ type: "message_start", message: { role: "assistant" } });
    this.emit({
      type: "tool_execution_end",
      toolName: "handoff",
      toolCallId: "handoff-call",
      result: {
        details: {
          handoffTo: this.handoffTo,
          message: "try handoff",
        },
      },
      isError: false,
    });
    this.state.messages.push({
      role: "assistant",
      content: [{ type: "text", text: "continued locally" }],
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
    this.emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "continued locally" }],
        stopReason: "stop",
      },
    });
    this.emit({ type: "agent_end" });
  }

  abort(): void {
    this.aborted = true;
  }

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

function createStorageMock(): IStorage {
  return {
    appendMessage: vi.fn(async () => undefined),
  } as unknown as IStorage;
}

describe("SwarmMode", () => {
  it("ignores self handoff and does not re-run the same agent", async () => {
    const firstAgentId = "agent-a";
    const secondAgentId = "agent-b";
    const configs = [createAgentConfig(firstAgentId), createAgentConfig(secondAgentId)];

    const firstAgent = new FakeAgent({
      assistantText: "first",
      handoffTo: firstAgentId,
      handoffMessage: "handoff to self",
    });
    const secondAgent = new FakeAgent({ assistantText: "second" });

    const agents = new Map<string, { agent: any; config: SwarmAgentConfig }>([
      [firstAgentId, { agent: firstAgent as any, config: configs[0] }],
      [secondAgentId, { agent: secondAgent as any, config: configs[1] }],
    ]);

    const emittedEvents: SwarmEvent[] = [];
    const ctx: ModeExecutionContext = {
      swarmConfig: {
        id: "swarm-self-handoff",
        name: "swarm-self-handoff",
        mode: "swarm",
        agents: configs,
        maxTotalTurns: 5,
      } as SwarmConfig,
      message: "start",
      conversationId: "conv-1",
      storage: createStorageMock(),
      llmConfig: { apiKeys: {} },
      agents,
      createAgentFn: () => undefined,
      emit: (event) => { emittedEvents.push(event); },
      abort: () => undefined,
      isAborted: () => false,
    };

    const mode = new SwarmMode();
    for await (const _event of mode.execute(ctx)) {
      // consume stream
    }

    expect(firstAgent.prompts).toHaveLength(1);
    expect(secondAgent.prompts).toHaveLength(0);
    expect(emittedEvents.some((event) => event.type === "handoff")).toBe(false);
  });

  it("emits error when handoff target does not exist", async () => {
    const firstAgentId = "agent-a";
    const configs = [createAgentConfig(firstAgentId)];

    const firstAgent = new FakeAgent({
      assistantText: "first",
      handoffTo: "missing-agent",
      handoffMessage: "handoff to missing",
    });

    const agents = new Map<string, { agent: any; config: SwarmAgentConfig }>([
      [firstAgentId, { agent: firstAgent as any, config: configs[0] }],
    ]);

    const emittedEvents: SwarmEvent[] = [];
    const yieldedEvents: SwarmEvent[] = [];
    const ctx: ModeExecutionContext = {
      swarmConfig: {
        id: "swarm-missing-handoff",
        name: "swarm-missing-handoff",
        mode: "swarm",
        agents: configs,
        maxTotalTurns: 5,
      } as SwarmConfig,
      message: "start",
      conversationId: "conv-1",
      storage: createStorageMock(),
      llmConfig: { apiKeys: {} },
      agents,
      createAgentFn: () => undefined,
      emit: (event) => { emittedEvents.push(event); },
      abort: () => undefined,
      isAborted: () => false,
    };

    const mode = new SwarmMode();
    for await (const event of mode.execute(ctx)) {
      yieldedEvents.push(event);
    }

    const emittedError = emittedEvents.find((event) => event.type === "error");
    const yieldedError = yieldedEvents.find((event) => event.type === "error");
    expect(emittedError?.type).toBe("error");
    expect(yieldedError?.type).toBe("error");
    if (emittedError?.type === "error") {
      expect(emittedError.error.message).toContain("missing-agent");
    }
  });

  it("continues handoff when source agent prompt resolves without agent_end event", async () => {
    const firstAgentId = "agent-a";
    const secondAgentId = "agent-b";
    const configs = [createAgentConfig(firstAgentId), createAgentConfig(secondAgentId)];

    const firstAgent = new FakeAgent({
      assistantText: "first",
      handoffTo: secondAgentId,
      handoffMessage: "go next",
      skipAgentEnd: true,
    });
    const secondAgent = new FakeAgent({
      assistantText: "second",
    });

    const agents = new Map<string, { agent: any; config: SwarmAgentConfig }>([
      [firstAgentId, { agent: firstAgent as any, config: configs[0] }],
      [secondAgentId, { agent: secondAgent as any, config: configs[1] }],
    ]);

    const emittedEvents: SwarmEvent[] = [];
    const yieldedEvents: SwarmEvent[] = [];
    const ctx: ModeExecutionContext = {
      swarmConfig: {
        id: "swarm-no-agent-end",
        name: "swarm-no-agent-end",
        mode: "swarm",
        agents: configs,
        maxTotalTurns: 5,
      } as SwarmConfig,
      message: "start",
      conversationId: "conv-1",
      storage: createStorageMock(),
      llmConfig: { apiKeys: {} },
      agents,
      createAgentFn: () => undefined,
      emit: (event) => { emittedEvents.push(event); },
      abort: () => undefined,
      isAborted: () => false,
    };

    const mode = new SwarmMode();
    for await (const event of mode.execute(ctx)) {
      yieldedEvents.push(event);
    }

    expect(firstAgent.prompts).toHaveLength(1);
    expect(secondAgent.prompts).toHaveLength(1);
    expect(
      emittedEvents.some((event) =>
        event.type === "handoff"
        && event.fromAgentId === firstAgentId
        && event.toAgentId === secondAgentId),
    ).toBe(true);
  });

  it("does not treat non-handoff tool details as a handoff", async () => {
    const firstAgentId = "agent-a";
    const secondAgentId = "agent-b";
    const configs = [createAgentConfig(firstAgentId), createAgentConfig(secondAgentId)];

    const firstAgent = new FakeAgent({
      assistantText: "first",
      handoffTo: secondAgentId,
      handoffMessage: "not actually handoff",
      handoffToolName: "custom_tool",
    });
    const secondAgent = new FakeAgent({ assistantText: "second" });

    const agents = new Map<string, { agent: any; config: SwarmAgentConfig }>([
      [firstAgentId, { agent: firstAgent as any, config: configs[0] }],
      [secondAgentId, { agent: secondAgent as any, config: configs[1] }],
    ]);

    const emittedEvents: SwarmEvent[] = [];
    const ctx: ModeExecutionContext = {
      swarmConfig: {
        id: "swarm-non-handoff-tool",
        name: "swarm-non-handoff-tool",
        mode: "swarm",
        agents: configs,
        maxTotalTurns: 5,
      } as SwarmConfig,
      message: "start",
      conversationId: "conv-1",
      storage: createStorageMock(),
      llmConfig: { apiKeys: {} },
      agents,
      createAgentFn: () => undefined,
      emit: (event) => { emittedEvents.push(event); },
      abort: () => undefined,
      isAborted: () => false,
    };

    const mode = new SwarmMode();
    for await (const _event of mode.execute(ctx)) {
      // consume stream
    }

    expect(firstAgent.prompts).toHaveLength(1);
    expect(secondAgent.prompts).toHaveLength(0);
    expect(emittedEvents.some((event) => event.type === "handoff")).toBe(false);
  });

  it("does not abort source agent when handoff intervention rejects", async () => {
    const firstAgentId = "agent-a";
    const secondAgentId = "agent-b";
    const configs = [createAgentConfig(firstAgentId), createAgentConfig(secondAgentId)];

    const firstAgent = new ContinueAfterHandoffAgent(secondAgentId);
    const secondAgent = new FakeAgent({ assistantText: "second" });

    const agents = new Map<string, { agent: any; config: SwarmAgentConfig }>([
      [firstAgentId, { agent: firstAgent as any, config: configs[0] }],
      [secondAgentId, { agent: secondAgent as any, config: configs[1] }],
    ]);

    const emittedEvents: SwarmEvent[] = [];
    const ctx: ModeExecutionContext = {
      swarmConfig: {
        id: "swarm-reject-handoff",
        name: "swarm-reject-handoff",
        mode: "swarm",
        agents: configs,
        maxTotalTurns: 5,
        interventions: { on_handoff: "confirm" },
      } as SwarmConfig,
      message: "start",
      conversationId: "conv-1",
      storage: createStorageMock(),
      llmConfig: { apiKeys: {} },
      agents,
      createAgentFn: () => undefined,
      emit: (event) => { emittedEvents.push(event); },
      abort: () => undefined,
      isAborted: () => false,
      interventionCallback: async () => ({ action: "reject" }),
    };

    const mode = new SwarmMode();
    for await (const _event of mode.execute(ctx)) {
      // consume stream
    }

    expect(firstAgent.aborted).toBe(false);
    expect(secondAgent.prompts).toHaveLength(0);
    expect(emittedEvents.some((event) => event.type === "handoff")).toBe(false);
  });

  it("passes structured handoff context to the target agent and event", async () => {
    const firstAgentId = "agent-a";
    const secondAgentId = "agent-b";
    const configs = [createAgentConfig(firstAgentId), createAgentConfig(secondAgentId)];

    const firstAgent = new FakeAgent({
      assistantText: "first",
      handoffTo: secondAgentId,
      handoffMessage: "legacy message",
      handoffDetails: {
        reason: "needs specialist",
        task: "review the plan",
        context: "the user wants stronger swarm behavior",
        expectedOutput: "actionable review",
        returnToAgentId: firstAgentId,
      },
    });
    const secondAgent = new FakeAgent({ assistantText: "second" });

    const agents = new Map<string, { agent: any; config: SwarmAgentConfig }>([
      [firstAgentId, { agent: firstAgent as any, config: configs[0] }],
      [secondAgentId, { agent: secondAgent as any, config: configs[1] }],
    ]);

    const emittedEvents: SwarmEvent[] = [];
    const ctx: ModeExecutionContext = {
      swarmConfig: {
        id: "swarm-structured-handoff",
        name: "swarm-structured-handoff",
        mode: "swarm",
        agents: configs,
        maxTotalTurns: 5,
      } as SwarmConfig,
      message: "start",
      conversationId: "conv-1",
      storage: createStorageMock(),
      llmConfig: { apiKeys: {} },
      agents,
      createAgentFn: () => undefined,
      emit: (event) => { emittedEvents.push(event); },
      abort: () => undefined,
      isAborted: () => false,
    };

    const mode = new SwarmMode();
    for await (const _event of mode.execute(ctx)) {
      // consume stream
    }

    const handoffEvent = emittedEvents.find((event) => event.type === "handoff");
    expect(handoffEvent).toMatchObject({
      type: "handoff",
      fromAgentId: firstAgentId,
      toAgentId: secondAgentId,
      reason: "needs specialist",
      task: "review the plan",
      context: "the user wants stronger swarm behavior",
      expectedOutput: "actionable review",
      returnToAgentId: firstAgentId,
    });
    expect(secondAgent.prompts[0]).toContain("Task: review the plan");
    expect(secondAgent.prompts[0]).toContain("Context: the user wants stronger swarm behavior");
    expect(secondAgent.prompts[0]).toContain("Message: legacy message");
  });

  it("rejects immediate reverse handoff loops for the same task", async () => {
    const firstAgentId = "agent-a";
    const secondAgentId = "agent-b";
    const configs = [createAgentConfig(firstAgentId), createAgentConfig(secondAgentId)];

    const firstAgent = new FakeAgent({
      assistantText: "first",
      handoffTo: secondAgentId,
      handoffMessage: "same task",
    });
    const secondAgent = new FakeAgent({
      assistantText: "second",
      handoffTo: firstAgentId,
      handoffMessage: "same task",
    });

    const agents = new Map<string, { agent: any; config: SwarmAgentConfig }>([
      [firstAgentId, { agent: firstAgent as any, config: configs[0] }],
      [secondAgentId, { agent: secondAgent as any, config: configs[1] }],
    ]);

    const emittedEvents: SwarmEvent[] = [];
    const yieldedEvents: SwarmEvent[] = [];
    const ctx: ModeExecutionContext = {
      swarmConfig: {
        id: "swarm-loop-guard",
        name: "swarm-loop-guard",
        mode: "swarm",
        agents: configs,
        maxTotalTurns: 5,
      } as SwarmConfig,
      message: "start",
      conversationId: "conv-1",
      storage: createStorageMock(),
      llmConfig: { apiKeys: {} },
      agents,
      createAgentFn: () => undefined,
      emit: (event) => { emittedEvents.push(event); },
      abort: () => undefined,
      isAborted: () => false,
    };

    const mode = new SwarmMode();
    for await (const event of mode.execute(ctx)) {
      yieldedEvents.push(event);
    }

    expect(firstAgent.prompts).toHaveLength(1);
    expect(secondAgent.prompts).toHaveLength(1);
    expect(emittedEvents.filter((event) => event.type === "handoff")).toHaveLength(1);
    const loopError = yieldedEvents.find((event) => event.type === "error");
    expect(loopError?.type).toBe("error");
    if (loopError?.type === "error") {
      expect(loopError.error.message).toContain("Rejected handoff loop");
    }
  });

  it("aborts current agent immediately after handoff and runs next agent", async () => {
    const firstAgentId = "agent-a";
    const secondAgentId = "agent-b";
    const configs = [createAgentConfig(firstAgentId), createAgentConfig(secondAgentId)];

    const firstAgent = new HangingHandoffAgent(secondAgentId, "go next");
    const secondAgent = new FakeAgent({ assistantText: "second" });

    const agents = new Map<string, { agent: any; config: SwarmAgentConfig }>([
      [firstAgentId, { agent: firstAgent as any, config: configs[0] }],
      [secondAgentId, { agent: secondAgent as any, config: configs[1] }],
    ]);

    const ctx: ModeExecutionContext = {
      swarmConfig: {
        id: "swarm-handoff-abort-source",
        name: "swarm-handoff-abort-source",
        mode: "swarm",
        agents: configs,
        maxTotalTurns: 5,
      } as SwarmConfig,
      message: "start",
      conversationId: "conv-1",
      storage: createStorageMock(),
      llmConfig: { apiKeys: {} },
      agents,
      createAgentFn: () => undefined,
      emit: () => undefined,
      abort: () => undefined,
      isAborted: () => false,
    };

    const mode = new SwarmMode();
    await Promise.race([
      (async () => {
        for await (const _event of mode.execute(ctx)) {
          // consume stream
        }
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("swarm-mode timeout")), 1000)),
    ]);

    expect(firstAgent.aborted).toBe(true);
    expect(secondAgent.prompts).toHaveLength(1);
  });
});
