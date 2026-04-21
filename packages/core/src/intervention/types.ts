export type InterventionPoint =
  | "before_agent_start"
  | "after_agent_end"
  | "before_tool_call"
  | "after_tool_call"
  | "on_handoff"
  | "on_error"
  | "on_approval_required";

export type InterventionStrategy = "auto" | "confirm" | "review" | "edit" | "reject";

export interface InterventionDecision {
  action: "approve" | "reject" | "edit" | "retry" | "abort";
  editedInput?: string;
  targetAgent?: string;
  reason?: string;
}

export interface InterventionContext {
  agentId?: string;
  toolName?: string;
  arguments?: any;
  result?: any;
  error?: Error;
  fromAgentId?: string;
  toAgentId?: string;
  input?: string;
  output?: string;
}
