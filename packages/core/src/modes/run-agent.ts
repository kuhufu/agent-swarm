import type { ModeExecutionContext } from "./types.js";
import type { SwarmEvent } from "../core/types.js";
import type { AgentEvent as PiAgentEvent } from "@mariozechner/pi-agent-core";
import {
  buildModelFailureMessage,
  extractAssistantErrorMessage,
  extractAssistantTextAndThinking,
} from "./message-fallback.js";
import { mapAgentEvent } from "./map-agent-event.js";
import { createMessagePersistor } from "./message-persistence.js";

export interface RunAgentOptions {
  /** Called to determine if the agent's abort is expected (suppresses error events) */
  isExpectedAbort?: () => boolean;
  /** Poll interval in ms for the event loop (default: 10) */
  pollIntervalMs?: number;
}

/**
 * Runs a single agent and yields SwarmEvents.
 * Handles event mapping, message persistence, fallback for non-streaming responses,
 * and synthetic agent_end when the agent prompt resolves without emitting agent_end.
 */
export async function* runAgent(
  agentId: string,
  input: string,
  ctx: ModeExecutionContext,
  options: RunAgentOptions = {},
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
  const { isExpectedAbort, pollIntervalMs = 10 } = options;

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

      if (e.message.stopReason === "error" && !assistantErrorEmitted && !isExpectedAbort?.()) {
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

      const syntheticAgentEnd: SwarmEvent = {
        type: "agent_end",
        agentId,
        agentName: config.name,
      };
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
      if (isExpectedAbort?.()) {
        void persistNewMessagesOnce()
          .catch((persistErr) => {
            const persistenceError: SwarmEvent = { type: "error", agentId, error: persistErr as Error };
            events.push(persistenceError);
            ctx.emit(persistenceError);
          })
          .finally(() => {
            settle();
          });
        return;
      }
      const errorEvent: SwarmEvent = { type: "error", agentId, error: err as Error };
      events.push(errorEvent);
      ctx.emit(errorEvent);
      settle();
    });

  let yielded = 0;
  while (true) {
    if (ctx.isAborted()) break;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    while (yielded < events.length) yield events[yielded++];
    if (isExpectedAbort?.()) {
      await persistNewMessagesOnce()
        .catch((err) => {
          const persistenceError: SwarmEvent = { type: "error", agentId, error: err as Error };
          events.push(persistenceError);
          ctx.emit(persistenceError);
        });
      settle();
    }
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

/**
 * Extract text content from an AgentMessage content field.
 */
export function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
  }
  return "";
}

/**
 * Get the intervention strategy for a given point from the swarm config.
 */
export function getStrategy(ctx: ModeExecutionContext, point: string): string {
  return ctx.swarmConfig.interventions?.[point as keyof typeof ctx.swarmConfig.interventions] ?? "auto";
}
