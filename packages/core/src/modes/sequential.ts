import type { ModeExecutor, ModeExecutionContext } from "./types.js";
import type { SwarmEvent, PipelineStep } from "../core/types.js";
import { runAgent, extractText, getStrategy } from "./run-agent.js";

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
      const strategy = getStrategy(ctx, "before_agent_start");
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

      yield* runAgent(agentId, currentInput, ctx);

      // Get the last assistant message as input for next step
      const activeAgent = agents.get(agentId)!;
      const msgs = activeAgent.agent.state.messages;
      const lastAssistant = [...msgs].reverse().find((m: any) => m.role === "assistant");
      if (lastAssistant) {
        currentInput = extractText(lastAssistant.content);
      }

      stepIndex++;
    }
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
}
