import { defineConfig } from "@agent-swarm/core";

export default defineConfig({
  llm: {
    defaultProvider: "deepseek",
    defaultModel: "deepseek-chat",
    apiKeys: {
      deepseek: process.env.DEEPSEEK_API_KEY ?? "",
    },
  },
  storage: {
    type: "sqlite",
    path: "./data/agent-swarm.db",
  },
  swarms: [
    {
      id: "research-team",
      name: "Research Team",
      mode: "router",
      orchestrator: {
        id: "router",
        name: "Router",
        description: "Routes questions to the right specialist",
        systemPrompt: "You are a router. Decide which specialist to use based on the user's question.",
        model: { provider: "deepseek", modelId: "deepseek-chat" },
      },
      agents: [
        {
          id: "researcher",
          name: "Researcher",
          description: "Good at web search and information gathering",
          systemPrompt: "You are a research specialist. Help users find and analyze information.",
          model: { provider: "deepseek", modelId: "deepseek-chat" },
        },
        {
          id: "writer",
          name: "Writer",
          description: "Good at writing and summarizing",
          systemPrompt: "You are a writing specialist. Help users create and refine content.",
          model: { provider: "deepseek", modelId: "deepseek-chat" },
        },
      ],
    },
  ],
});
