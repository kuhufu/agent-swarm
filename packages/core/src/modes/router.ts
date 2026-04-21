import type { ModeExecutor, ModeExecutionContext } from "./types.js";
import type { SwarmEvent, InterventionPoint } from "../core/types.js";
import type { AgentEvent as PiAgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import { messageToStored } from "../storage/message-mapper.js";

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

  private mapAgentEvent(e: PiAgentEvent, agentId: string, agentName: string): SwarmEvent | null {
    switch (e.type) {
      case "agent_start":
        return { type: "agent_start", agentId, agentName };
      case "agent_end":
        return { type: "agent_end", agentId, agentName };
      case "turn_start":
        return { type: "turn_start", agentId, turn: 0 };
      case "turn_end":
        return { type: "turn_end", agentId, turn: 0 };
      case "message_start":
        return { type: "message_start", agentId, agentName, role: e.message.role };
      case "message_update":
        return {
          type: "message_update",
          agentId,
          delta: e.assistantMessageEvent.type === "text_delta" ? e.assistantMessageEvent.delta : undefined,
        };
      case "message_end":
        return { type: "message_end", agentId, agentName, role: e.message.role };
      case "tool_execution_start":
        return { type: "tool_execution_start", agentId, toolName: e.toolName, toolCallId: e.toolCallId };
      case "tool_execution_end":
        return { type: "tool_execution_end", agentId, toolName: e.toolName, toolCallId: e.toolCallId, isError: e.isError };
      default:
        return null;
    }
  }

  private getStrategy(ctx: ModeExecutionContext, point: InterventionPoint): string {
    return ctx.swarmConfig.interventions?.[point] ?? "auto";
  }
}
