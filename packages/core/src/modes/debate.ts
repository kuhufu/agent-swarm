import type { ModeExecutor, ModeExecutionContext } from "./types.js";
import type { SwarmEvent } from "../core/types.js";
import type { AgentEvent as PiAgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import { messageToStored } from "../storage/message-mapper.js";

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
    const transcript: Array<{ round: number; pro: string; con: string }> = [];

    // Ensure all agents are created
    for (const agentConfig of swarmConfig.agents) {
      if (!agents.has(agentConfig.id)) {
        createAgentFn(agentConfig);
      }
    }

    let currentTopic = message;

    for (let round = 0; round < rounds && !isAborted(); round++) {
      const roundNumber = round + 1;
      let proArgument = "";
      let conArgument = "";

      // Pro agent argues
      yield* this.runAgent(proAgent, `Round ${roundNumber} - Argue IN FAVOR of: ${currentTopic}`, ctx);

      // Capture pro's argument
      const proActive = agents.get(proAgent);
      if (proActive) {
        const msgs = proActive.agent.state.messages;
        const lastAssistant = [...msgs].reverse().find((m: any) => m.role === "assistant");
        if (lastAssistant) {
          proArgument = this.extractText(lastAssistant.content);
          currentTopic = proArgument;
        }
      }

      // Con agent argues
      yield* this.runAgent(conAgent, `Round ${roundNumber} - Argue AGAINST: ${currentTopic}`, ctx);

      // Capture con's argument for next round
      const conActive = agents.get(conAgent);
      if (conActive) {
        const msgs = conActive.agent.state.messages;
        const lastAssistant = [...msgs].reverse().find((m: any) => m.role === "assistant");
        if (lastAssistant) {
          conArgument = this.extractText(lastAssistant.content);
          currentTopic = conArgument;
        }
      }

      transcript.push({
        round: roundNumber,
        pro: proArgument,
        con: conArgument,
      });
    }

    // Judge agent summarizes
    const judgeInput = this.buildJudgeInput(message, transcript);
    yield* this.runAgent(judgeAgent, judgeInput, ctx);
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

  private buildJudgeInput(
    originalTopic: string,
    transcript: Array<{ round: number; pro: string; con: string }>,
  ): string {
    if (transcript.length === 0) {
      return `Topic: ${originalTopic}\n\nNo debate transcript was produced. Provide your judgment based on available context.`;
    }

    const roundsText = transcript
      .map((round) => [
        `Round ${round.round}:`,
        `Pro: ${round.pro || "(no response)"}`,
        `Con: ${round.con || "(no response)"}`,
      ].join("\n"))
      .join("\n\n");

    return [
      `You are the judge for this debate topic: ${originalTopic}`,
      "",
      "Debate transcript:",
      roundsText,
      "",
      "Please provide:",
      "1. A concise summary of both sides.",
      "2. Your final judgment and reasoning.",
    ].join("\n");
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
}
