import type { ModeExecutor, ModeExecutionContext } from "./types.js";
import type { SwarmEvent } from "../core/types.js";
import type { AgentEvent as PiAgentEvent } from "@mariozechner/pi-agent-core";
import {
  buildModelFailureMessage,
  extractAssistantErrorMessage,
  extractAssistantTextAndThinking,
} from "./message-fallback.js";
import { mapAgentEvent } from "./map-agent-event.js";
import { createMessagePersistor } from "./message-persistence.js";

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
}
