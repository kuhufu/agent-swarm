import type { ModeExecutor, ModeExecutionContext } from "./types.js";
import type { SwarmEvent } from "../core/types.js";

export class DebateMode implements ModeExecutor {
  async *execute(context: ModeExecutionContext): AsyncGenerator<SwarmEvent> {
    // TODO: implement Debate mode orchestration
    throw new Error("Debate mode not implemented yet");
  }
}
