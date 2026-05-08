import type { ModeExecutor, ModeExecutionContext } from "./types.js";
import type { SwarmEvent } from "../core/types.js";
import type { AgentEvent as PiAgentEvent } from "@mariozechner/pi-agent-core";
import { runAgent, getStrategy } from "./run-agent.js";

/**
 * Router mode: an orchestrator agent decides which specialist agent to route to.
 * The orchestrator uses the `route_to_agent` tool to make its decision.
 */
export class RouterMode implements ModeExecutor {
  async *execute(ctx: ModeExecutionContext): AsyncGenerator<SwarmEvent> {
    const { swarmConfig, message, agents, createAgentFn, emit } = ctx;
    const orchId = swarmConfig.orchestrator?.id;
    if (!orchId) throw new Error("Router mode requires an orchestrator agent");

    // Ensure orchestrator agent is created
    if (!agents.has(orchId)) {
      createAgentFn(swarmConfig.orchestrator!);
    }

    const orchActive = agents.get(orchId)!;
    let routedAgentId: string | null = null;
    let routedMessage = message;

    // Subscribe to detect routing decisions
    const unsub = orchActive.agent.subscribe((e: PiAgentEvent) => {
      if (e.type === "tool_execution_end" && !e.isError) {
        const result = e.result;
        if (typeof result === "object" && result?.details?.routedTo) {
          routedAgentId = result.details.routedTo;
          if (typeof result?.details?.message === "string" && result.details.message.trim()) {
            routedMessage = result.details.message;
          }
        }
      }
    });

    // Run orchestrator
    yield* runAgent(orchId, message, ctx);
    unsub();

    // Check intervention for handoff
    if (routedAgentId) {
      if (!agents.has(routedAgentId)) {
        const targetConfig = swarmConfig.agents.find((agent) => agent.id === routedAgentId);
        if (targetConfig) {
          createAgentFn(targetConfig);
        }
      }
      if (!agents.has(routedAgentId)) {
        yield { type: "error", error: new Error(`Routed agent not found: ${routedAgentId}`) };
        return;
      }

      const strategy = getStrategy(ctx, "on_handoff");
      if (strategy !== "auto" && ctx.interventionCallback) {
        const decision = await ctx.interventionCallback("on_handoff", {
          fromAgentId: orchId,
          toAgentId: routedAgentId,
          reason: "Router decision",
        });
        if (decision?.action === "reject" || decision?.action === "abort") {
          if (decision?.action === "abort") {
            ctx.abort();
          }
          return;
        }
      }

      emit({ type: "handoff", fromAgentId: orchId, toAgentId: routedAgentId, reason: "Router decision" });

      // Run the routed agent
      yield* runAgent(routedAgentId, routedMessage, ctx);
    }
  }
}
