import type { ModeExecutor, ModeExecutionContext } from "./types.js";
import type { SwarmEvent } from "../core/types.js";

export class ParallelMode implements ModeExecutor {
  async *execute(context: ModeExecutionContext): AsyncGenerator<SwarmEvent> {
    // TODO: implement Parallel mode orchestration
    throw new Error("Parallel mode not implemented yet");
  }
}
