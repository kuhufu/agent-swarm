import type { ModeExecutor, ModeExecutionContext } from "./types.js";
import type { SwarmEvent } from "../core/types.js";
import { runAgent, extractText } from "./run-agent.js";

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
        for await (const event of runAgent(agentId, message, ctx)) {
          queue.push(event);

          // Capture result
          if (event.type === "agent_end") {
            const activeAgent = agents.get(agentId);
            if (activeAgent) {
              const msgs = activeAgent.agent.state.messages;
              const lastAssistant = [...msgs].reverse().find((m: any) => m.role === "assistant");
              if (lastAssistant) {
                results.set(agentId, extractText(lastAssistant.content));
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

  private async *aggregate(
    results: Map<string, string>,
    aggregator: import("../core/types.js").AggregationStrategy,
    ctx: ModeExecutionContext,
  ): AsyncGenerator<SwarmEvent> {
    switch (aggregator.type) {
      case "none": {
        break;
      }
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
          yield* runAgent(aggregator.judgeAgent, `Select the best response from the following:\n\n${judgeInput}`, ctx);
        }
        break;
      }
      case "custom":
        // Custom aggregation handler — user must implement this
        break;
    }
  }
}
