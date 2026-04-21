import { defineConfig } from "@agent-swarm/core";

export default defineConfig({
  llm: {
    defaultProvider: "anthropic",
    defaultModel: "claude-sonnet-4-20250514",
    apiKeys: {
      anthropic: process.env.ANTHROPIC_API_KEY ?? "",
      openai: process.env.OPENAI_API_KEY ?? "",
      google: process.env.GOOGLE_API_KEY ?? "",
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
        model: { provider: "anthropic", modelId: "claude-sonnet-4-20250514" },
      },
      agents: [
        {
          id: "researcher",
          name: "Researcher",
          description: "Good at web search and information gathering",
          systemPrompt: "You are a research specialist. Help users find and analyze information.",
          model: { provider: "openai", modelId: "gpt-4o" },
        },
        {
          id: "writer",
          name: "Writer",
          description: "Good at writing and summarizing",
          systemPrompt: "You are a writing specialist. Help users create and refine content.",
          model: { provider: "anthropic", modelId: "claude-sonnet-4-20250514" },
        },
      ],
    },
  ],
});
