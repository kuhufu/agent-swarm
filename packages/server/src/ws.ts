import { createServer } from "http";
import type { IncomingMessage } from "http";
import type { Express } from "express";
import { WebSocketServer, WebSocket } from "ws";
import type { AgentSwarm, SwarmEvent, ThinkingLevel, SwarmConversation } from "@agent-swarm/core";
import { verifyAccessToken } from "./middleware/auth.js";

interface WSClient {
  ws: WebSocket;
  userId: string;
  conversationId?: string;
  activeConversation?: SwarmConversation;
  /** Pending intervention decisions — maps requestId → resolve function */
  pendingDecisions: Map<string, (decision: any) => void>;
  /** Pending client tool executions — maps requestId → resolve function */
  pendingToolExecutions: Map<string, (result: any) => void>;
}

interface ConversationPreferencesPayload {
  enabledTools: string[];
  thinkingLevel?: string;
  directModel?: {
    provider: string;
    modelId: string;
  };
}

interface ConversationPreferencesPatch {
  enabledTools?: string[];
  thinkingLevel?: string;
  directModel?: {
    provider: string;
    modelId: string;
  };
}

const DEFAULT_CONVERSATION_PREFERENCES: ConversationPreferencesPayload = {
  enabledTools: [],
};

function parseBearerToken(header: string | undefined): string | null {
  if (!header || !header.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

function resolveWsUserId(request: IncomingMessage): string | null {
  const authHeader = Array.isArray(request.headers.authorization)
    ? request.headers.authorization[0]
    : request.headers.authorization;

  let token = parseBearerToken(authHeader);
  if (!token) {
    const url = new URL(request.url ?? "/", "ws://localhost");
    const queryToken = url.searchParams.get("token");
    token = queryToken && queryToken.trim().length > 0 ? queryToken.trim() : null;
  }

  if (!token) {
    return null;
  }

  const payload = verifyAccessToken(token);
  return payload?.id ?? null;
}

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
  if (typeof payload.thinkingLevel === "string" && payload.thinkingLevel.trim().length > 0) {
    patch.thinkingLevel = payload.thinkingLevel.trim();
  }
  if (payload.directModel && typeof payload.directModel === "object" && !Array.isArray(payload.directModel)) {
    const directModelRaw = payload.directModel as Record<string, unknown>;
    const provider = typeof directModelRaw.provider === "string" ? directModelRaw.provider.trim() : "";
    const modelId = typeof directModelRaw.modelId === "string" ? directModelRaw.modelId.trim() : "";
    if (provider && modelId) {
      patch.directModel = { provider, modelId };
    }
  }

  return patch;
}

export function createWSServer(app: Express, swarm: AgentSwarm) {
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });

  const clients = new Set<WSClient>();

  wss.on("connection", (ws, request) => {
    const userId = resolveWsUserId(request);
    if (!userId) {
      ws.close(4401, "Unauthorized");
      return;
    }

    const client: WSClient = { ws, userId, pendingDecisions: new Map(), pendingToolExecutions: new Map() };
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
    const provider = typeof payload.provider === "string" ? payload.provider : undefined;
    const modelId = typeof payload.modelId === "string" ? payload.modelId : undefined;
    const thinkingLevel = typeof payload.thinkingLevel === "string" ? payload.thinkingLevel as ThinkingLevel : undefined;
    const preferencesPatch = parseConversationPreferencesPatch(payload);

    if (typeof content !== "string" || content.trim().length === 0) {
      send(client, { type: "error", payload: { message: "content must be a non-empty string" } });
      return;
    }

    let conversation: SwarmConversation | undefined;
    let activeConversationId: string | undefined;
    try {
      let effectivePreferences: ConversationPreferencesPayload = { ...DEFAULT_CONVERSATION_PREFERENCES };
      let storedConversation: Awaited<ReturnType<typeof swarm.getConversation>> = null;

      if (conversationId) {
        storedConversation = await swarm.getConversation(conversationId, client.userId);
        if (!storedConversation) {
          throw new Error(`Conversation not found: ${conversationId}`);
        }

        const mergedPatch: ConversationPreferencesPatch = { ...preferencesPatch };
        if (provider && modelId && storedConversation.swarmId.startsWith("__direct_")) {
          mergedPatch.directModel = { provider, modelId };
        }

        if (
          mergedPatch.enabledTools !== undefined
          || mergedPatch.thinkingLevel !== undefined
          || mergedPatch.directModel !== undefined
        ) {
          storedConversation = await swarm.updateConversationPreferences(conversationId, mergedPatch, client.userId);
        }
        conversation = await swarm.resumeConversation(conversationId, client.userId);
        effectivePreferences = {
          enabledTools: storedConversation.enabledTools,
          thinkingLevel: storedConversation.thinkingLevel,
          ...(storedConversation.directModel ? { directModel: storedConversation.directModel } : {}),
        };
      } else if (swarmId) {
        const initialPreferences: ConversationPreferencesPatch = {
          enabledTools: preferencesPatch.enabledTools ?? DEFAULT_CONVERSATION_PREFERENCES.enabledTools,
          thinkingLevel: preferencesPatch.thinkingLevel,
        };
        conversation = await swarm.createConversation(client.userId, swarmId, undefined, initialPreferences);
        storedConversation = await swarm.getConversation(conversation.getId(), client.userId);
        if (storedConversation) {
          effectivePreferences = {
            enabledTools: storedConversation.enabledTools,
            thinkingLevel: storedConversation.thinkingLevel,
            ...(storedConversation.directModel ? { directModel: storedConversation.directModel } : {}),
          };
        } else {
          effectivePreferences = {
            enabledTools: initialPreferences.enabledTools ?? [],
            thinkingLevel: initialPreferences.thinkingLevel,
          };
        }
      } else if (provider && modelId) {
        // Direct conversation mode (no swarm needed)
        const initialPreferences: ConversationPreferencesPatch = {
          enabledTools: preferencesPatch.enabledTools ?? DEFAULT_CONVERSATION_PREFERENCES.enabledTools,
          thinkingLevel: preferencesPatch.thinkingLevel,
          directModel: { provider, modelId },
        };
        conversation = await swarm.createDirectConversation(client.userId, provider, modelId, undefined, initialPreferences);
        storedConversation = await swarm.getConversation(conversation.getId(), client.userId);
        if (storedConversation) {
          effectivePreferences = {
            enabledTools: storedConversation.enabledTools,
            thinkingLevel: storedConversation.thinkingLevel,
            ...(storedConversation.directModel ? { directModel: storedConversation.directModel } : {}),
          };
        } else {
          effectivePreferences = {
            enabledTools: initialPreferences.enabledTools ?? [],
            thinkingLevel: initialPreferences.thinkingLevel,
            directModel: initialPreferences.directModel,
          };
        }
      } else {
        send(client, { type: "error", payload: { message: "swarmId or (provider + modelId) or conversationId required" } });
        return;
      }

      client.activeConversation = conversation;
      const convId = conversation.getId();
      activeConversationId = convId;
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
          thinkingLevel: effectivePreferences.thinkingLevel,
          ...(effectivePreferences.directModel ? { directModel: effectivePreferences.directModel } : {}),
        },
      };
      send(client, createdPacket);
      broadcastPacketToConversation(convId, createdPacket, client);

      // Stream events from the conversation
      const stream = conversation.prompt(content, {
        enabledTools: effectivePreferences.enabledTools,
        thinkingLevel: (effectivePreferences.thinkingLevel ?? thinkingLevel) as ThinkingLevel | undefined,
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
        conversationId: convId,
      };
      send(client, completedPacket);
      broadcastPacketToConversation(convId, completedPacket, client);
    } catch (err: any) {
      send(client, {
        type: "error",
        payload: { message: err.message ?? "Failed to process message" },
        ...(activeConversationId || conversationId ? { conversationId: activeConversationId ?? conversationId } : {}),
      });
    } finally {
      client.activeConversation = undefined;
    }
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
