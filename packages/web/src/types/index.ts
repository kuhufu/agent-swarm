// ============================================================================
// API Response Types
// ============================================================================

export interface SwarmConfig {
  id: string;
  name: string;
  mode: CollaborationMode;
  agents: SwarmAgentConfig[];
  orchestrator?: SwarmAgentConfig;
  debateConfig?: DebateConfig;
  maxTotalTurns?: number;
  maxConcurrency?: number;
}

export interface DebateConfig {
  rounds: number;
  proAgent: string;
  conAgent: string;
  judgeAgent: string;
}

export type CollaborationMode = "router" | "sequential" | "parallel" | "swarm" | "debate";

export interface SwarmAgentConfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: ModelConfig;
}

export interface PresetAgent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: ModelConfig;
  category: string;
  tags: string[];
  builtIn: boolean;
}

export interface ModelConfig {
  provider: string;
  modelId: string;
}

export interface ConversationInfo {
  id: string;
  swarmId: string;
  title?: string;
  enabledTools: string[];
  thinkingLevel: string;
  directModel?: ModelConfig;
  createdAt: number;
  updatedAt: number;
}

export type ApiProtocol =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai"
  | "mistral-conversations"
  | "azure-openai-responses"
  | (string & {});

export type ThinkingFormat = "openai" | "openrouter" | "deepseek" | "zai" | "qwen" | "qwen-chat-template";

export interface ProviderConfig {
  baseUrl?: string;
  apiProtocol?: ApiProtocol;
  headers?: Record<string, string>;
  thinkingFormat?: ThinkingFormat;
}

export interface SavedModel {
  id: string;
  name: string;
  provider: string;
  modelId: string;
}

export interface LLMConfig {
  apiKeys: Record<string, string>;
  providers?: Record<string, ProviderConfig>;
  endpoints?: Record<string, { baseUrl: string; headers?: Record<string, string> }>;
  defaultThinkingLevel?: string;
  defaultThinkingBudgets?: { maxTokens?: number; maxThinkingTokens?: number };
  models?: SavedModel[];
}

export interface ProviderInfo {
  id: string;
  builtIn: boolean;
  defaultApiProtocol?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  api: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
}

export interface ModelTestRequest {
  provider: string;
  modelId: string;
  prompt?: string;
  timeoutMs?: number;
  override?: {
    apiKey?: string;
    baseUrl?: string;
    apiProtocol?: ApiProtocol;
    thinkingFormat?: ThinkingFormat;
  };
}

export interface ModelTestResult {
  ok: boolean;
  provider: string;
  modelId: string;
  text: string;
  stopReason?: string;
  error?: string;
  durationMs: number;
}

// ============================================================================
// Chat Types
// ============================================================================

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool_result" | "system" | "notification";
  content: string;
  agentId?: string;
  agentName?: string;
  thinking?: string;
  toolCalls?: ToolCallInfo[];
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  arguments: any;
  result?: any;
  isError?: boolean;
}

export type AgentStatus = "idle" | "thinking" | "executing_tool" | "handing_off";

export interface AgentState {
  id: string;
  name: string;
  status: AgentStatus;
  currentTool?: string;
  model?: ModelConfig;
  description?: string;
  systemPrompt?: string;
}

// ============================================================================
// Intervention Types
// ============================================================================

export type InterventionPoint =
  | "before_agent_start"
  | "after_agent_end"
  | "before_tool_call"
  | "after_tool_call"
  | "on_handoff"
  | "on_error"
  | "on_approval_required";

export type InterventionAction = "approve" | "reject" | "edit" | "retry" | "abort";

export type InterventionStrategy = "auto" | "confirm" | "review" | "edit" | "reject";

export interface InterventionRequest {
  requestId: string;
  point: InterventionPoint;
  context: any;
  timestamp: number;
}

export interface InterventionDecision {
  action: InterventionAction;
  editedInput?: string;
  reason?: string;
}

// ============================================================================
// WebSocket Message Types
// ============================================================================

export interface WSMessage {
  type: string;
  payload: any;
  conversationId?: string;
}
