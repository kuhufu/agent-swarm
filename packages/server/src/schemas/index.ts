import { z } from "zod";

const directModelSchema = z.object({
  provider: z.string().min(1, "提供商不能为空"),
  modelId: z.string().min(1, "模型 ID 不能为空"),
});

const modelReferenceSchema = directModelSchema.partial().optional();

const agentConfigSchema = z.object({
  id: z.string().min(1, "Agent ID 不能为空"),
  name: z.string().min(1, "Agent 名称不能为空"),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  model: modelReferenceSchema,
});

const debatableConfigSchema = z.object({
  rounds: z.number().int().min(1).max(10).optional(),
  proAgent: z.string().min(1).optional(),
  conAgent: z.string().min(1).optional(),
  judgeAgent: z.string().min(1).optional(),
});

const pipelineConditionSchema = z.object({
  type: z.enum(["equals", "notEquals", "contains", "regex", "minLength", "maxLength"]),
  value: z.string(),
});

const pipelineStepSchema = z.object({
  agentId: z.string().min(1),
  condition: pipelineConditionSchema.optional(),
  transform: z.object({
    type: z.enum(["prepend", "append", "template", "trim", "replace"]),
    value: z.string().optional(),
  }).optional(),
});

const interventionPointSchema = z.enum([
  "before_agent_start",
  "after_agent_end",
  "before_tool_call",
  "after_tool_call",
  "on_handoff",
  "on_error",
  "on_approval_required",
]);

const interventionStrategySchema = z.enum(["auto", "confirm", "review", "edit", "reject"]);

const interventionsSchema = z.partialRecord(interventionPointSchema, interventionStrategySchema);
const swarmContextSchema = z.object({
  mode: z.enum(["handoff_only", "summary"]),
  maxAgentSummaries: z.number().int().positive().optional(),
  maxSummaryChars: z.number().int().positive().optional(),
  maxTotalChars: z.number().int().positive().optional(),
}).optional();

export const createSwarmSchema = z.object({
  name: z.string().min(1, "名称不能为空"),
  description: z.string().optional(),
  mode: z.union([z.string(), z.object({ type: z.string() })]),
  agents: z.array(agentConfigSchema).min(1, "至少需要一个 Agent"),
  orchestrator: agentConfigSchema.optional(),
  aggregator: agentConfigSchema.optional(),
  debateConfig: debatableConfigSchema.optional(),
  pipeline: z.array(pipelineStepSchema).optional(),
  interventions: interventionsSchema.optional(),
  maxTotalTurns: z.number().int().positive().optional(),
  maxConcurrency: z.number().int().positive().optional(),
  swarmContext: swarmContextSchema,
});

export const updateSwarmSchema = z.object({
  name: z.string().min(1, "名称不能为空").optional(),
  description: z.string().optional(),
  mode: z.union([z.string(), z.object({ type: z.string() })]).optional(),
  agents: z.array(agentConfigSchema).min(1, "至少需要一个 Agent").optional(),
  orchestrator: agentConfigSchema.optional(),
  aggregator: agentConfigSchema.optional(),
  debateConfig: debatableConfigSchema.optional(),
  pipeline: z.array(pipelineStepSchema).optional(),
  interventions: interventionsSchema.optional(),
  maxTotalTurns: z.number().int().positive().optional(),
  maxConcurrency: z.number().int().positive().optional(),
  swarmContext: swarmContextSchema,
});

export const createAgentPresetSchema = z.object({
  id: z.string().min(1, "ID 不能为空"),
  name: z.string().min(1, "名称不能为空"),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  model: z.object({
    provider: z.string().default(""),
    modelId: z.string().default(""),
  }).optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const updateAgentPresetSchema = z.object({
  name: z.string().min(1, "名称不能为空").optional(),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  model: z.object({
    provider: z.string().default(""),
    modelId: z.string().default(""),
  }).optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const createAgentTemplateSchema = createAgentPresetSchema;

export const updateAgentTemplateSchema = updateAgentPresetSchema;

export const createConversationSchema = z.object({
  swarmId: z.string().min(1, "swarmId 不能为空"),
  title: z.string().optional(),
  enabledTools: z.array(z.string()).optional(),
  thinkingLevel: z.enum(["xhigh", "high", "medium", "low", "off"]).optional(),
  directModel: directModelSchema.optional(),
});

export const updateConversationPreferencesSchema = z.object({
  enabledTools: z.array(z.string()).optional(),
  thinkingLevel: z.enum(["xhigh", "high", "medium", "low", "off"]).optional(),
  directModel: directModelSchema.optional(),
});

export const providerConfigSchema = z.object({
  baseUrl: z.string().optional(),
  apiProtocol: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  thinkingFormat: z.string().optional(),
});

export const updateConfigSchema = z.object({
  apiKeys: z.record(z.string(), z.string()).optional(),
  providers: z.record(z.string(), providerConfigSchema).optional(),
  endpoints: z.record(z.string(), z.object({
    baseUrl: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
  })).optional(),
  defaultThinkingLevel: z.enum(["xhigh", "high", "medium", "low", "off"]).optional(),
  defaultThinkingBudgets: z.object({
    xhigh: z.number().int().positive().optional(),
    high: z.number().int().positive().optional(),
    medium: z.number().int().positive().optional(),
    low: z.number().int().positive().optional(),
  }).optional(),
  models: z.array(z.object({
    id: z.string().min(1, "模型 ID 不能为空"),
    name: z.string().min(1, "模型名称不能为空"),
    provider: z.string().min(1, "提供商不能为空"),
    modelId: z.string().min(1, "模型标识不能为空"),
  })).optional(),
});

export const testModelSchema = z.object({
  provider: z.string().min(1, "提供商不能为空"),
  modelId: z.string().min(1, "模型 ID 不能为空"),
  prompt: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  override: z.object({
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    apiProtocol: z.string().optional(),
    thinkingFormat: z.string().optional(),
  }).optional(),
});

export const listConversationsQuerySchema = z.object({
  swarmId: z.string().optional(),
});
