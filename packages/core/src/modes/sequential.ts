import type { ModeExecutor, ModeExecutionContext } from "./types.js";
import type { SwarmEvent, InterventionPoint, PipelineStep } from "../core/types.js";
import type { AgentEvent as PiAgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import { messageToStored } from "../storage/message-mapper.js";

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

  private getStrategy(ctx: ModeExecutionContext, point: InterventionPoint): string {
    return ctx.swarmConfig.interventions?.[point] ?? "auto";
  }
}
