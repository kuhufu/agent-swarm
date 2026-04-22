import { createServer } from "http";
import type { Express } from "express";
import { WebSocketServer, WebSocket } from "ws";
import type { AgentSwarm, SwarmEvent } from "@agent-swarm/core";
import type { SwarmConversation } from "@agent-swarm/core";
import type { ClientToolDefinition } from "@agent-swarm/core";

interface WSClient {
  ws: WebSocket;
  conversationId?: string;
  activeConversation?: SwarmConversation;
  /** Pending intervention decisions — maps requestId → resolve function */
  pendingDecisions: Map<string, (decision: any) => void>;
  /** Pending client tool executions — maps requestId → resolve function */
  pendingToolExecutions: Map<string, (result: any) => void>;
}

interface ConversationPreferencesPayload {
  enabledTools: string[];
  thinkModeEnabled: boolean;
}

interface ConversationPreferencesPatch {
  enabledTools?: string[];
  thinkModeEnabled?: boolean;
}

const DEFAULT_CONVERSATION_PREFERENCES: ConversationPreferencesPayload = {
  enabledTools: [],
  thinkModeEnabled: false,
};

function normalizeEnabledTools(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const normalized = input
    .filter((tool): tool is string => typeof tool === "string")
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0);
  return Array.from(new Set(normalized));
}

function parseConversationPreferencesPatch(payload: Record<string, unknown>): ConversationPreferencesPatch {
  const patch: ConversationPreferencesPatch = {};
  if (Array.isArray(payload.enabledTools)) {
    patch.enabledTools = normalizeEnabledTools(payload.enabledTools);
  }
  if (typeof payload.thinkModeEnabled === "boolean") {
    patch.thinkModeEnabled = payload.thinkModeEnabled;
  }

  return patch;
}

export function createWSServer(app: Express, swarm: AgentSwarm) {
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });

  const clients = new Set<WSClient>();

  wss.on("connection", (ws) => {
    const client: WSClient = { ws, pendingDecisions: new Map(), pendingToolExecutions: new Map() };
    clients.add(client);

    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString());

        switch (msg.type) {
          case "send_message":
            await handleSendMessage(client, msg, swarm);
            break;
          case "intervention_decision":
            handleInterventionDecision(client, msg);
            break;
          case "client_tool_result":
            handleClientToolResult(client, msg);
            break;
          case "subscribe_conversation":
            client.conversationId = msg.conversationId;
            break;
          case "unsubscribe_conversation":
            client.conversationId = undefined;
            break;
          case "abort":
            if (client.activeConversation) {
              client.activeConversation.abort();
            }
            break;
          default:
            send(client, { type: "error", payload: { message: `Unknown message type: ${msg.type}` } });
        }
      } catch (err: any) {
        send(client, { type: "error", payload: { message: err.message ?? "Internal error" } });
      }
    });

    ws.on("close", () => {
      if (client.activeConversation) {
        client.activeConversation.abort();
      }
      for (const resolve of client.pendingDecisions.values()) {
        resolve({ action: "abort", reason: "WebSocket disconnected" });
      }
      client.pendingDecisions.clear();
      for (const resolve of client.pendingToolExecutions.values()) {
        resolve({ isError: true, content: "前端连接已断开，工具执行中止" });
      }
      client.pendingToolExecutions.clear();
      clients.delete(client);
    });

    send(client, { type: "connected", payload: { message: "Connected to Agent Swarm" } });
  });

  /**
   * Handle incoming user messages via WebSocket.
   */
  async function handleSendMessage(client: WSClient, msg: any, swarm: AgentSwarm) {
    const payload = (msg.payload && typeof msg.payload === "object")
      ? msg.payload as Record<string, unknown>
      : {};
    const swarmId = typeof payload.swarmId === "string" ? payload.swarmId : undefined;
    const content = typeof payload.content === "string" ? payload.content : undefined;
    const conversationId = typeof payload.conversationId === "string" ? payload.conversationId : undefined;
    const clientTools = payload.clientTools;
    const provider = typeof payload.provider === "string" ? payload.provider : undefined;
    const modelId = typeof payload.modelId === "string" ? payload.modelId : undefined;
    const preferencesPatch = parseConversationPreferencesPatch(payload);
    const hasExplicitPreferences = preferencesPatch.enabledTools !== undefined
      || preferencesPatch.thinkModeEnabled !== undefined;

    if (typeof content !== "string" || content.trim().length === 0) {
      send(client, { type: "error", payload: { message: "content must be a non-empty string" } });
      return;
    }

    let conversation: SwarmConversation | undefined;
    try {
      let effectivePreferences: ConversationPreferencesPayload = { ...DEFAULT_CONVERSATION_PREFERENCES };

      if (conversationId) {
        // Direct chat model switch: update the swarm config's agent model in memory
        if (provider && modelId) {
          const storedConv = await swarm.getConversation(conversationId);
          if (storedConv) {
            const swarmConfig = swarm.getSwarmConfig(storedConv.swarmId);
            if (swarmConfig && swarmConfig.id.startsWith("__direct_") && swarmConfig.agents[0]) {
              swarmConfig.agents[0].model = { provider, modelId };
            }
          }
        }
        conversation = await swarm.resumeConversation(conversationId);
        const storedConversation = await swarm.getConversation(conversationId);
        if (!storedConversation) {
          throw new Error(`Conversation not found: ${conversationId}`);
        }
        if (hasExplicitPreferences) {
          const updatedConversation = await swarm.updateConversationPreferences(conversationId, preferencesPatch);
          effectivePreferences = {
            enabledTools: updatedConversation.enabledTools,
            thinkModeEnabled: updatedConversation.thinkModeEnabled,
          };
        } else {
          effectivePreferences = {
            enabledTools: storedConversation.enabledTools,
            thinkModeEnabled: storedConversation.thinkModeEnabled,
          };
        }
      } else if (swarmId) {
        const initialPreferences: ConversationPreferencesPatch = {
          enabledTools: preferencesPatch.enabledTools ?? DEFAULT_CONVERSATION_PREFERENCES.enabledTools,
          thinkModeEnabled: preferencesPatch.thinkModeEnabled ?? DEFAULT_CONVERSATION_PREFERENCES.thinkModeEnabled,
        };
        conversation = await swarm.createConversation(swarmId, undefined, initialPreferences);
        const createdConversation = await swarm.getConversation(conversation.getId());
        if (createdConversation) {
          effectivePreferences = {
            enabledTools: createdConversation.enabledTools,
            thinkModeEnabled: createdConversation.thinkModeEnabled,
          };
        } else {
          effectivePreferences = {
            enabledTools: initialPreferences.enabledTools ?? [],
            thinkModeEnabled: initialPreferences.thinkModeEnabled ?? false,
          };
        }
      } else if (provider && modelId) {
        // Direct conversation mode (no swarm needed)
        const initialPreferences: ConversationPreferencesPatch = {
          enabledTools: preferencesPatch.enabledTools ?? DEFAULT_CONVERSATION_PREFERENCES.enabledTools,
          thinkModeEnabled: preferencesPatch.thinkModeEnabled ?? DEFAULT_CONVERSATION_PREFERENCES.thinkModeEnabled,
        };
        conversation = await swarm.createDirectConversation(provider, modelId, undefined, initialPreferences);
        const createdConversation = await swarm.getConversation(conversation.getId());
        if (createdConversation) {
          effectivePreferences = {
            enabledTools: createdConversation.enabledTools,
            thinkModeEnabled: createdConversation.thinkModeEnabled,
          };
        } else {
          effectivePreferences = {
            enabledTools: initialPreferences.enabledTools ?? [],
            thinkModeEnabled: initialPreferences.thinkModeEnabled ?? false,
          };
        }
      } else {
        send(client, { type: "error", payload: { message: "swarmId or (provider + modelId) or conversationId required" } });
        return;
      }

      client.activeConversation = conversation;
      const convId = conversation.getId();
      client.conversationId = convId;

      // Set up intervention callback
      conversation.onIntervention(async (point: any, context: any) => {
        const requestId = crypto.randomUUID();

        send(client, {
          type: "intervention_required",
          payload: { requestId, point, context },
          conversationId: convId,
        });

        return new Promise<any>((resolve) => {
          client.pendingDecisions.set(requestId, resolve);

          // Timeout after 5 minutes
          setTimeout(() => {
            if (client.pendingDecisions.has(requestId)) {
              client.pendingDecisions.delete(requestId);
              resolve({ action: "approve" });
            }
          }, 5 * 60 * 1000);
        });
      });

      // Send conversation created event
      const createdPacket = {
        type: "conversation_created",
        payload: {
          conversationId: convId,
          enabledTools: effectivePreferences.enabledTools,
          thinkModeEnabled: effectivePreferences.thinkModeEnabled,
        },
      };
      send(client, createdPacket);
      broadcastPacketToConversation(convId, createdPacket, client);

      // Stream events from the conversation
      const stream = conversation.prompt(content, {
        clientTools: normalizeClientTools(clientTools, effectivePreferences.enabledTools),
        enabledTools: effectivePreferences.enabledTools,
        thinkingEnabled: effectivePreferences.thinkModeEnabled,
        clientToolExecutor: async ({ toolName, toolCallId, params }) => {
          const result = await requestClientToolExecution(
            client,
            convId,
            { toolName, toolCallId, params },
          );
          return {
            content: typeof result?.content === "string" ? result.content : "工具执行完成",
            details: result?.details,
            isError: result?.isError === true,
          };
        },
      });

      for await (const event of stream) {
        const packet = {
          type: event.type,
          payload: serializeEvent(event),
          conversationId: convId,
        };
        send(client, packet);
        broadcastPacketToConversation(convId, packet, client);
      }

      const completedPacket = {
        type: "prompt_completed",
        payload: { conversationId: convId },
      };
      send(client, completedPacket);
      broadcastPacketToConversation(convId, completedPacket, client);
    } catch (err: any) {
      send(client, {
        type: "error",
        payload: { message: err.message ?? "Failed to process message" },
      });
    } finally {
      client.activeConversation = undefined;
    }
  }

  function normalizeClientTools(input: unknown, enabledTools: string[]): ClientToolDefinition[] {
    const enabledSet = new Set(enabledTools);

    if (Array.isArray(input)) {
      return input
        .filter((tool): tool is Record<string, unknown> =>
          Boolean(tool) && typeof tool === "object" && !Array.isArray(tool))
        .map((tool) => ({
          name: typeof tool.name === "string" ? tool.name.trim() : "",
          label: typeof tool.label === "string" ? tool.label.trim() : "",
          description: typeof tool.description === "string" ? tool.description.trim() : "",
          parametersSchema: (tool.parametersSchema && typeof tool.parametersSchema === "object" && !Array.isArray(tool.parametersSchema))
            ? tool.parametersSchema as Record<string, unknown>
            : undefined,
        }))
        .filter((tool) => {
          if (tool.name.length === 0 || tool.label.length === 0 || tool.description.length === 0) {
            return false;
          }
          return enabledSet.has(tool.name);
        });
    }

    // Fallback when frontend does not pass definitions for optional tools.
    const fallbackTools: ClientToolDefinition[] = [];

    if (enabledSet.has("current_time")) {
      fallbackTools.push({
        name: "current_time",
        label: "Current Time",
        description: "Get current local date and time from the user's browser.",
        parametersSchema: {
          type: "object",
          properties: {
            locale: {
              type: "string",
              description: "Optional BCP 47 locale, e.g. zh-CN or en-US.",
            },
          },
          additionalProperties: false,
        },
      });
    }

    if (enabledSet.has("javascript_execute")) {
      fallbackTools.push({
        name: "javascript_execute",
        label: "JavaScript Execute",
        description: "Execute JavaScript snippets for calculation, transformation, and quick checks.",
        parametersSchema: {
          type: "object",
          properties: {
            code: { type: "string", description: "JavaScript code to execute." },
            timeoutMs: {
              type: "number",
              description: "Execution timeout in milliseconds (50-5000). Default 2000.",
              minimum: 50,
              maximum: 5000,
            },
          },
          required: ["code"],
          additionalProperties: false,
        },
      });
    }

    return fallbackTools;
  }

  function handleInterventionDecision(client: WSClient, msg: any) {
    const { requestId, decision } = msg.payload ?? {};
    if (!requestId) return;

    const resolve = client.pendingDecisions.get(requestId);
    if (resolve) {
      client.pendingDecisions.delete(requestId);
      resolve(decision);
    }
  }

  function handleClientToolResult(client: WSClient, msg: any) {
    const { requestId, result } = msg.payload ?? {};
    if (!requestId) return;

    const resolve = client.pendingToolExecutions.get(requestId);
    if (resolve) {
      client.pendingToolExecutions.delete(requestId);
      resolve(result);
    }
  }

  function requestClientToolExecution(
    client: WSClient,
    conversationId: string,
    payload: { toolName: string; toolCallId: string; params: unknown },
  ): Promise<any> {
    const requestId = crypto.randomUUID();

    send(client, {
      type: "client_tool_execution_required",
      payload: {
        requestId,
        ...payload,
      },
      conversationId,
    });

    return new Promise<any>((resolve) => {
      client.pendingToolExecutions.set(requestId, resolve);

      setTimeout(() => {
        if (client.pendingToolExecutions.has(requestId)) {
          client.pendingToolExecutions.delete(requestId);
          resolve({
            isError: true,
            content: "前端工具执行超时",
          });
        }
      }, 30 * 1000);
    });
  }

  function serializeEvent(event: SwarmEvent): any {
    const serialized: any = { ...event };

    if (serialized.respond) {
      serialized.requestId = serialized.requestId ?? crypto.randomUUID();
      delete serialized.respond;
    }

    if (serialized.error instanceof Error) {
      serialized.error = {
        message: serialized.error.message,
        name: serialized.error.name,
      };
    }

    return serialized;
  }

  function send(client: WSClient, packet: Record<string, any>) {
    if (client.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    client.ws.send(JSON.stringify(packet));
  }

  function broadcastPacketToConversation(
    conversationId: string,
    packet: Record<string, any>,
    excludeClient?: WSClient,
  ) {
    const payload = JSON.stringify({ ...packet, conversationId });

    for (const client of clients) {
      if (excludeClient && client === excludeClient) {
        continue;
      }
      if (client.conversationId === conversationId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
      }
    }
  }

  return server;
}
