import type { AgentTool } from "@mariozechner/pi-agent-core";

// ============================================================================
// Collaboration Mode
// ============================================================================

export type CollaborationMode = "chat" | "handoff_chain" | "debate" | "team" | "refine";

export interface DebateConfig {
  rounds: number;
  judgeAgent: string;
  proAgent: string;
  conAgent: string;
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

export type InterventionCallback = (
  point: InterventionPoint,
  context: any,
) => Promise<any>;

// ============================================================================
// Swarm Config
// ============================================================================

export interface SwarmConfig {
  id: string;
  name: string;
  mode: CollaborationMode;
  agents: SwarmAgentConfig[];
  debateConfig?: DebateConfig;
  interventions?: Partial<Record<InterventionPoint, InterventionStrategy>>;
  maxTotalTurns?: number;
  maxConcurrency?: number;
  handoffContext?: HandoffContextConfig;
}

export interface HandoffContextConfig {
  mode: "handoff_only" | "summary";
  maxAgentSummaries?: number;
  maxSummaryChars?: number;
  maxTotalChars?: number;
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
  input?: ("text" | "image")[];
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
  toolCallPhase?: "start" | "delta" | "end";
  toolCallContentIndex?: number;
  toolCallId?: string;
  toolName?: string;
  toolCallArgs?: any;
  toolCallArgumentsDelta?: string;
  toolCallArgumentsText?: string;
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
  toolName: string;
  args: any;
  partialResult: any;
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

export type TeamRunStatus =
  | "created"
  | "planning"
  | "running"
  | "summarizing"
  | "completed"
  | "waiting_for_user"
  | "failed"
  | "aborted";

export type TeamTaskStatus =
  | "pending"
  | "running"
  | "verifying"
  | "revision_required"
  | "completed"
  | "waiting_for_user"
  | "failed"
  | "skipped";

export type TeamTaskType =
  | "simple_chat"
  | "requirements_analysis"
  | "brainstorming"
  | "research"
  | "document"
  | "coding"
  | "mixed";

export type TeamStrategy =
  | "single_agent"
  | "parallel_perspectives"
  | "sequential_refinement"
  | "research_then_synthesize"
  | "critique_and_revise";

export type TeamRole =
  | "owner"
  | "analyst"
  | "ideator"
  | "critic"
  | "synthesizer"
  | "researcher"
  | "developer"
  | "tester"
  | "reviewer";

export interface TeamRoutingDecision {
  useTeam: boolean;
  reason: string;
  taskType: TeamTaskType;
  strategy: TeamStrategy;
  roles: TeamRole[];
  clarificationQuestion?: string;
}

export interface TeamRunEvent {
  type: "team_run_start" | "team_run_update" | "team_run_end";
  runId: string;
  conversationId: string;
  status: TeamRunStatus;
  summary?: string;
  routing?: TeamRoutingDecision;
  plannedRoles?: TeamRole[];
  selectedRoles?: TeamRole[];
  skippedRoles?: TeamRole[];
}

export interface TeamTaskEvent {
  type:
    | "team_task_created"
    | "team_task_started"
    | "team_task_update"
    | "team_task_completed"
    | "team_task_verification_started"
    | "team_task_verification_passed"
    | "team_task_verification_failed"
    | "team_task_retry"
    | "team_task_human_review_required";
  runId: string;
  taskId: string;
  agentId?: string;
  role?: TeamRole;
  status: TeamTaskStatus;
  summary?: string;
  output?: string;
  issues?: string[];
  retryCount?: number;
}

export type RefineRunStatus =
  | "created"
  | "running"
  | "reviewing"
  | "revising"
  | "summarizing"
  | "completed"
  | "aborted";

export type RefineStepStatus =
  | "running"
  | "completed"
  | "revision_required"
  | "approved"
  | "failed";

export type RefineRole = "expander" | "critic";

export interface RefineRunEvent {
  type: "refine_run_start" | "refine_run_update" | "refine_run_end";
  runId: string;
  conversationId: string;
  status: RefineRunStatus;
  summary?: string;
  iteration?: number;
  maxIterations?: number;
}

export interface RefineStepEvent {
  type:
    | "refine_step_started"
    | "refine_step_completed"
    | "refine_review_started"
    | "refine_review_completed"
    | "refine_revision_requested"
    | "refine_final_report_started"
    | "refine_final_report_completed";
  runId: string;
  stepId: string;
  iteration: number;
  agentId?: string;
  role: RefineRole;
  status: RefineStepStatus;
  summary?: string;
  output?: string;
  feedback?: string;
  approved?: boolean;
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
  | TeamRunEvent
  | TeamTaskEvent
  | RefineRunEvent
  | RefineStepEvent
  | InterventionRequiredEvent
  | ErrorEvent;
