import { createServer } from "http";
import type { Express } from "express";
import { WebSocketServer, WebSocket } from "ws";
import type { AgentSwarm, SwarmEvent } from "@agent-swarm/core";
import type { SwarmConversation } from "@agent-swarm/core";

interface WSClient {
  ws: WebSocket;
  conversationId?: string;
  activeConversation?: SwarmConversation;
  /** Pending intervention decisions — maps requestId → resolve function */
  pendingDecisions: Map<string, (decision: any) => void>;
}

export function createWSServer(app: Express, swarm: AgentSwarm) {
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });

  const clients = new Set<WSClient>();

  wss.on("connection", (ws) => {
    const client: WSClient = { ws, pendingDecisions: new Map() };
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
      clients.delete(client);
    });

    send(client, { type: "connected", payload: { message: "Connected to Agent Swarm" } });
  });

  /**
   * Handle incoming user messages via WebSocket.
   */
  async function handleSendMessage(client: WSClient, msg: any, swarm: AgentSwarm) {
    const { swarmId, content, conversationId } = msg.payload ?? {};

    if (typeof content !== "string" || content.trim().length === 0) {
      send(client, { type: "error", payload: { message: "content must be a non-empty string" } });
      return;
    }

    let conversation: SwarmConversation | undefined;
    try {
      if (conversationId) {
        conversation = await swarm.resumeConversation(conversationId);
      } else if (swarmId) {
        conversation = await swarm.createConversation(swarmId);
      } else {
        send(client, { type: "error", payload: { message: "swarmId or conversationId required" } });
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
        payload: { conversationId: convId },
      };
      send(client, createdPacket);
      broadcastPacketToConversation(convId, createdPacket, client);

      // Stream events from the conversation
      const stream = conversation.prompt(content);

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

  function handleInterventionDecision(client: WSClient, msg: any) {
    const { requestId, decision } = msg.payload ?? {};
    if (!requestId) return;

    const resolve = client.pendingDecisions.get(requestId);
    if (resolve) {
      client.pendingDecisions.delete(requestId);
      resolve(decision);
    }
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
        stack: serialized.error.stack,
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
