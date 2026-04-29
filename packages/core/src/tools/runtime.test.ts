import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { describe, expect, it } from "vitest";
import type { SwarmAgentConfig, SwarmConfig } from "../core/types.js";
import { createRuntimeTool, createRuntimeTools, withRuntimeTools } from "./runtime.js";

const model = { provider: "openai", modelId: "gpt-4o-mini" };

function agent(id: string): SwarmAgentConfig {
  return {
    id,
    name: id,
    description: `${id} description`,
    systemPrompt: "You are an agent.",
    model,
  };
}

function tool(name: string): AgentTool<any> {
  return {
    name,
    label: name,
    description: `${name} tool`,
    parameters: Type.Object({}),
    execute: async () => ({
      content: [{ type: "text", text: name }],
      details: {},
    }),
  };
}

describe("tool runtime", () => {
  it("adds all agent tools from an enabled runtime tool", () => {
    const config = agent("agent-a");
    const swarmConfig: SwarmConfig = {
      id: "swarm",
      name: "swarm",
      mode: "sequential",
      agents: [config],
    };

    const tools = createRuntimeTools(config, swarmConfig, {
      enabledTools: ["workspace"],
      clientToolExecutor: async () => ({ content: "" }),
      runtimeTools: [
        createRuntimeTool("workspace", [tool("write_file"), tool("read_file")]),
      ],
    });

    expect(tools.map((item) => item.name)).toEqual(["write_file", "read_file"]);
  });

  it("uses the agent tool name as the runtime tool id for single tools", () => {
    const searchTool = tool("retrieve_knowledge");
    const runtimeTool = createRuntimeTool(searchTool);

    expect(runtimeTool).toEqual({
      id: "retrieve_knowledge",
      agentTools: [searchTool],
    });
  });

  it("keeps explicit agent tools before runtime tools with the same name", () => {
    const explicitTool = tool("web_search");
    const config: SwarmAgentConfig = {
      ...agent("agent-a"),
      tools: [explicitTool],
    };
    const swarmConfig: SwarmConfig = {
      id: "swarm",
      name: "swarm",
      mode: "sequential",
      agents: [config],
    };

    const enhanced = withRuntimeTools(config, swarmConfig, {
      enabledTools: ["web_search"],
      clientToolExecutor: async () => ({ content: "" }),
    });

    expect(enhanced.tools?.filter((item) => item.name === "web_search")).toHaveLength(1);
    expect(enhanced.tools?.[0]).toBe(explicitTool);
  });

  it("adds router mode routing tool only to the orchestrator", () => {
    const worker = agent("worker");
    const orchestrator = agent("orchestrator");
    const swarmConfig: SwarmConfig = {
      id: "swarm",
      name: "swarm",
      mode: "router",
      orchestrator,
      agents: [worker],
    };
    const runtimeOptions = {
      enabledTools: [],
      clientToolExecutor: async () => ({ content: "" }),
    };

    expect(createRuntimeTools(orchestrator, swarmConfig, runtimeOptions).map((item) => item.name)).toEqual(["route_to_agent"]);
    expect(createRuntimeTools(worker, swarmConfig, runtimeOptions)).toEqual([]);
  });
});
