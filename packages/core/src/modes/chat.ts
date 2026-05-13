import type { ModeExecutor, ModeExecutionContext } from "./types.js";
import type { SwarmEvent } from "../core/types.js";
import { runAgent } from "./run-agent.js";

export class ChatMode implements ModeExecutor {
  async *execute(ctx: ModeExecutionContext): AsyncGenerator<SwarmEvent> {
    const { swarmConfig, message, agents, createAgentFn, isAborted } = ctx;
    const agentConfig = swarmConfig.agents[0];
    if (!agentConfig) return;
    if (isAborted()) return;

    if (!agents.has(agentConfig.id)) {
      createAgentFn(agentConfig);
    }

    yield* runAgent(agentConfig.id, message, ctx);
  }
}
