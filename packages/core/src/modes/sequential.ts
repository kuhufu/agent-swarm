import type { ModeExecutor, ModeExecutionContext } from "./types.js";
import type { SwarmEvent } from "../core/types.js";

export class SequentialMode implements ModeExecutor {
  async *execute(context: ModeExecutionContext): AsyncGenerator<SwarmEvent> {
    // TODO: implement Sequential mode orchestration
    throw new Error("Sequential mode not implemented yet");
  }
}
