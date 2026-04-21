import type { ModeExecutor, ModeExecutionContext } from "./types.js";
import type { SwarmEvent, InterventionPoint, PipelineStep } from "../core/types.js";
import type { AgentEvent as PiAgentEvent } from "@mariozechner/pi-agent-core";

/**
 * Sequential mode: agents are run one after another in pipeline order.
 * Each agent's output becomes the next agent's input.
 */
export class SequentialMode implements ModeExecutor {
  async *execute(ctx: ModeExecutionContext): AsyncGenerator<SwarmEvent> {
    const { swarmConfig, message, agents, createAgentFn, isAborted } = ctx;
    const pipeline: PipelineStep[] = swarmConfig.pipeline ?? swarmConfig.agents.map((a) => ({ agentId: a.id }));
    let currentInput = message;

    for (const step of pipeline) {
      if (isAborted()) break;

      const agentId = step.agentId;
      const agentConfig = swarmConfig.agents.find((a) => a.id === agentId);
      if (!agentConfig) continue;

      // Ensure agent is created
      if (!agents.has(agentId)) {
        createAgentFn(agentConfig);
      }

      // Check intervention
      const strategy = this.getStrategy(ctx, "before_agent_start");
      if (strategy !== "auto" && ctx.interventionCallback) {
        const decision = await ctx.interventionCallback("before_agent_start", {
          agentId,
          input: currentInput,
        });
        if (decision?.action === "abort") break;
        if (decision?.action === "reject") continue;
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

      // Apply transform if defined (transform is a JSON expression for future evaluation)
      // Currently transforms are not supported in the serializable PipelineStep
      // if (step.transform) { currentInput = step.transform(currentInput); }

      // Check condition (condition is a JSON expression for future evaluation)
      // Currently conditions are not supported in the serializable PipelineStep
      if (step.onSkip) {
        // Skip to the specified step if condition would fail
        continue;
      }
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
    let resolveDone: () => void;
    const donePromise = new Promise<void>((r) => { resolveDone = r; });

    const unsub = agent.subscribe((e: PiAgentEvent) => {
      const swarmEvent = this.mapAgentEvent(e, agentId, config.name);
      if (swarmEvent) {
        events.push(swarmEvent);
        ctx.emit(swarmEvent);
      }
      if (e.type === "agent_end") resolveDone();
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
      case "message_start": return { type: "message_start", agentId, role: e.message.role };
      case "message_update": return { type: "message_update", agentId, delta: e.assistantMessageEvent.type === "text_delta" ? e.assistantMessageEvent.delta : undefined };
      case "message_end": return { type: "message_end", agentId, role: e.message.role };
      case "tool_execution_start": return { type: "tool_execution_start", agentId, toolName: e.toolName, toolCallId: e.toolCallId };
      case "tool_execution_end": return { type: "tool_execution_end", agentId, toolName: e.toolName, toolCallId: e.toolCallId, isError: e.isError };
      default: return null;
    }
  }

  private getStrategy(ctx: ModeExecutionContext, point: InterventionPoint): string {
    return ctx.swarmConfig.interventions?.[point] ?? "auto";
  }
}
