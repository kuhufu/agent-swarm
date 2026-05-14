import type { ConversationEvent } from "../types/index.js";

export function parseTeamEventData(event: ConversationEvent): Record<string, unknown> {
  if (!event.eventData) return {};
  try {
    const parsed = JSON.parse(event.eventData) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function teamRoleLabel(role: unknown): string {
  const map: Record<string, string> = {
    analyst: "需求分析",
    ideator: "方案发散",
    critic: "风险审视",
    synthesizer: "结论汇总",
    researcher: "研究调研",
    developer: "实现分析",
    tester: "验证设计",
    reviewer: "方案评审",
    owner: "Owner",
  };
  return typeof role === "string" ? map[role] ?? role : "Team";
}

export function teamRunStatusLabel(status: unknown): string {
  const map: Record<string, string> = {
    created: "已创建",
    planning: "规划中",
    running: "执行中",
    summarizing: "汇总中",
    completed: "已完成",
    waiting_for_user: "等待用户澄清",
    failed: "失败",
    aborted: "已终止",
  };
  return typeof status === "string" ? map[status] ?? status : "运行中";
}

export function teamTaskTypeLabel(taskType: unknown): string {
  const map: Record<string, string> = {
    simple_chat: "简单问答",
    requirements_analysis: "需求分析",
    brainstorming: "头脑风暴",
    research: "研究调研",
    document: "文档任务",
    coding: "实现任务",
    mixed: "综合任务",
  };
  return typeof taskType === "string" ? map[taskType] ?? taskType : "未记录";
}

export function teamStrategyLabel(strategy: unknown): string {
  const map: Record<string, string> = {
    single_agent: "单 Agent 处理",
    parallel_perspectives: "多视角发散",
    sequential_refinement: "顺序完善",
    research_then_synthesize: "先调研再汇总",
    critique_and_revise: "产出后审视",
  };
  return typeof strategy === "string" ? map[strategy] ?? strategy : "未记录";
}

export function teamEventLabel(eventType: string): string {
  const map: Record<string, string> = {
    team_run_start: "开始规划",
    team_run_update: "路由决策",
    team_run_end: "运行结束",
    team_task_created: "创建任务",
    team_task_started: "开始任务",
    team_task_update: "任务更新",
    team_task_completed: "任务完成",
    team_task_verification_started: "开始审视",
    team_task_verification_passed: "审视通过",
    team_task_verification_failed: "审视失败",
    team_task_retry: "任务重试",
    team_task_human_review_required: "需要人工介入",
  };
  return map[eventType] ?? eventType;
}

export function teamEventSummary(event: ConversationEvent): string {
  const data = parseTeamEventData(event);
  const summary = typeof data.summary === "string" ? data.summary.trim() : "";
  if (summary) return summary;

  const routing = data.routing && typeof data.routing === "object" && !Array.isArray(data.routing)
    ? data.routing as Record<string, unknown>
    : null;
  const reason = typeof routing?.reason === "string" ? routing.reason.trim() : "";
  if (reason) return reason;

  return teamRunStatusLabel(data.status);
}

export function teamEventRole(event: ConversationEvent): string | null {
  const data = parseTeamEventData(event);
  return "role" in data ? teamRoleLabel(data.role) : null;
}

export function teamSelectedRolesLabel(event: ConversationEvent): string | null {
  const data = parseTeamEventData(event);
  const selectedRoles = Array.isArray(data.selectedRoles) ? data.selectedRoles : [];
  const labels = selectedRoles
    .map((role) => teamRoleLabel(role))
    .filter((role) => role && role !== "Team");
  return labels.length > 0 ? labels.join("、") : null;
}

export function teamSkippedRolesLabel(event: ConversationEvent): string | null {
  const data = parseTeamEventData(event);
  const skippedRoles = Array.isArray(data.skippedRoles) ? data.skippedRoles : [];
  const labels = skippedRoles
    .map((role) => teamRoleLabel(role))
    .filter((role) => role && role !== "Team");
  return labels.length > 0 ? labels.join("、") : null;
}

export function teamEventSeverity(event: ConversationEvent): "normal" | "warning" | "danger" {
  if (teamSkippedRolesLabel(event)) return "warning";
  if (event.eventType === "team_task_verification_failed" || event.eventType === "team_task_human_review_required") {
    return "danger";
  }
  if (event.eventType === "team_task_retry") {
    return "warning";
  }

  const status = parseTeamEventData(event).status;
  if (status === "failed") return "danger";
  if (status === "revision_required" || status === "waiting_for_user" || status === "aborted") return "warning";
  return "normal";
}

export function teamPayloadSummary(prefix: string, payload: unknown): string {
  const data = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const summary = typeof data.summary === "string" && data.summary.trim().length > 0
    ? data.summary.trim()
    : undefined;
  return summary ? `${prefix}：${summary}` : `${prefix}：${teamRunStatusLabel(data.status)}`;
}
