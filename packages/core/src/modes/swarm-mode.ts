import type { ModeExecutor, ModeExecutionContext } from "./types.js";
import type { SwarmEvent, InterventionPoint } from "../core/types.js";
import type { AgentEvent as PiAgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import { messageToStored } from "../storage/message-mapper.js";

/**
 * Swarm mode: agents can hand off to each other dynamically.
 * Uses `handoff` tool to transfer control between agents.
 */
export class SwarmMode implements ModeExecutor {
  async *execute(ctx: ModeExecutionContext): AsyncGenerator<SwarmEvent> {
    const { swarmConfig, message, agents, createAgentFn, isAborted, emit } = ctx;
    const orchId = swarmConfig.orchestrator?.id;
    const maxTurns = swarmConfig.maxTotalTurns ?? 10;
    let currentAgentId = orchId ?? swarmConfig.agents[0]?.id;
    let currentMessage = message;
    let turn = 0;

    // Ensure initial agent is created
    if (currentAgentId) {
      const config = swarmConfig.agents.find((a) => a.id === currentAgentId)
        ?? (swarmConfig.orchestrator?.id === currentAgentId ? swarmConfig.orchestrator : undefined);
      if (config && !agents.has(currentAgentId)) {
        createAgentFn(config);
      }
    }

    while (turn < maxTurns && !isAborted()) {
      if (!currentAgentId || !agents.has(currentAgentId)) break;

      // Check intervention
      const strategy = this.getStrategy(ctx, "before_agent_start");
      if (strategy !== "auto" && ctx.interventionCallback) {
        const decision = await ctx.interventionCallback("before_agent_start", {
          agentId: currentAgentId,
          input: currentMessage,
          turn,
        });
        if (decision?.action === "abort") {
          ctx.abort();
          break;
        }
        if (decision?.action === "reject") {
          turn++;
          continue;
        }
        if (decision?.action === "edit" && decision?.editedInput) {
          currentMessage = decision.editedInput;
        }
      }

      // Listen for handoff during agent execution
      let handoffTo: string | null = null;
      let handoffMessage: string | null = null;
      const active = agents.get(currentAgentId)!;
      const unsub = active.agent.subscribe((e: PiAgentEvent) => {
        if (e.type === "tool_execution_end" && !e.isError) {
          const result = e.result;
          if (typeof result === "object" && result?.details?.handoffTo) {
            handoffTo = result.details.handoffTo;
            if (typeof result?.details?.message === "string" && result.details.message.trim()) {
              handoffMessage = result.details.message;
            }
          }
        }
      });

      yield* this.runAgent(currentAgentId, currentMessage, ctx);
      unsub();

      // Check for handoff
      if (handoffTo) {
        // Ensure target agent is created
        const targetConfig = swarmConfig.agents.find((a) => a.id === handoffTo)
          ?? (swarmConfig.orchestrator?.id === handoffTo ? swarmConfig.orchestrator : undefined);
        if (targetConfig && !agents.has(handoffTo)) {
          createAgentFn(targetConfig);
        }

        if (agents.has(handoffTo)) {
          // Check intervention for handoff
          const handoffStrategy = this.getStrategy(ctx, "on_handoff");
          if (handoffStrategy !== "auto" && ctx.interventionCallback) {
            const decision = await ctx.interventionCallback("on_handoff", {
              fromAgentId: currentAgentId,
              toAgentId: handoffTo,
            });
            if (decision?.action === "reject" || decision?.action === "abort") {
              if (decision?.action === "abort") {
                ctx.abort();
              }
              break;
            }
          }

          emit({ type: "handoff", fromAgentId: currentAgentId, toAgentId: handoffTo });

          // Build context message from previous agent's output
          if (handoffMessage) {
            currentMessage = handoffMessage;
          } else {
            const prevAgent = agents.get(currentAgentId);
            if (prevAgent) {
              const msgs = prevAgent.agent.state.messages;
              const lastAssistant = [...msgs].reverse().find((m: any) => m.role === "assistant");
              if (lastAssistant) {
                currentMessage = this.extractText(lastAssistant.content);
              }
            }
          }

          currentAgentId = handoffTo;
        } else {
          break;
        }
      } else {
        // No handoff — agent is done responding
        break;
      }

      turn++;
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
      case "tool_execution_start": return { type: "tool_execution_start", agentId, toolName: e.toolName, toolCallId: e.toolCallId, args: e.args };
      case "tool_execution_end": return { type: "tool_execution_end", agentId, toolName: e.toolName, toolCallId: e.toolCallId, result: e.result, isError: e.isError };
      default: return null;
    }
  }

  private getStrategy(ctx: ModeExecutionContext, point: InterventionPoint): string {
    return ctx.swarmConfig.interventions?.[point] ?? "auto";
  }
}
