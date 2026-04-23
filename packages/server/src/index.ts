import "dotenv/config";
import { createApp } from "./app.js";
import { createWSServer } from "./ws.js";
import { AgentSwarm } from "@agent-swarm/core";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

async function main() {
  const swarm = new AgentSwarm({
    config: {
      llm: {
        apiKeys: {},
      },
      storage: {
        type: "sqlite",
        path: process.env.DB_PATH ?? "./data/agent-swarm.db",
      },
      swarms: [],
    },
  });

  await swarm.init();

  const app = createApp(swarm);
  const server = createWSServer(app, swarm);

  server.listen(PORT, () => {
    console.log(`Agent Swarm server running on http://localhost:${PORT}`);
    console.log(`WebSocket available on ws://localhost:${PORT}/ws`);
  });

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await swarm.close();
    server.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
