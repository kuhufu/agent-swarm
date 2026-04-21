import type { ModeExecutor, ModeExecutionContext } from "./types.js";
import type { SwarmEvent } from "../core/types.js";
import type { AgentEvent as PiAgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import { messageToStored } from "../storage/message-mapper.js";

/**
 * Parallel mode: all agents run simultaneously on the same input.
 * Results can be aggregated using different strategies (merge, vote, best, custom).
 */
export class ParallelMode implements ModeExecutor {
  async *execute(ctx: ModeExecutionContext): AsyncGenerator<SwarmEvent> {
    const { swarmConfig, message, agents, createAgentFn, isAborted } = ctx;
    const agentIds = swarmConfig.agents.map((a) => a.id);

    // Ensure all agents are created
    for (const agentConfig of swarmConfig.agents) {
      if (!agents.has(agentConfig.id)) {
        createAgentFn(agentConfig);
      }
    }

    // Run all agents concurrently and collect their events
    const eventQueues: Map<string, SwarmEvent[]> = new Map();
    const doneAgents: Set<string> = new Set();
    const results: Map<string, string> = new Map();

    // Start all agents
    const agentPromises = agentIds.map(async (agentId) => {
      const queue: SwarmEvent[] = [];
      eventQueues.set(agentId, queue);

      try {
        for await (const event of this.runAgent(agentId, message, ctx)) {
          queue.push(event);

          // Capture result
          if (event.type === "agent_end") {
            const activeAgent = agents.get(agentId);
            if (activeAgent) {
              const msgs = activeAgent.agent.state.messages;
              const lastAssistant = [...msgs].reverse().find((m: any) => m.role === "assistant");
              if (lastAssistant) {
                results.set(agentId, this.extractText(lastAssistant.content));
              }
            }
          }
        }
      } finally {
        doneAgents.add(agentId);
      }
    });

    // Yield events as they come from all agents
    const allPromises = Promise.all(agentPromises);
    const yieldedCounts: Map<string, number> = new Map(agentIds.map((id) => [id, 0]));

    while (doneAgents.size < agentIds.length && !isAborted()) {
      await new Promise((r) => setTimeout(r, 20));

      for (const agentId of agentIds) {
        const queue = eventQueues.get(agentId) ?? [];
        let yielded = yieldedCounts.get(agentId) ?? 0;
        if (yielded < queue.length) {
          yield queue[yielded];
          yielded += 1;
          yieldedCounts.set(agentId, yielded);
        }
      }
    }

    await allPromises;

    // Drain remaining events
    for (const agentId of agentIds) {
      const queue = eventQueues.get(agentId) ?? [];
      const yielded = yieldedCounts.get(agentId) ?? 0;
      for (let i = yielded; i < queue.length; i++) {
        yield queue[i];
      }
    }

    // Apply aggregation strategy
    const aggregator = swarmConfig.aggregator;
    if (aggregator) {
      const aggregated = this.aggregate(results, aggregator, ctx);
      if (aggregated) {
        yield* aggregated;
      }
    }
  }

  private async *runAgent(
    agentId: string,
    input: string,
    ctx: ModeExecutionContext,
  ): AsyncGenerator<SwarmEvent> {
    const active = ctx.agents.get(agentId);
    if (!active) return;

    const { agent, config } = active;
    const events: SwarmEvent[] = [];
    const initialMessageCount = agent.state.messages.length;

    let resolveDone: () => void;
    const donePromise = new Promise<void>((r) => { resolveDone = r; });

    const unsub = agent.subscribe((e: PiAgentEvent) => {
      const swarmEvent = this.mapAgentEvent(e, agentId, config.name);
      if (swarmEvent) {
        events.push(swarmEvent);
        ctx.emit(swarmEvent);
      }
      if (e.type === "agent_end") {
        void this.persistNewMessages(ctx, agentId, agent.state.messages.slice(initialMessageCount))
          .catch((err) => {
            const persistenceError: SwarmEvent = { type: "error", agentId, error: err as Error };
            events.push(persistenceError);
            ctx.emit(persistenceError);
          });
        resolveDone();
      }
    });

    agent.prompt(input).catch((err) => {
      events.push({ type: "error", agentId, error: err as Error });
      resolveDone();
    });

    let yielded = 0;
    while (true) {
      if (ctx.isAborted()) break;
      await new Promise((r) => setTimeout(r, 10));
      while (yielded < events.length) yield events[yielded++];
      const race = await Promise.race([
        donePromise.then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 50)),
      ]);
      if (race) {
        while (yielded < events.length) yield events[yielded++];
        break;
      }
    }
    unsub();
  }

  private async persistNewMessages(
    ctx: ModeExecutionContext,
    agentId: string,
    newMessages: AgentMessage[],
  ): Promise<void> {
    for (const message of newMessages) {
      if (!this.isPersistablePiMessage(message) || message.role === "user") {
        continue;
      }
      await ctx.storage.appendMessage(
        ctx.conversationId,
        messageToStored(message, agentId),
      );
    }
  }

  private isPersistablePiMessage(message: AgentMessage): message is Message {
    return typeof message === "object"
      && message !== null
      && "role" in message
      && (message.role === "user" || message.role === "assistant" || message.role === "toolResult");
  }

  private async *aggregate(
    results: Map<string, string>,
    aggregator: import("../core/types.js").AggregationStrategy,
    ctx: ModeExecutionContext,
  ): AsyncGenerator<SwarmEvent> {
    switch (aggregator.type) {
      case "merge": {
        // Merge all results into a single message
        const merged = Array.from(results.entries())
          .map(([id, text]) => {
            const cfg = ctx.swarmConfig.agents.find((a) => a.id === id);
            return `## ${cfg?.name ?? id}\n\n${text}`;
          })
          .join("\n\n---\n\n");
        ctx.emit({ type: "message_start", agentId: "__aggregator", agentName: "Aggregator", role: "assistant" });
        yield { type: "message_update", agentId: "__aggregator", delta: merged };
        yield { type: "message_end", agentId: "__aggregator", agentName: "Aggregator", role: "assistant" };
        break;
      }
      case "vote": {
        // Simple voting: count non-empty results
        const validResults = Array.from(results.values()).filter(Boolean);
        if (validResults.length >= aggregator.quorum) {
          ctx.emit({ type: "message_start", agentId: "__aggregator", agentName: "Aggregator", role: "assistant" });
          yield { type: "message_update", agentId: "__aggregator", delta: `共识达成（${validResults.length}/${results.size} 同意）` };
          yield { type: "message_end", agentId: "__aggregator", agentName: "Aggregator", role: "assistant" };
        } else {
          yield { type: "error", error: new Error(`Quorum not reached: ${validResults.length}/${aggregator.quorum}`) };
        }
        break;
      }
      case "best": {
        // Use judge agent to pick the best result
        if (ctx.agents.has(aggregator.judgeAgent)) {
          const judgeInput = Array.from(results.entries())
            .map(([id, text]) => `Agent ${id}: ${text}`)
            .join("\n\n");
          yield* this.runAgent(aggregator.judgeAgent, `Select the best response from the following:\n\n${judgeInput}`, ctx);
        }
        break;
      }
      case "custom":
        // Custom aggregation handler — user must implement this
        break;
    }
  }

  private extractText(content: any): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
    }
    return "";
  }

  private mapAgentEvent(e: PiAgentEvent, agentId: string, agentName: string): SwarmEvent | null {
    switch (e.type) {
      case "agent_start": return { type: "agent_start", agentId, agentName };
      case "agent_end": return { type: "agent_end", agentId, agentName };
      case "turn_start": return { type: "turn_start", agentId, turn: 0 };
      case "turn_end": return { type: "turn_end", agentId, turn: 0 };
      case "message_start": return { type: "message_start", agentId, agentName, role: e.message.role };
      case "message_update":
        if (e.assistantMessageEvent.type !== "text_delta") return null;
        return { type: "message_update", agentId, delta: e.assistantMessageEvent.delta };
      case "message_end": return { type: "message_end", agentId, agentName, role: e.message.role };
      case "tool_execution_start": return { type: "tool_execution_start", agentId, toolName: e.toolName, toolCallId: e.toolCallId };
      case "tool_execution_end": return { type: "tool_execution_end", agentId, toolName: e.toolName, toolCallId: e.toolCallId, isError: e.isError };
      default: return null;
    }
  }
}
