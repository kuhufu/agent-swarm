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

interface ReturnFrame {
  fromAgentId: string;
  delegateAgentId: string;
  returnToAgentId: string;
  task?: string;
  context?: string;
  expectedOutput?: string;
  reason?: string;
}

interface AgentSummary {
  agentId: string;
  agentName: string;
  summary: string;
}

interface NormalizedHandoffContextConfig {
  mode: "handoff_only" | "summary";
  maxAgentSummaries: number;
  maxSummaryChars: number;
  maxTotalChars: number;
}

/**
 * Handoff chain mode: agents run one at a time and may delegate to another
 * agent through the `handoff` tool.
 */
export class HandoffChainMode implements ModeExecutor {
  async *execute(ctx: ModeExecutionContext): AsyncGenerator<SwarmEvent> {
    const { swarmConfig, message, agents, createAgentFn, isAborted, emit } = ctx;
    const maxTurns = swarmConfig.maxTotalTurns ?? 10;
    let currentAgentId = swarmConfig.agents[0]?.id;
    let currentMessage = message;
    let turn = 0;
    const handoffHistory: HandoffProposal[] = [];
    const returnStack: ReturnFrame[] = [];
    const agentSummaries: AgentSummary[] = [];
    const contextConfig = this.normalizeHandoffContextConfig(swarmConfig.handoffContext);

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
        if (turn + 1 >= maxTurns) {
          const turnLimitError: SwarmEvent = {
            type: "error",
            agentId: currentAgentId,
            error: new Error(`Handoff chain turn limit reached before running target agent: ${handoff.toAgentId}`),
          };
          emit(turnLimitError);
          yield turnLimitError;
          break;
        }

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
          if (handoff.returnToAgentId && handoff.returnToAgentId !== handoff.toAgentId) {
            const returnConfig = swarmConfig.agents.find((agent) => agent.id === handoff.returnToAgentId);
            if (returnConfig) {
              returnStack.push({
                fromAgentId: handoff.fromAgentId,
                delegateAgentId: handoff.toAgentId,
                returnToAgentId: handoff.returnToAgentId,
                task: handoff.task,
                context: handoff.context,
                expectedOutput: handoff.expectedOutput,
                reason: handoff.reason,
              });
            }
          }
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
      } else if (returnStack.length > 0) {
        const returnFrame = returnStack.pop()!;
        if (turn + 1 >= maxTurns) {
          const turnLimitError: SwarmEvent = {
            type: "error",
            agentId: currentAgentId,
            error: new Error(`Handoff chain turn limit reached before returning to agent: ${returnFrame.returnToAgentId}`),
          };
          emit(turnLimitError);
          yield turnLimitError;
          break;
        }

        const returnConfig = swarmConfig.agents.find((agent) => agent.id === returnFrame.returnToAgentId);
        if (returnConfig && !agents.has(returnFrame.returnToAgentId)) {
          createAgentFn(returnConfig);
        }

        if (!agents.has(returnFrame.returnToAgentId)) {
          const missingReturnError: SwarmEvent = {
            type: "error",
            agentId: currentAgentId,
            error: new Error(`Return target agent not found: ${returnFrame.returnToAgentId}`),
          };
          emit(missingReturnError);
          yield missingReturnError;
          break;
        }

        const returnHandoff: HandoffProposal = {
          fromAgentId: currentAgentId,
          toAgentId: returnFrame.returnToAgentId,
          message: "Returning delegated result to the requesting agent.",
          reason: "Delegated handoff completed",
          task: returnFrame.task,
          context: returnFrame.context,
          expectedOutput: returnFrame.expectedOutput,
        };
        const loopError = this.validateHandoffLoop(returnHandoff, handoffHistory);
        if (loopError) {
          const errorEvent: SwarmEvent = {
            type: "error",
            agentId: currentAgentId,
            error: new Error(loopError),
          };
          emit(errorEvent);
          yield errorEvent;
          break;
        }

        emit({
          type: "handoff",
          fromAgentId: returnHandoff.fromAgentId,
          toAgentId: returnHandoff.toAgentId,
          reason: returnHandoff.reason,
          task: returnHandoff.task,
          context: returnHandoff.context,
          expectedOutput: returnHandoff.expectedOutput,
        });
        handoffHistory.push(returnHandoff);
        currentMessage = this.buildReturnPrompt(
          returnFrame,
          this.getLastAssistantText(currentAgentId, ctx),
          agentSummaries,
          contextConfig,
          message,
        );
        currentAgentId = returnFrame.returnToAgentId;
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
    const proposalTaskKey = this.handoffTaskKey(proposal);
    if (
      previous
      && previous.fromAgentId === proposal.toAgentId
      && previous.toAgentId === proposal.fromAgentId
      && this.handoffTaskKey(previous) === proposalTaskKey
    ) {
      return `Rejected handoff loop: ${proposal.fromAgentId} -> ${proposal.toAgentId} repeats the previous task`;
    }
    if (history.some((item) =>
      item.fromAgentId === proposal.fromAgentId
      && item.toAgentId === proposal.toAgentId
      && this.handoffTaskKey(item) === proposalTaskKey
    )) {
      return `Rejected repeated handoff: ${proposal.fromAgentId} -> ${proposal.toAgentId} already handled this task`;
    }
    const sameTaskVisits = history.filter((item) =>
      item.toAgentId === proposal.toAgentId
      && this.handoffTaskKey(item) === proposalTaskKey
    ).length;
    if (sameTaskVisits >= 2) {
      return `Rejected handoff loop: ${proposal.toAgentId} has already received this task multiple times`;
    }
    if (history.some((item) =>
      item.fromAgentId === proposal.toAgentId
      && this.handoffTaskKey(item) === proposalTaskKey
    )) {
      return `Rejected handoff loop: ${proposal.toAgentId} already delegated this task earlier in the chain`;
    }
    return null;
  }

  private handoffTaskKey(proposal: HandoffProposal): string {
    return [
      proposal.task ?? "",
      proposal.message ?? "",
      proposal.context ?? "",
      proposal.expectedOutput ?? "",
    ]
      .join("\u001f")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  private normalizeHandoffContextConfig(
    input: ModeExecutionContext["swarmConfig"]["handoffContext"],
  ): NormalizedHandoffContextConfig {
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
    config: NormalizedHandoffContextConfig,
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
    config: NormalizedHandoffContextConfig,
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
    contextConfig: NormalizedHandoffContextConfig,
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

  private buildReturnPrompt(
    frame: ReturnFrame,
    delegateOutput: string,
    summaries: AgentSummary[],
    contextConfig: NormalizedHandoffContextConfig,
    originalMessage: string,
  ): string {
    const sharedContext = this.buildSharedContextPrompt(summaries, contextConfig, originalMessage);
    const sections = [
      sharedContext,
      sharedContext ? "Current handoff return:" : "",
      `Delegated agent: ${frame.delegateAgentId}`,
      frame.task ? `Original delegated task: ${frame.task}` : "",
      frame.context ? `Original context: ${frame.context}` : "",
      frame.expectedOutput ? `Expected output: ${frame.expectedOutput}` : "",
      frame.reason ? `Original handoff reason: ${frame.reason}` : "",
      delegateOutput ? `Delegated result:\n${delegateOutput}` : "",
      "Continue from this returned result and respond to the user or hand off again only if another specialist is required.",
    ].filter((section) => section.length > 0);
    return sections.join("\n\n");
  }

  private getLastAssistantText(agentId: string, ctx: ModeExecutionContext): string {
    const active = ctx.agents.get(agentId);
    if (!active) {
      return "";
    }
    const lastAssistant = [...active.agent.state.messages]
      .reverse()
      .find((message: any) => message.role === "assistant");
    return lastAssistant ? extractText(lastAssistant.content).trim() : "";
  }

  private truncateText(input: string, maxChars: number): string {
    if (input.length <= maxChars) {
      return input;
    }
    return `${input.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
  }
}
