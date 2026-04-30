import type { AgentTool } from "@mariozechner/pi-agent-core";

// ============================================================================
// Collaboration Mode
// ============================================================================

export type CollaborationMode = "router" | "sequential" | "parallel" | "swarm" | "debate";

export type AggregationStrategy =
  | { type: "merge" }
  | { type: "vote"; quorum: number }
  | { type: "best"; judgeAgent: string }
  | { type: "custom"; handler: string };

export interface DebateConfig {
  rounds: number;
  judgeAgent: string;
  proAgent: string;
  conAgent: string;
}

export interface PipelineStep {
  agentId: string;
  /** Condition expression (JSON-serializable) — evaluated at runtime */
  condition?: Record<string, any>;
  /** Transform expression (JSON-serializable) — evaluated at runtime */
  transform?: Record<string, any>;
  /** Skip to this agent ID if condition is false */
  onSkip?: string;
}

// ============================================================================
// Thinking
// ============================================================================

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface ThinkingBudgets {
  maxTokens?: number;
  maxThinkingTokens?: number;
}

// ============================================================================
// Model Config
// ============================================================================

export interface ModelConfig {
  provider: string;
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
  apiProtocol?: ApiProtocol;
  options?: Record<string, any> & {
    reasoning?: boolean;
    compat?: Record<string, unknown>;
  };
}

/** Supported LLM API protocols */
export type ApiProtocol =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai"
  | "mistral-conversations"
  | "azure-openai-responses"
  | "bedrock-converse-stream"
  | "google-vertex"
  | (string & {});

// ============================================================================
// Agent Config
// ============================================================================

export interface SwarmAgentConfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: ModelConfig;
  tools?: AgentTool<any>[];
  thinkingLevel?: ThinkingLevel;
  interventions?: Partial<Record<InterventionPoint, InterventionStrategy>>;
  maxTurns?: number;
  thinkingBudgets?: ThinkingBudgets;
}

// ============================================================================
// Agent Preset (standalone reusable agent)
// ============================================================================

export interface AgentPreset {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: ModelConfig;
  category: string;
  tags: string[];
  builtIn: boolean;
}

// Re-export intervention types locally
export type InterventionPoint =
  | "before_agent_start"
  | "after_agent_end"
  | "before_tool_call"
  | "after_tool_call"
  | "on_handoff"
  | "on_error"
  | "on_approval_required";

export type InterventionStrategy = "auto" | "confirm" | "review" | "edit" | "reject";

// ============================================================================
// Swarm Config
// ============================================================================

export interface SwarmConfig {
  id: string;
  name: string;
  mode: CollaborationMode;
  agents: SwarmAgentConfig[];
  orchestrator?: SwarmAgentConfig;
  aggregator?: AggregationStrategy;
  debateConfig?: DebateConfig;
  pipeline?: PipelineStep[];
  interventions?: Partial<Record<InterventionPoint, InterventionStrategy>>;
  maxTotalTurns?: number;
  maxConcurrency?: number;
}

// ============================================================================
// Context Config
// ============================================================================

export interface ContextConfig {
  maxMessages?: number;
  maxTokens?: number;
  strategy: "sliding" | "summarize";
  summarizeAgent?: {
    model: ModelConfig;
  };
}

// ============================================================================
// Storage Config
// ============================================================================

export interface StorageConfig {
  type: "sqlite";
  path: string;
}

export type EventLogLevel = "none" | "key" | "full";

// ============================================================================
// Root Config (for defineConfig)
// ============================================================================

export interface AgentSwarmRootConfig {
  llm: LLMBackendConfig;
  storage: StorageConfig;
  swarms: SwarmConfig[];
  /** Event persistence level for events table. Default: "key". */
  eventLogLevel?: EventLogLevel;
  contextConfig?: ContextConfig;
}

// LLM config re-export
export interface SavedModel {
  id: string;
  name: string;
  provider: string;
  modelId: string;
}

export interface LLMBackendConfig {
  apiKeys: Record<string, string>;
  /** Per-provider custom endpoint configuration */
  providers?: Record<string, ProviderConfig>;
  endpoints?: Record<string, {
    baseUrl: string;
    headers?: Record<string, string>;
  }>;
  defaultThinkingLevel?: ThinkingLevel;
  defaultThinkingBudgets?: ThinkingBudgets;
  /** User-defined model presets */
  models?: SavedModel[];
}

export interface ProviderConfig {
  baseUrl?: string;
  apiProtocol?: ApiProtocol;
  headers?: Record<string, string>;
  /**
   * Thinking format override. Controls how reasoning parameters are sent.
   * "openai" - uses reasoning_effort
   * "deepseek" - uses thinking: { type }
   * "openrouter" - uses reasoning: { effort }
   * "zai" / "qwen" - uses enable_thinking boolean
   * "qwen-chat-template" - uses chat_template_kwargs.enable_thinking
   */
  thinkingFormat?: string;
}

// ============================================================================
// Swarm Events
// ============================================================================

export interface SwarmStartEvent {
  type: "swarm_start";
  swarmId: string;
  conversationId: string;
}

export interface SwarmEndEvent {
  type: "swarm_end";
  swarmId: string;
  conversationId: string;
  finalMessage: string;
}

export interface AgentStartEvent {
  type: "agent_start";
  agentId: string;
  agentName: string;
}

export interface AgentEndEvent {
  type: "agent_end";
  agentId: string;
  agentName: string;
}

export interface TurnStartEvent {
  type: "turn_start";
  agentId: string;
  turn: number;
}

export interface TurnEndEvent {
  type: "turn_end";
  agentId: string;
  turn: number;
}

export interface MessageStartEvent {
  type: "message_start";
  agentId: string;
  agentName?: string;
  role: string;
}

export interface MessageUpdateEvent {
  type: "message_update";
  agentId: string;
  delta?: string;
  thinkingDelta?: string;
}

export interface MessageEndEvent {
  type: "message_end";
  agentId: string;
  agentName?: string;
  role: string;
}

export interface ToolExecutionStartEvent {
  type: "tool_execution_start";
  agentId: string;
  toolName: string;
  toolCallId: string;
  args: any;
}

export interface ToolExecutionUpdateEvent {
  type: "tool_execution_update";
  agentId: string;
  toolCallId: string;
  progress?: any;
}

export interface ToolExecutionEndEvent {
  type: "tool_execution_end";
  agentId: string;
  toolName: string;
  toolCallId: string;
  result: any;
  isError: boolean;
}

export interface HandoffEvent {
  type: "handoff";
  fromAgentId: string;
  toAgentId: string;
  reason?: string;
  task?: string;
  context?: string;
  expectedOutput?: string;
  returnToAgentId?: string;
}

export interface InterventionRequiredEvent {
  type: "intervention_required";
  point: InterventionPoint;
  context: any;
  requestId: string;
  respond: (decision: any) => void;
}

export interface ErrorEvent {
  type: "error";
  agentId?: string;
  error: Error;
}

export type SwarmEvent =
  | SwarmStartEvent
  | SwarmEndEvent
  | AgentStartEvent
  | AgentEndEvent
  | TurnStartEvent
  | TurnEndEvent
  | MessageStartEvent
  | MessageUpdateEvent
  | MessageEndEvent
  | ToolExecutionStartEvent
  | ToolExecutionUpdateEvent
  | ToolExecutionEndEvent
  | HandoffEvent
  | InterventionRequiredEvent
  | ErrorEvent;
