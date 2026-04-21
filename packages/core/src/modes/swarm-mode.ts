import type { ModeExecutor, ModeExecutionContext } from "./types.js";
import type { SwarmEvent } from "../core/types.js";

export class SwarmMode implements ModeExecutor {
  async *execute(context: ModeExecutionContext): AsyncGenerator<SwarmEvent> {
    // TODO: implement Swarm mode orchestration
    throw new Error("Swarm mode not implemented yet");
  }
}
