import type { BeforeToolCallResult, AfterToolCallResult } from "@mariozechner/pi-agent-core";
import type { InterventionPoint, SwarmAgentConfig, SwarmConfig, InterventionCallback, SwarmEvent } from "../types.js";
import type { InterventionHandler } from "../../intervention/handler.js";
import type { ConversationEventBus } from "./event-bus.js";

export class InterventionOrchestrator {
  private swarmConfig: SwarmConfig;
  private interventionHandler?: InterventionHandler;
  private interventionCallback?: InterventionCallback;

  constructor(swarmConfig: SwarmConfig, eventBus: ConversationEventBus) {
    this.swarmConfig = swarmConfig;
    eventBus.onEvent((event) => this.handleEventIntervention(event));
  }

  setHandler(handler?: InterventionHandler): void {
    this.interventionHandler = handler;
  }

  setCallback(callback?: InterventionCallback): void {
    this.interventionCallback = callback;
  }

  get handler(): InterventionHandler | undefined {
    return this.interventionHandler;
  }

  get callback(): InterventionCallback | undefined {
    return this.interventionCallback;
  }

  getStrategy(point: InterventionPoint, config?: SwarmAgentConfig): string {
    return config?.interventions?.[point]
      ?? this.swarmConfig.interventions?.[point]
      ?? "auto";
  }

  createBeforeToolCallHook(
    config: SwarmAgentConfig,
    abortFn: () => void,
  ): (ctx: { toolCall: { name: string }; args: unknown }) => Promise<BeforeToolCallResult | undefined> {
    return async (toolContext) => {
      let point: InterventionPoint = "before_tool_call";
      let strategy = this.getStrategy(point, config);
      if (strategy === "auto") {
        point = "on_approval_required";
        strategy = this.getStrategy(point, config);
      }
      if (strategy === "auto") return undefined;

      const decision = await this.request(point, {
        agentId: config.id,
        toolName: toolContext.toolCall.name,
        arguments: toolContext.args,
      });
      if (decision?.action === "abort") {
        abortFn();
        return { block: true, reason: decision.reason ?? "Tool call aborted by intervention" };
      }
      if (decision?.action === "reject") {
        return { block: true, reason: decision.reason ?? "Tool call rejected by intervention" };
      }
      return undefined;
    };
  }

  createAfterToolCallHook(
    config: SwarmAgentConfig,
    abortFn: () => void,
  ): (ctx: { toolCall: { name: string }; args: unknown; result: unknown }) => Promise<AfterToolCallResult | undefined> {
    return async (toolContext) => {
      const strategy = this.getStrategy("after_tool_call", config);
      if (strategy === "auto") return undefined;
      const decision = await this.request("after_tool_call", {
        agentId: config.id,
        toolName: toolContext.toolCall.name,
        arguments: toolContext.args,
        result: toolContext.result,
      });
      if (decision?.action === "abort") {
        abortFn();
        return {
          isError: true,
          content: [{ type: "text", text: decision.reason ?? "Tool result aborted by intervention" }],
        };
      }
      if (decision?.action === "reject") {
        return {
          isError: true,
          content: [{ type: "text", text: decision.reason ?? "Tool result rejected by intervention" }],
        };
      }
      return undefined;
    };
  }

  private handleEventIntervention(event: SwarmEvent): void {
    if (event.type === "error") {
      const strategy = this.getStrategy("on_error");
      if (strategy !== "auto") {
        void this.request("on_error", {
          agentId: event.agentId,
          error: event.error,
        }).catch(() => {});
      }
    }
    if (event.type === "agent_end") {
      const strategy = this.getStrategy("after_agent_end");
      if (strategy !== "auto") {
        void this.request("after_agent_end", {
          agentId: event.agentId,
        }).catch(() => {});
      }
    }
  }

  private async request(point: InterventionPoint, context: any): Promise<any> {
    if (this.interventionCallback) {
      return this.interventionCallback(point, context);
    }
    if (this.interventionHandler) {
      return this.interventionHandler.onIntervention(point, context);
    }
    return { action: "approve" };
  }
}
