import type { ModeExecutor, ModeExecutionContext } from "./types.js";
import type { SwarmEvent } from "../core/types.js";
import { runAgent, extractText } from "./run-agent.js";

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
      yield* runAgent(proAgent, `Round ${roundNumber} - Argue IN FAVOR of: ${currentTopic}`, ctx);

      // Capture pro's argument
      const proActive = agents.get(proAgent);
      if (proActive) {
        const msgs = proActive.agent.state.messages;
        const lastAssistant = [...msgs].reverse().find((m: any) => m.role === "assistant");
        if (lastAssistant) {
          proArgument = extractText(lastAssistant.content);
          currentTopic = proArgument;
        }
      }

      // Con agent argues
      yield* runAgent(conAgent, `Round ${roundNumber} - Argue AGAINST: ${currentTopic}`, ctx);

      // Capture con's argument for next round
      const conActive = agents.get(conAgent);
      if (conActive) {
        const msgs = conActive.agent.state.messages;
        const lastAssistant = [...msgs].reverse().find((m: any) => m.role === "assistant");
        if (lastAssistant) {
          conArgument = extractText(lastAssistant.content);
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
    yield* runAgent(judgeAgent, judgeInput, ctx);
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
