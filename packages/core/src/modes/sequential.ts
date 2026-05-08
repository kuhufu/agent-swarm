import type { ModeExecutor, ModeExecutionContext } from "./types.js";
import type { SwarmEvent, InterventionPoint, PipelineStep } from "../core/types.js";
import type { AgentEvent as PiAgentEvent } from "@mariozechner/pi-agent-core";
import { mapAgentEvent } from "./map-agent-event.js";
import {
  buildModelFailureMessage,
  extractAssistantErrorMessage,
  extractAssistantTextAndThinking,
} from "./message-fallback.js";
import { createMessagePersistor } from "./message-persistence.js";

/**
 * Sequential mode: agents are run one after another in pipeline order.
 * Each agent's output becomes the next agent's input.
 */
export class SequentialMode implements ModeExecutor {
  async *execute(ctx: ModeExecutionContext): AsyncGenerator<SwarmEvent> {
    const { swarmConfig, message, agents, createAgentFn, isAborted } = ctx;
    const pipeline: PipelineStep[] = swarmConfig.pipeline ?? swarmConfig.agents.map((a) => ({ agentId: a.id }));
    const stepIndexByAgentId = new Map<string, number>(pipeline.map((step, index) => [step.agentId, index]));

    let currentInput = message;
    let stepIndex = 0;

    while (stepIndex < pipeline.length) {
      if (isAborted()) break;

      const step = pipeline[stepIndex];
      const agentId = step.agentId;
      const agentConfig = swarmConfig.agents.find((a) => a.id === agentId);
      if (!agentConfig) {
        stepIndex++;
        continue;
      }

      if (step.condition && !this.evaluateCondition(step.condition, currentInput)) {
        if (step.onSkip && stepIndexByAgentId.has(step.onSkip)) {
          const target = stepIndexByAgentId.get(step.onSkip)!;
          stepIndex = target > stepIndex ? target : stepIndex + 1;
        } else {
          stepIndex++;
        }
        continue;
      }

      // Ensure agent is created
      if (!agents.has(agentId)) {
        createAgentFn(agentConfig);
      }

      if (step.transform) {
        currentInput = this.applyTransform(step.transform, currentInput);
      }

      // Check intervention
      const strategy = this.getStrategy(ctx, "before_agent_start");
      if (strategy !== "auto" && ctx.interventionCallback) {
        const decision = await ctx.interventionCallback("before_agent_start", {
          agentId,
          input: currentInput,
        });
        if (decision?.action === "abort") {
          ctx.abort();
          break;
        }
        if (decision?.action === "reject") {
          stepIndex++;
          continue;
        }
        if (decision?.action === "edit" && decision?.editedInput) {
          currentInput = decision.editedInput;
        }
      }

      yield* this.runAgent(agentId, currentInput, ctx);

      // Get the last assistant message as input for next step
      const activeAgent = agents.get(agentId)!;
      const msgs = activeAgent.agent.state.messages;
      const lastAssistant = [...msgs].reverse().find((m: any) => m.role === "assistant");
      if (lastAssistant) {
        currentInput = this.extractText(lastAssistant.content);
      }

      stepIndex++;
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

  private evaluateCondition(condition: Record<string, any>, input: string): boolean {
    if (typeof condition.equals === "string") {
      return input === condition.equals;
    }
    if (typeof condition.notEquals === "string") {
      return input !== condition.notEquals;
    }
    if (typeof condition.contains === "string") {
      return input.includes(condition.contains);
    }
    if (typeof condition.regex === "string") {
      try {
        return new RegExp(condition.regex).test(input);
      } catch {
        return false;
      }
    }
    if (typeof condition.minLength === "number") {
      return input.length >= condition.minLength;
    }
    if (typeof condition.maxLength === "number") {
      return input.length <= condition.maxLength;
    }
    return true;
  }

  private applyTransform(transform: Record<string, any>, input: string): string {
    let output = input;

    if (typeof transform.prepend === "string") {
      output = transform.prepend + output;
    }
    if (typeof transform.append === "string") {
      output = output + transform.append;
    }
    if (typeof transform.template === "string") {
      output = transform.template.replaceAll("{{input}}", output);
    }
    if (transform.trim === true) {
      output = output.trim();
    }
    if (transform.replace && typeof transform.replace.from === "string") {
      const from = transform.replace.from;
      const to = typeof transform.replace.to === "string" ? transform.replace.to : "";
      output = transform.replace.all === true
        ? output.split(from).join(to)
        : output.replace(from, to);
    }

    return output;
  }

  private extractText(content: any): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
    }
    return "";
  }

  private getStrategy(ctx: ModeExecutionContext, point: InterventionPoint): string {
    return ctx.swarmConfig.interventions?.[point] ?? "auto";
  }
}
