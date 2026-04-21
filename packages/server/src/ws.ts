import type { Server } from "http";
import type { Express } from "express";
import { WebSocketServer, WebSocket } from "ws";
import type { AgentSwarm } from "@agent-swarm/core";

interface WSClient {
  ws: WebSocket;
  conversationId?: string;
}

export function createWSServer(app: Express, _swarm: AgentSwarm): Server {
  const server = require("http").createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });

  const clients = new Set<WSClient>();

  wss.on("connection", (ws) => {
    const client: WSClient = { ws };
    clients.add(client);

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());

        switch (msg.type) {
          case "send_message":
            handleSendMessage(client, msg);
            break;
          case "intervention_decision":
            handleInterventionDecision(client, msg);
            break;
          default:
            ws.send(JSON.stringify({ type: "error", payload: { message: "Unknown message type" } }));
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", payload: { message: "Invalid JSON" } }));
      }
    });

    ws.on("close", () => {
      clients.delete(client);
    });

    ws.send(JSON.stringify({ type: "connected", payload: { message: "Connected to Agent Swarm" } }));
  });

  // TODO: implement event broadcasting from swarm to WS clients
  function broadcastToConversation(conversationId: string, event: any) {
    const payload = JSON.stringify({
      type: event.type,
      payload: event,
      conversationId,
    });

    for (const client of clients) {
      if (client.conversationId === conversationId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
      }
    }
  }

  async function handleSendMessage(client: WSClient, msg: any) {
    // TODO: create conversation and stream events
    client.ws.send(JSON.stringify({
      type: "error",
      payload: { message: "send_message not implemented yet" },
    }));
  }

  async function handleInterventionDecision(_client: WSClient, msg: any) {
    // TODO: relay intervention decision back to the running conversation
    console.log("Intervention decision received:", msg);
  }

  return server;
}
