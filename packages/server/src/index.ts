import "dotenv/config";
import { createApp } from "./app.js";
import { createWSServer } from "./ws.js";
import { AgentSwarm, ConsoleLogger } from "@agent-swarm/core";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

async function main() {
  const logger = new ConsoleLogger();
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
    logger,
  });

  await swarm.init();

  const app = createApp(swarm);
  const server = createWSServer(app, swarm);

  server.listen(PORT, () => {
    logger.info("server_started", { port: PORT });
    logger.info("websocket_available", { path: "/ws" });
  });

  // Graceful shutdown
  process.on("SIGINT", async () => {
    logger.info("shutting_down");
    await swarm.close();
    server.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
