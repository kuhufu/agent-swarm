import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { SwarmAgentConfig, SwarmConfig } from "../core/types.js";
import type { WebSearchConfig } from "./web-search.js";
import { createWebSearchTool } from "./web-search.js";
import type { ClientToolDefinition, ClientToolExecutionResult } from "./client-bridge.js";
import { createClientBridgeTool } from "./client-bridge.js";
import { createHandoffTool } from "./handoff.js";
import { createRouteToAgentTool } from "./route-to-agent.js";

export interface RuntimeTool {
  id: string;
  agentTools: AgentTool<any>[];
}

export interface ToolRuntimeOptions {
  enabledTools: string[];
  clientToolExecutor: (
    request: { toolName: string; toolCallId: string; params: unknown },
  ) => Promise<ClientToolExecutionResult>;
  webSearchConfig?: WebSearchConfig;
  mcpTools?: AgentTool<any>[];
  runtimeTools?: RuntimeTool[];
}

export interface ToolRuntimeAvailability {
  webSearchConfig?: WebSearchConfig;
  mcpTools?: AgentTool<any>[];
  runtimeTools?: RuntimeTool[];
}

export interface ToolRuntimeInput extends ToolRuntimeAvailability {
  enabledTools?: string[];
  clientToolExecutor?: (
    request: { toolName: string; toolCallId: string; params: unknown },
  ) => Promise<ClientToolExecutionResult>;
}

export function createRuntimeTool(tool: AgentTool<any>): RuntimeTool;
export function createRuntimeTool(id: string, tools: AgentTool<any> | AgentTool<any>[]): RuntimeTool;
export function createRuntimeTool(
  idOrTool: string | AgentTool<any>,
  tools?: AgentTool<any> | AgentTool<any>[],
): RuntimeTool {
  if (typeof idOrTool === "string") {
    const agentTools = Array.isArray(tools) ? tools : tools ? [tools] : [];
    return {
      id: idOrTool,
      agentTools,
    };
  }

  return {
    id: idOrTool.name,
    agentTools: [idOrTool],
  };
}

export function createToolRuntimeOptions(input: ToolRuntimeInput = {}): ToolRuntimeOptions {
  return {
    enabledTools: normalizeEnabledTools(input.enabledTools),
    clientToolExecutor: input.clientToolExecutor ?? defaultClientToolExecutor,
    webSearchConfig: input.webSearchConfig,
    mcpTools: input.mcpTools,
    runtimeTools: input.runtimeTools,
  };
}

export function withRuntimeTools(
  config: SwarmAgentConfig,
  swarmConfig: SwarmConfig,
  runtimeOptions: ToolRuntimeOptions,
): SwarmAgentConfig {
  const tools = mergeToolsByName(
    config.tools ?? [],
    createRuntimeTools(config, swarmConfig, runtimeOptions),
  );

  return {
    ...config,
    tools,
  };
}

export function createRuntimeTools(
  config: SwarmAgentConfig,
  swarmConfig: SwarmConfig,
  runtimeOptions: ToolRuntimeOptions,
): AgentTool<any>[] {
  const tools: AgentTool<any>[] = [];
  const enabledTools = new Set(runtimeOptions.enabledTools);
  const availableAgents = getAvailableAgents(swarmConfig);

  if (
    swarmConfig.mode === "router"
    && swarmConfig.orchestrator
    && config.id === swarmConfig.orchestrator.id
  ) {
    tools.push(createRouteToAgentTool(availableAgents));
  }

  if (swarmConfig.mode === "swarm") {
    tools.push(createHandoffTool(availableAgents.filter((agent) => agent.id !== config.id)));
  }

  for (const clientTool of createClientToolDefinitions()) {
    if (!enabledTools.has(clientTool.name)) {
      continue;
    }
    tools.push(createClientBridgeTool({
      tool: clientTool,
      execute: runtimeOptions.clientToolExecutor,
    }));
  }

  if (enabledTools.has("web_search")) {
    tools.push(createWebSearchTool(runtimeOptions.webSearchConfig ?? { provider: "duckduckgo" }));
  }

  if (enabledTools.has("mcp")) {
    tools.push(...(runtimeOptions.mcpTools ?? []));
  }

  for (const runtimeTool of runtimeOptions.runtimeTools ?? []) {
    if (enabledTools.has(runtimeTool.id)) {
      tools.push(...runtimeTool.agentTools);
    }
  }

  return mergeToolsByName([], tools);
}

export function createClientToolDefinitions(): ClientToolDefinition[] {
  return [
    {
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
    },
    {
      name: "javascript_execute",
      label: "JavaScript Execute",
      description: "Execute runnable JavaScript code in the browser for calculation, transformation, and quick checks.",
      parametersSchema: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "Must be runnable JavaScript statements (not plain text). Use executable code and preferably `return` the final value.",
          },
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
    },
  ];
}

export function normalizeEnabledTools(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const normalized = input
    .filter((tool): tool is string => typeof tool === "string")
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0);
  return Array.from(new Set(normalized));
}

function mergeToolsByName(baseTools: AgentTool<any>[], extraTools: AgentTool<any>[]): AgentTool<any>[] {
  const merged = [...baseTools];
  const seen = new Set(merged.map((tool) => tool.name));
  for (const tool of extraTools) {
    if (!seen.has(tool.name)) {
      merged.push(tool);
      seen.add(tool.name);
    }
  }
  return merged;
}

function getAvailableAgents(swarmConfig: SwarmConfig): Array<{ id: string; name: string; description: string }> {
  const availableAgents = swarmConfig.agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    description: agent.description,
  }));

  if (
    swarmConfig.orchestrator
    && !availableAgents.some((agent) => agent.id === swarmConfig.orchestrator!.id)
  ) {
    availableAgents.push({
      id: swarmConfig.orchestrator.id,
      name: swarmConfig.orchestrator.name,
      description: swarmConfig.orchestrator.description,
    });
  }

  return availableAgents;
}

async function defaultClientToolExecutor(): Promise<ClientToolExecutionResult> {
  return {
    content: "Client tool executor not configured",
    isError: true,
  };
}
