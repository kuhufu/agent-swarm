import type { ModeExecutor, ModeExecutionContext } from "./types.js";
import type { SwarmEvent } from "../core/types.js";
import type { AgentEvent as PiAgentEvent } from "@mariozechner/pi-agent-core";

/**
 * Debate mode: pro and con agents argue for a specified number of rounds,
 * then a judge agent summarizes and provides a final judgment.
 */
export class DebateMode implements ModeExecutor {
  async *execute(ctx: ModeExecutionContext): AsyncGenerator<SwarmEvent> {
    const { swarmConfig, message, agents, createAgentFn, isAborted } = ctx;
    const debateConfig = swarmConfig.debateConfig;
    if (!debateConfig) throw new Error("Debate mode requires debateConfig");

    const { proAgent, conAgent, judgeAgent, rounds } = debateConfig;

    // Ensure all agents are created
    for (const agentConfig of swarmConfig.agents) {
      if (!agents.has(agentConfig.id)) {
        createAgentFn(agentConfig);
      }
    }

    let currentTopic = message;

    for (let round = 0; round < rounds && !isAborted(); round++) {
      // Pro agent argues
      yield* this.runAgent(proAgent, `Round ${round + 1} - Argue IN FAVOR of: ${currentTopic}`, ctx);

      // Capture pro's argument
      const proActive = agents.get(proAgent);
      if (proActive) {
        const msgs = proActive.agent.state.messages;
        const lastAssistant = [...msgs].reverse().find((m: any) => m.role === "assistant");
        if (lastAssistant) {
          currentTopic = this.extractText(lastAssistant.content);
        }
      }

      // Con agent argues
      yield* this.runAgent(conAgent, `Round ${round + 1} - Argue AGAINST: ${currentTopic}`, ctx);

      // Capture con's argument for next round
      const conActive = agents.get(conAgent);
      if (conActive) {
        const msgs = conActive.agent.state.messages;
        const lastAssistant = [...msgs].reverse().find((m: any) => m.role === "assistant");
        if (lastAssistant) {
          currentTopic = this.extractText(lastAssistant.content);
        }
      }
    }

    // Judge agent summarizes
    yield* this.runAgent(judgeAgent, `Based on the debate above, provide your judgment and summary on: ${message}`, ctx);
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
}
