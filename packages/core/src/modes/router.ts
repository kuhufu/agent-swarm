import type { ModeExecutor, ModeExecutionContext } from "./types.js";
import type { SwarmEvent, InterventionPoint } from "../core/types.js";
import type { AgentEvent as PiAgentEvent } from "@mariozechner/pi-agent-core";
import {
  buildModelFailureMessage,
  extractAssistantErrorMessage,
  extractAssistantTextAndThinking,
} from "./message-fallback.js";
import { mapAgentEvent } from "./map-agent-event.js";
import { createMessagePersistor } from "./message-persistence.js";

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
    yield* this.runAgent(orchId, message, ctx);
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

      const strategy = this.getStrategy(ctx, "on_handoff");
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
      yield* this.runAgent(routedAgentId, routedMessage, ctx);
    }
  }

  private async *runAgent(
    agentId: string,
    input: string,
    ctx: ModeExecutionContext,
  ): AsyncGenerator<SwarmEvent> {
    const active = ctx.agents.get(agentId);
    if (!active) throw new Error(`Agent not found: ${agentId}`);

    const { agent, config } = active;
    const events: SwarmEvent[] = [];
    const initialMessageCount = agent.state.messages.length;
    let assistantHasStreamDelta = false;
    let assistantErrorEmitted = false;
    let agentEnded = false;
    let persisted = false;
    let settled = false;

    let resolveDone: () => void;
    const donePromise = new Promise<void>((r) => { resolveDone = r; });
    const { persistPendingMessages } = createMessagePersistor(
      ctx,
      agentId,
      initialMessageCount,
      () => agent.state.messages,
    );

    const settle = () => {
      if (settled) return;
      settled = true;
      resolveDone();
    };

    const persistNewMessagesOnce = async () => {
      if (persisted) return;
      persisted = true;
      await persistPendingMessages();
    };

    const unsub = agent.subscribe((e: PiAgentEvent) => {
      if (e.type === "message_start" && e.message.role === "assistant") {
        assistantHasStreamDelta = false;
        assistantErrorEmitted = false;
      }

      if (
        e.type === "message_update"
        && (e.assistantMessageEvent.type === "text_delta" || e.assistantMessageEvent.type === "thinking_delta")
      ) {
        assistantHasStreamDelta = true;
      }

      if (e.type === "message_end" && e.message.role === "assistant" && !assistantHasStreamDelta) {
        const fallback = extractAssistantTextAndThinking(e.message.content);
        if (fallback.thinking.trim().length > 0) {
          const thinkingEvent: SwarmEvent = {
            type: "message_update",
            agentId,
            thinkingDelta: fallback.thinking,
          };
          events.push(thinkingEvent);
          ctx.emit(thinkingEvent);
        }
        if (fallback.text.trim().length > 0) {
          const textEvent: SwarmEvent = {
            type: "message_update",
            agentId,
            delta: fallback.text,
          };
          events.push(textEvent);
          ctx.emit(textEvent);
        }

        if (e.message.stopReason === "error" && !assistantErrorEmitted) {
          assistantErrorEmitted = true;
          const assistantErrorMessage = extractAssistantErrorMessage(e.message);
          const errorEvent: SwarmEvent = {
            type: "error",
            agentId,
            error: new Error(
              buildModelFailureMessage(
                config.model.provider,
                config.model.modelId,
                assistantErrorMessage,
                agent.state.errorMessage,
              ),
            ),
          };
          events.push(errorEvent);
          ctx.emit(errorEvent);
        }
      }

      const swarmEvent = mapAgentEvent(e, agentId, config.name);
      if (swarmEvent) {
        events.push(swarmEvent);
        ctx.emit(swarmEvent);
      }
      if (e.type === "turn_end") {
        void persistPendingMessages().catch((err) => {
          const persistenceError: SwarmEvent = { type: "error", agentId, error: err as Error };
          events.push(persistenceError);
          ctx.emit(persistenceError);
        });
      }
      if (e.type === "agent_end") {
        agentEnded = true;
        void persistNewMessagesOnce()
          .catch((err) => {
            const persistenceError: SwarmEvent = { type: "error", agentId, error: err as Error };
            events.push(persistenceError);
            ctx.emit(persistenceError);
          })
          .finally(() => {
            settle();
          });
      }
    });

    agent.prompt(input)
      .then(() => {
        if (agentEnded) {
          settle();
          return;
        }
        const syntheticAgentEnd: SwarmEvent = { type: "agent_end", agentId, agentName: config.name };
        events.push(syntheticAgentEnd);
        ctx.emit(syntheticAgentEnd);
        void persistNewMessagesOnce()
          .catch((err) => {
            const persistenceError: SwarmEvent = { type: "error", agentId, error: err as Error };
            events.push(persistenceError);
            ctx.emit(persistenceError);
          })
          .finally(() => {
            settle();
          });
      })
      .catch((err) => {
        events.push({ type: "error", agentId, error: err as Error });
        settle();
      });

    // Yield events as they arrive
    let yielded = 0;
    while (true) {
      if (ctx.isAborted()) break;
      await new Promise((r) => setTimeout(r, 10));
      while (yielded < events.length) {
        yield events[yielded++];
      }
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

  private getStrategy(ctx: ModeExecutionContext, point: InterventionPoint): string {
    return ctx.swarmConfig.interventions?.[point] ?? "auto";
  }
}
