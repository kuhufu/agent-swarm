import type { ModeExecutor, ModeExecutionContext } from "./types.js";
import type { SwarmEvent } from "../core/types.js";
import type { AgentEvent as PiAgentEvent } from "@mariozechner/pi-agent-core";
import { runAgent, extractText, getStrategy } from "./run-agent.js";

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
    const maxTurns = swarmConfig.maxTotalTurns ?? 10;
    let currentAgentId = swarmConfig.agents[0]?.id;
    let currentMessage = message;
    let turn = 0;
    const handoffHistory: HandoffProposal[] = [];
    const agentSummaries: AgentSummary[] = [];
    const contextConfig = this.normalizeSwarmContextConfig(swarmConfig.swarmContext);

    // Ensure initial agent is created
    if (currentAgentId) {
      const config = swarmConfig.agents.find((a) => a.id === currentAgentId);
      if (config && !agents.has(currentAgentId)) {
        createAgentFn(config);
      }
    }

    while (turn < maxTurns && !isAborted()) {
      if (!currentAgentId || !agents.has(currentAgentId)) break;

      // Check intervention
      const strategy = getStrategy(ctx, "before_agent_start");
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

      yield* runAgent(currentAgentId, currentMessage, ctx, { isExpectedAbort: () => Boolean(handoffResolution.proposal) });
      unsub();
      if (handoffDecisionPromise && !handoffDecisionSettled) {
        await handoffDecisionPromise;
      }
      this.collectAgentSummary(currentAgentId, ctx, agentSummaries, contextConfig);

      // Check for handoff
      if (handoffResolution.proposal) {
        const handoff = handoffResolution.proposal;
        // Ensure target agent is created
        const targetConfig = swarmConfig.agents.find((a) => a.id === handoff.toAgentId);
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
                currentMessage = extractText(lastAssistant.content);
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

    const handoffStrategy = getStrategy(ctx, "on_handoff");
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
    const text = extractText(lastAssistant.content).trim();
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
}
