import type { ModeExecutor, ModeExecutionContext } from "./types.js";
import type { SwarmEvent, InterventionPoint } from "../core/types.js";
import type { AgentEvent as PiAgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import { messageToStored } from "../storage/message-mapper.js";
import {
  buildModelFailureMessage,
  extractAssistantErrorMessage,
  extractAssistantTextAndThinking,
} from "./message-fallback.js";

interface HandoffProposal {
  fromAgentId: string;
  toAgentId: string;
  message: string;
  reason?: string;
  task?: string;
  context?: string;
  expectedOutput?: string;
  returnToAgentId?: string;
}

interface HandoffResolution {
  proposal: HandoffProposal | null;
  rejected: boolean;
  errorEvent?: SwarmEvent;
}

interface AgentSummary {
  agentId: string;
  agentName: string;
  summary: string;
}

interface NormalizedSwarmContextConfig {
  mode: "handoff_only" | "summary";
  maxAgentSummaries: number;
  maxSummaryChars: number;
  maxTotalChars: number;
}

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
    const handoffHistory: HandoffProposal[] = [];
    const agentSummaries: AgentSummary[] = [];
    const contextConfig = this.normalizeSwarmContextConfig(swarmConfig.swarmContext);

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

      // Listen for handoff proposals during agent execution. A handoff is a
      // scheduler decision, not a tool side effect.
      let handoffResolution: HandoffResolution = { proposal: null, rejected: false };
      let handoffDecisionSettled = false;
      let handoffDecisionPromise: Promise<void> | null = null;
      const active = agents.get(currentAgentId)!;
      const unsub = active.agent.subscribe((e: PiAgentEvent) => {
        if (e.type === "tool_execution_end" && e.toolName === "handoff" && !e.isError) {
          const result = e.result;
          const proposal = this.extractHandoffProposal(result, currentAgentId);
          if (!handoffDecisionPromise && proposal && proposal.toAgentId !== currentAgentId) {
            handoffDecisionPromise = this.resolveHandoffProposal(ctx, proposal, handoffHistory)
              .then((resolution) => {
                handoffResolution = resolution;
                handoffDecisionSettled = true;
                if (resolution.proposal) {
                  // Once the scheduler accepts a handoff, the source agent
                  // should yield control to the target agent.
                  active.agent.abort();
                }
              })
              .catch((err) => {
                const errorEvent: SwarmEvent = {
                  type: "error",
                  agentId: proposal.fromAgentId,
                  error: err as Error,
                };
                ctx.emit(errorEvent);
                handoffResolution = { proposal: null, rejected: true, errorEvent };
                handoffDecisionSettled = true;
              });
          }
        }
      });

      yield* this.runAgent(currentAgentId, currentMessage, ctx, () => Boolean(handoffResolution.proposal));
      unsub();
      if (handoffDecisionPromise && !handoffDecisionSettled) {
        await handoffDecisionPromise;
      }
      this.collectAgentSummary(currentAgentId, ctx, agentSummaries, contextConfig);

      // Check for handoff
      if (handoffResolution.proposal) {
        const handoff = handoffResolution.proposal;
        // Ensure target agent is created
        const targetConfig = swarmConfig.agents.find((a) => a.id === handoff.toAgentId)
          ?? (swarmConfig.orchestrator?.id === handoff.toAgentId ? swarmConfig.orchestrator : undefined);
        if (targetConfig && !agents.has(handoff.toAgentId)) {
          createAgentFn(targetConfig);
        }

        if (agents.has(handoff.toAgentId)) {
          emit({
            type: "handoff",
            fromAgentId: handoff.fromAgentId,
            toAgentId: handoff.toAgentId,
            reason: handoff.reason,
            task: handoff.task,
            context: handoff.context,
            expectedOutput: handoff.expectedOutput,
            returnToAgentId: handoff.returnToAgentId,
          });

          // Build context message from previous agent's output
          const handoffPrompt = this.buildHandoffPrompt(
            handoff,
            agentSummaries,
            contextConfig,
            message,
          );
          if (handoffPrompt) {
            currentMessage = handoffPrompt;
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

          handoffHistory.push(handoff);
          currentAgentId = handoff.toAgentId;
        } else {
          const missingTargetError: SwarmEvent = {
            type: "error",
            agentId: currentAgentId,
            error: new Error(`Handoff target agent not found: ${handoff.toAgentId}`),
          };
          emit(missingTargetError);
          yield missingTargetError;
          break;
        }
      } else if (handoffResolution.rejected) {
        if (handoffResolution.errorEvent) {
          yield handoffResolution.errorEvent;
        }
        break;
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
    isExpectedAbort?: () => boolean,
  ): AsyncGenerator<SwarmEvent> {
    const active = ctx.agents.get(agentId);
    if (!active) return;

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

    const settle = () => {
      if (settled) return;
      settled = true;
      resolveDone();
    };

    const persistNewMessagesOnce = async () => {
      if (persisted) return;
      persisted = true;
      await this.persistNewMessages(ctx, agentId, agent.state.messages.slice(initialMessageCount));
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

        if (e.message.stopReason === "error" && !assistantErrorEmitted && !isExpectedAbort?.()) {
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

      const swarmEvent = this.mapAgentEvent(e, agentId, config.name);
      if (swarmEvent) {
        events.push(swarmEvent);
        ctx.emit(swarmEvent);
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

        const syntheticAgentEnd: SwarmEvent = {
          type: "agent_end",
          agentId,
          agentName: config.name,
        };
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
        if (isExpectedAbort?.()) {
          void persistNewMessagesOnce()
            .catch((persistErr) => {
              const persistenceError: SwarmEvent = { type: "error", agentId, error: persistErr as Error };
              events.push(persistenceError);
              ctx.emit(persistenceError);
            })
            .finally(() => {
              settle();
            });
          return;
        }
        const errorEvent: SwarmEvent = { type: "error", agentId, error: err as Error };
        events.push(errorEvent);
        ctx.emit(errorEvent);
        settle();
      });

    let yielded = 0;
    while (true) {
      if (ctx.isAborted()) break;
      await new Promise((r) => setTimeout(r, 10));
      while (yielded < events.length) yield events[yielded++];
      if (isExpectedAbort?.()) {
        await persistNewMessagesOnce()
          .catch((err) => {
            const persistenceError: SwarmEvent = { type: "error", agentId, error: err as Error };
            events.push(persistenceError);
            ctx.emit(persistenceError);
          });
        settle();
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

  private extractText(content: any): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
    }
    return "";
  }

  private extractHandoffProposal(result: unknown, fromAgentId: string): HandoffProposal | null {
    if (!result || typeof result !== "object") {
      return null;
    }
    const details = (result as { details?: unknown }).details;
    if (!details || typeof details !== "object") {
      return null;
    }
    const rawTarget = (details as { handoffTo?: unknown }).handoffTo;
    if (typeof rawTarget !== "string") {
      return null;
    }
    const target = rawTarget.trim();
    if (target.length === 0) {
      return null;
    }
    const readString = (key: string): string | undefined => {
      const value = (details as Record<string, unknown>)[key];
      if (typeof value !== "string") {
        return undefined;
      }
      const normalized = value.trim();
      return normalized.length > 0 ? normalized : undefined;
    };
    return {
      fromAgentId,
      toAgentId: target,
      message: readString("message") ?? "",
      reason: readString("reason"),
      task: readString("task"),
      context: readString("context"),
      expectedOutput: readString("expectedOutput"),
      returnToAgentId: readString("returnToAgentId"),
    };
  }

  private async resolveHandoffProposal(
    ctx: ModeExecutionContext,
    proposal: HandoffProposal,
    history: HandoffProposal[],
  ): Promise<HandoffResolution> {
    const loopError = this.validateHandoffLoop(proposal, history);
    if (loopError) {
      const errorEvent: SwarmEvent = {
        type: "error",
        agentId: proposal.fromAgentId,
        error: new Error(loopError),
      };
      ctx.emit(errorEvent);
      return { proposal: null, rejected: true, errorEvent };
    }

    const handoffStrategy = this.getStrategy(ctx, "on_handoff");
    if (handoffStrategy !== "auto" && ctx.interventionCallback) {
      const decision = await ctx.interventionCallback("on_handoff", {
        fromAgentId: proposal.fromAgentId,
        toAgentId: proposal.toAgentId,
        message: proposal.message,
        reason: proposal.reason,
        task: proposal.task,
        context: proposal.context,
        expectedOutput: proposal.expectedOutput,
        returnToAgentId: proposal.returnToAgentId,
      });
      if (decision?.action === "abort") {
        ctx.abort();
        return { proposal: null, rejected: true };
      }
      if (decision?.action === "reject") {
        return { proposal: null, rejected: true };
      }
      if (decision?.action === "edit" && typeof decision.editedInput === "string") {
        return {
          proposal: {
            ...proposal,
            message: decision.editedInput,
          },
          rejected: false,
        };
      }
    }

    return { proposal, rejected: false };
  }

  private validateHandoffLoop(proposal: HandoffProposal, history: HandoffProposal[]): string | null {
    const previous = history.length > 0 ? history[history.length - 1] : undefined;
    if (
      previous
      && previous.fromAgentId === proposal.toAgentId
      && previous.toAgentId === proposal.fromAgentId
      && this.handoffTaskKey(previous) === this.handoffTaskKey(proposal)
    ) {
      return `Rejected handoff loop: ${proposal.fromAgentId} -> ${proposal.toAgentId} repeats the previous task`;
    }
    return null;
  }

  private handoffTaskKey(proposal: HandoffProposal): string {
    return [
      proposal.task ?? "",
      proposal.message ?? "",
      proposal.context ?? "",
      proposal.expectedOutput ?? "",
    ].join("\u001f");
  }

  private normalizeSwarmContextConfig(
    input: ModeExecutionContext["swarmConfig"]["swarmContext"],
  ): NormalizedSwarmContextConfig {
    return {
      mode: input?.mode ?? "summary",
      maxAgentSummaries: input?.maxAgentSummaries ?? 6,
      maxSummaryChars: input?.maxSummaryChars ?? 1000,
      maxTotalChars: input?.maxTotalChars ?? 4000,
    };
  }

  private collectAgentSummary(
    agentId: string,
    ctx: ModeExecutionContext,
    summaries: AgentSummary[],
    config: NormalizedSwarmContextConfig,
  ) {
    if (config.mode !== "summary") {
      return;
    }
    const active = ctx.agents.get(agentId);
    if (!active) {
      return;
    }
    const lastAssistant = [...active.agent.state.messages]
      .reverse()
      .find((message: any) => message.role === "assistant");
    if (!lastAssistant) {
      return;
    }
    const text = this.extractText(lastAssistant.content).trim();
    if (!text) {
      return;
    }
    const existingIndex = summaries.findIndex((summary) => summary.agentId === agentId);
    const nextSummary: AgentSummary = {
      agentId,
      agentName: active.config.name,
      summary: this.truncateText(text, config.maxSummaryChars),
    };
    if (existingIndex >= 0) {
      summaries.splice(existingIndex, 1);
    }
    summaries.push(nextSummary);
    while (summaries.length > config.maxAgentSummaries) {
      summaries.shift();
    }
  }

  private buildSharedContextPrompt(
    summaries: AgentSummary[],
    config: NormalizedSwarmContextConfig,
    originalMessage: string,
  ): string {
    if (config.mode !== "summary" || summaries.length === 0) {
      return "";
    }
    const lines = [
      "Original user request:",
      this.truncateText(originalMessage, Math.min(config.maxSummaryChars, 1000)),
      "",
      "Shared swarm context:",
      ...summaries.map((item) => `- ${item.agentName} (${item.agentId}): ${item.summary}`),
    ];
    return this.truncateText(lines.join("\n"), config.maxTotalChars);
  }

  private buildHandoffPrompt(
    proposal: HandoffProposal,
    summaries: AgentSummary[],
    contextConfig: NormalizedSwarmContextConfig,
    originalMessage: string,
  ): string {
    const sharedContext = this.buildSharedContextPrompt(summaries, contextConfig, originalMessage);
    const sections = [
      sharedContext,
      sharedContext ? "Current handoff:" : "",
      proposal.task ? `Task: ${proposal.task}` : "",
      proposal.context ? `Context: ${proposal.context}` : "",
      proposal.expectedOutput ? `Expected output: ${proposal.expectedOutput}` : "",
      proposal.reason ? `Reason for handoff: ${proposal.reason}` : "",
      proposal.returnToAgentId ? `Return to agent: ${proposal.returnToAgentId}` : "",
      proposal.message ? `Message: ${proposal.message}` : "",
    ].filter((section) => section.length > 0);
    return sections.join("\n\n");
  }

  private truncateText(input: string, maxChars: number): string {
    if (input.length <= maxChars) {
      return input;
    }
    return `${input.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
  }

  private mapAgentEvent(e: PiAgentEvent, agentId: string, agentName: string): SwarmEvent | null {
    switch (e.type) {
      case "agent_start": return { type: "agent_start", agentId, agentName };
      case "agent_end": return { type: "agent_end", agentId, agentName };
      case "turn_start": return { type: "turn_start", agentId, turn: 0 };
      case "turn_end": return { type: "turn_end", agentId, turn: 0 };
      case "message_start": return { type: "message_start", agentId, agentName, role: e.message.role };
      case "message_update":
        if (e.assistantMessageEvent.type === "text_delta") {
          return { type: "message_update", agentId, delta: e.assistantMessageEvent.delta };
        }
        if (e.assistantMessageEvent.type === "thinking_delta") {
          return { type: "message_update", agentId, thinkingDelta: e.assistantMessageEvent.delta };
        }
        return null;
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
