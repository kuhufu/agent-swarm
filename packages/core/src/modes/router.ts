import type { ModeExecutor, ModeExecutionContext } from "./types.js";
import type { SwarmEvent } from "../core/types.js";

export class RouterMode implements ModeExecutor {
  async *execute(context: ModeExecutionContext): AsyncGenerator<SwarmEvent> {
    // TODO: implement Router mode orchestration
    throw new Error("Router mode not implemented yet");
  }
}
