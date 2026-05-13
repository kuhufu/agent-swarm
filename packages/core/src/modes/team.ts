import type {
  SwarmAgentConfig,
  SwarmEvent,
  TeamRole,
  TeamRoutingDecision,
  TeamStrategy,
  TeamTaskType,
} from "../core/types.js";
import { createAgent } from "../core/agent-factory.js";
import type { ModeExecutor, ModeExecutionContext } from "./types.js";
import { extractText, runAgent } from "./run-agent.js";

interface RoleResult {
  role: TeamRole;
  agentId: string;
  taskId: string;
  output: string;
}

const DEFAULT_MAX_TASKS = 5;

export class TeamMode implements ModeExecutor {
  async *execute(ctx: ModeExecutionContext): AsyncGenerator<SwarmEvent> {
    const ownerConfig = ctx.swarmConfig.agents[0];
    if (!ownerConfig || ctx.isAborted()) return;

    const runId = crypto.randomUUID();
    yield* this.emitAndYield(ctx, {
      type: "team_run_start",
      runId,
      conversationId: ctx.conversationId,
      status: "planning",
      summary: "Owner 正在判断是否需要组队协作。",
    });

    const routing = await this.route(ctx, ownerConfig);
    yield* this.emitAndYield(ctx, {
      type: "team_run_update",
      runId,
      conversationId: ctx.conversationId,
      status: routing.useTeam ? "planning" : "running",
      summary: routing.reason,
      routing,
    });

    if (ctx.isAborted()) return;

    if (routing.clarificationQuestion && routing.clarificationQuestion.trim().length > 0) {
      yield* this.runSingleAgent(ctx, ownerConfig, this.buildClarificationPrompt(ctx.message, routing));
      yield* this.emitAndYield(ctx, {
        type: "team_run_end",
        runId,
        conversationId: ctx.conversationId,
        status: "waiting_for_user",
        summary: "Owner 判断需要先澄清问题，再启动团队协作。",
        routing,
      });
      return;
    }

    if (!routing.useTeam || routing.strategy === "single_agent") {
      yield* this.runSingleAgent(ctx, ownerConfig, ctx.message);
      yield* this.emitAndYield(ctx, {
        type: "team_run_end",
        runId,
        conversationId: ctx.conversationId,
        status: "completed",
        summary: "Owner 判断该请求适合单 Agent 直接处理。",
        routing,
      });
      return;
    }

    yield* this.emitAndYield(ctx, {
      type: "team_run_update",
      runId,
      conversationId: ctx.conversationId,
      status: "running",
      summary: `Owner 已选择 ${this.describeStrategy(routing.strategy)}。`,
      routing,
    });

    const maxTasks = Math.max(1, Math.min(ctx.swarmConfig.maxTotalTurns ?? DEFAULT_MAX_TASKS, DEFAULT_MAX_TASKS));
    const plannedRoles = this.normalizeRoles(routing);
    const roles = this.selectRolesForRun(plannedRoles, maxTasks);
    const results: RoleResult[] = [];

    yield* this.emitAndYield(ctx, {
      type: "team_run_update",
      runId,
      conversationId: ctx.conversationId,
      status: "running",
      summary: this.buildRolePlanSummary(plannedRoles, roles),
      routing,
    });

    for (const [index, role] of roles.entries()) {
      if (ctx.isAborted()) break;

      const taskId = crypto.randomUUID();
      const agentConfig = this.createRoleAgentConfig(ownerConfig, role, index);
      this.ensureIsolatedAgent(ctx, agentConfig);

      yield* this.emitAndYield(ctx, {
        type: "team_task_created",
        runId,
        taskId,
        agentId: agentConfig.id,
        role,
        status: "pending",
        summary: this.describeRoleTask(role, routing),
        retryCount: 0,
      });
      yield* this.emitAndYield(ctx, {
        type: role === "critic" ? "team_task_verification_started" : "team_task_started",
        runId,
        taskId,
        agentId: agentConfig.id,
        role,
        status: role === "critic" ? "verifying" : "running",
        summary: this.describeRoleTask(role, routing),
        retryCount: 0,
      });

      const input = this.buildRolePrompt(ctx.message, routing, role, results);
      yield* runAgent(agentConfig.id, input, ctx);

      const output = this.getLastAssistantText(ctx, agentConfig.id);
      results.push({ role, agentId: agentConfig.id, taskId, output });
      const hasBlockingIssues = role === "critic" && this.hasBlockingCritique(output);

      yield* this.emitAndYield(ctx, {
        type: role === "critic"
          ? hasBlockingIssues ? "team_task_verification_failed" : "team_task_verification_passed"
          : "team_task_completed",
        runId,
        taskId,
        agentId: agentConfig.id,
        role,
        status: hasBlockingIssues ? "failed" : "completed",
        summary: this.truncate(output, 240),
        issues: hasBlockingIssues ? [this.truncate(output, 240)] : undefined,
        retryCount: 0,
      });
    }

    if (ctx.isAborted()) {
      yield* this.emitAndYield(ctx, {
        type: "team_run_end",
        runId,
        conversationId: ctx.conversationId,
        status: "aborted",
        summary: "Team 运行已终止。",
        routing,
      });
      return;
    }

    yield* this.emitAndYield(ctx, {
      type: "team_run_end",
      runId,
      conversationId: ctx.conversationId,
      status: "completed",
      summary: this.buildRunCompletionSummary(roles),
      routing,
    });
  }

  private async route(ctx: ModeExecutionContext, ownerConfig: SwarmAgentConfig): Promise<TeamRoutingDecision> {
    try {
      const router = createAgent({
        config: {
          ...ownerConfig,
          id: `${ownerConfig.id}__team_router`,
          name: "Team Owner Router",
          tools: [],
          systemPrompt: [
            "You are the Owner of a general-purpose agent team.",
            "Decide whether the user's request needs a team.",
            "Return only strict JSON with keys: useTeam, reason, taskType, strategy, roles, clarificationQuestion.",
            "Allowed taskType values: simple_chat, requirements_analysis, brainstorming, research, document, coding, mixed.",
            "Allowed strategy values: single_agent, parallel_perspectives, sequential_refinement, research_then_synthesize, critique_and_revise.",
            "Allowed roles: analyst, ideator, critic, synthesizer, researcher, developer, tester, reviewer.",
            "Prefer a small team. For requirements analysis use analyst, critic, synthesizer. For brainstorming use ideator, ideator, critic, synthesizer.",
            "If the request is simple, set useTeam=false and strategy=single_agent.",
          ].join("\n"),
        },
        llmConfig: ctx.llmConfig,
        interventionHandler: ctx.interventionHandler,
      });
      await router.prompt(this.buildRoutingPrompt(ctx.message));
      return this.parseRoutingDecision(this.extractLastAssistantText(router.state.messages));
    } catch {
      return this.fallbackRouting(ctx.message);
    }
  }

  private parseRoutingDecision(text: string): TeamRoutingDecision {
    const jsonText = this.extractJsonObject(text);
    const raw = JSON.parse(jsonText) as Record<string, unknown>;
    const taskType = this.normalizeTaskType(raw.taskType);
    const strategy = this.normalizeStrategy(raw.strategy, taskType);
    const roles = Array.isArray(raw.roles)
      ? raw.roles.map((role) => this.normalizeRole(role)).filter((role): role is TeamRole => Boolean(role))
      : [];
    return {
      useTeam: raw.useTeam === true,
      reason: typeof raw.reason === "string" && raw.reason.trim().length > 0
        ? raw.reason.trim()
        : "Owner routed the request.",
      taskType,
      strategy,
      roles,
      clarificationQuestion: typeof raw.clarificationQuestion === "string"
        ? raw.clarificationQuestion.trim() || undefined
        : undefined,
    };
  }

  private fallbackRouting(message: string): TeamRoutingDecision {
    const normalized = message.toLowerCase();
    const looksBrainstorm = /brainstorm|idea|ideas|头脑风暴|点子|创意|方案/.test(normalized);
    const looksRequirements = /需求|prd|requirement|需求分析|用户故事|验收标准|产品/.test(normalized);
    const looksResearch = /research|调研|资料|来源|搜索|竞品/.test(normalized);
    const isLong = message.length > 80;

    if (looksBrainstorm) {
      return {
        useTeam: true,
        reason: "这个请求适合先从多个角度发散方案，再做批判性筛选和汇总。",
        taskType: "brainstorming",
        strategy: "parallel_perspectives",
        roles: ["ideator", "ideator", "critic", "synthesizer"],
      };
    }
    if (looksRequirements) {
      return {
        useTeam: true,
        reason: "这个请求需要结构化需求分析、风险审视和结论汇总。",
        taskType: "requirements_analysis",
        strategy: "critique_and_revise",
        roles: ["analyst", "critic", "synthesizer"],
      };
    }
    if (looksResearch) {
      return {
        useTeam: true,
        reason: "这个请求需要先整理证据和背景，再进行批判性审视和综合。",
        taskType: "research",
        strategy: "research_then_synthesize",
        roles: ["researcher", "critic", "synthesizer"],
      };
    }
    return {
      useTeam: isLong,
      reason: isLong
        ? "这个请求范围较宽，适合通过分析、批判和汇总形成更稳妥的结论。"
        : "这个请求较简单，适合由单 Agent 直接处理。",
      taskType: isLong ? "mixed" : "simple_chat",
      strategy: isLong ? "critique_and_revise" : "single_agent",
      roles: isLong ? ["analyst", "critic", "synthesizer"] : [],
    };
  }

  private normalizeRoles(routing: TeamRoutingDecision): TeamRole[] {
    const roles = routing.roles.filter((role) => role !== "owner");
    const normalized = roles.length > 0 ? roles : this.defaultRolesForTaskType(routing.taskType);
    if (!normalized.includes("critic")) normalized.push("critic");
    if (!normalized.includes("synthesizer")) normalized.push("synthesizer");
    return normalized.slice(0, DEFAULT_MAX_TASKS);
  }

  private defaultRolesForTaskType(taskType: TeamTaskType): TeamRole[] {
    switch (taskType) {
      case "brainstorming":
        return ["ideator", "ideator", "critic", "synthesizer"];
      case "research":
        return ["researcher", "critic", "synthesizer"];
      case "requirements_analysis":
        return ["analyst", "critic", "synthesizer"];
      default:
        return ["analyst", "critic", "synthesizer"];
    }
  }

  private selectRolesForRun(roles: TeamRole[], maxTasks: number): TeamRole[] {
    if (roles.length <= maxTasks) return roles;
    const synthesizerIndex = roles.lastIndexOf("synthesizer");
    if (synthesizerIndex < 0 || maxTasks <= 1) return roles.slice(0, maxTasks);

    const selected = roles
      .filter((_, index) => index !== synthesizerIndex)
      .slice(0, maxTasks - 1);
    selected.push("synthesizer");
    return selected;
  }

  private buildRolePlanSummary(plannedRoles: TeamRole[], selectedRoles: TeamRole[]): string {
    const selected = selectedRoles.map((role) => this.describeRole(role)).join("、");
    if (selectedRoles.length >= plannedRoles.length) {
      return `Team 将执行：${selected}。`;
    }

    const skippedRoles = this.subtractSelectedRoles(plannedRoles, selectedRoles);
    const skipped = skippedRoles.map((role) => this.describeRole(role)).join("、");
    return `Team 将执行：${selected}；因任务预算限制，跳过：${skipped}。`;
  }

  private subtractSelectedRoles(plannedRoles: TeamRole[], selectedRoles: TeamRole[]): TeamRole[] {
    const remainingSelected = [...selectedRoles];
    const skipped: TeamRole[] = [];
    for (const role of plannedRoles) {
      const selectedIndex = remainingSelected.indexOf(role);
      if (selectedIndex >= 0) {
        remainingSelected.splice(selectedIndex, 1);
      } else {
        skipped.push(role);
      }
    }
    return skipped;
  }

  private buildRunCompletionSummary(roles: TeamRole[]): string {
    const hasCritic = roles.includes("critic");
    const hasSynthesizer = roles.includes("synthesizer");
    if (hasCritic && hasSynthesizer) return "Team 运行已完成，包含独立审视和最终汇总。";
    if (hasSynthesizer) return "Team 运行已完成，已输出最终汇总；本次未做独立审视。";
    if (hasCritic) return "Team 运行已完成，包含独立审视；本次未做最终汇总。";
    return "Team 运行已完成；本次未做独立审视和最终汇总。";
  }

  private hasBlockingCritique(output: string): boolean {
    return /(^|\b)(blocker|blocking|critical issue|not viable|infeasible)(\b|$)|阻塞|严重风险|不可行|无法落地/.test(output.toLowerCase());
  }

  private ensureIsolatedAgent(ctx: ModeExecutionContext, config: SwarmAgentConfig): void {
    if (!ctx.agents.has(config.id)) {
      ctx.createAgentFn(config);
      const active = ctx.agents.get(config.id);
      if (active) {
        active.agent.state.messages = [];
      }
    }
  }

  private async *runSingleAgent(
    ctx: ModeExecutionContext,
    agentConfig: SwarmAgentConfig,
    input: string,
  ): AsyncGenerator<SwarmEvent> {
    if (!ctx.agents.has(agentConfig.id)) {
      ctx.createAgentFn(agentConfig);
    }
    yield* runAgent(agentConfig.id, input, ctx);
  }

  private createRoleAgentConfig(base: SwarmAgentConfig, role: TeamRole, index: number): SwarmAgentConfig {
    return {
      ...base,
      id: `${base.id}__team_${role}_${index}`,
      name: this.roleName(role, index),
      description: `Team ${role} role`,
      systemPrompt: `${this.roleSystemPrompt(role)}\n\nBase instructions:\n${base.systemPrompt}`,
    };
  }

  private buildRoutingPrompt(message: string): string {
    return [
      "Route this user request for a general team mode.",
      "Use the user's language when writing reason or clarificationQuestion.",
      "Return strict JSON only.",
      "",
      "User request:",
      message,
    ].join("\n");
  }

  private buildClarificationPrompt(message: string, routing: TeamRoutingDecision): string {
    return [
      "The user request needs clarification before starting a team run.",
      "Ask exactly one concise clarification question in the user's language.",
      "",
      `Original request: ${message}`,
      `Clarification question: ${routing.clarificationQuestion ?? ""}`,
    ].join("\n");
  }

  private buildRolePrompt(
    message: string,
    routing: TeamRoutingDecision,
    role: TeamRole,
    previousResults: RoleResult[],
  ): string {
    const prior = previousResults.length > 0
      ? previousResults.map((result) => `## ${result.role}\n${result.output}`).join("\n\n")
      : "No previous role outputs yet.";
    return [
      `You are the ${role} in a general-purpose agent team.`,
      "Answer in the user's language.",
      `Task type: ${routing.taskType}`,
      `Strategy: ${routing.strategy}`,
      `Owner reason: ${routing.reason}`,
      "",
      "User request:",
      message,
      "",
      "Previous role outputs:",
      prior,
      "",
      this.roleOutputInstruction(role),
    ].join("\n");
  }

  private roleSystemPrompt(role: TeamRole): string {
    switch (role) {
      case "analyst":
        return "You structure ambiguous requests into goals, users, scenarios, constraints, success criteria, unknowns, and priorities.";
      case "ideator":
        return "You generate distinct candidate ideas and explain their tradeoffs. Favor breadth before convergence.";
      case "critic":
        return "You critique proposals by finding gaps, conflicts, risks, hidden assumptions, missing evidence, and edge cases.";
      case "synthesizer":
        return "You synthesize prior role outputs into a concise final answer with recommended next steps.";
      case "researcher":
        return "You gather and organize evidence from available context and tools. Separate evidence from assumptions.";
      case "developer":
        return "You reason about implementation options but do not assume code changes are required unless explicitly requested.";
      case "tester":
        return "You identify validation strategies, acceptance checks, and failure cases.";
      case "reviewer":
        return "You review plans for maintainability, compatibility, risks, and project constraints.";
      default:
        return "You contribute to a general-purpose agent team.";
    }
  }

  private roleOutputInstruction(role: TeamRole): string {
    switch (role) {
      case "synthesizer":
        return "Produce the final consolidated response. Include the recommendation, rationale, tradeoffs, and concrete next steps.";
      case "critic":
        return "Produce a structured critique with blockers, major risks, minor concerns, and suggested improvements.";
      case "ideator":
        return "Produce several distinct options. For each option, include value, cost, risk, and when to choose it.";
      case "analyst":
        return "Produce structured requirements: goal, target users, use cases, constraints, success criteria, open questions, and priority.";
      default:
        return "Produce a concise structured result that can be used by later team roles.";
    }
  }

  private describeRoleTask(role: TeamRole, routing: TeamRoutingDecision): string {
    return `${this.describeRole(role)}负责${this.describeTaskType(routing.taskType)}，协作方式为${this.describeStrategy(routing.strategy)}。`;
  }

  private describeRole(role: TeamRole): string {
    switch (role) {
      case "analyst": return "分析角色";
      case "ideator": return "创意角色";
      case "critic": return "批判审视角色";
      case "synthesizer": return "汇总角色";
      case "researcher": return "研究角色";
      case "developer": return "实现分析角色";
      case "tester": return "验证角色";
      case "reviewer": return "评审角色";
      case "owner": return "Owner";
      default: return role;
    }
  }

  private describeTaskType(taskType: TeamTaskType): string {
    switch (taskType) {
      case "simple_chat": return "简单问答";
      case "requirements_analysis": return "需求分析";
      case "brainstorming": return "头脑风暴";
      case "research": return "研究调研";
      case "document": return "文档任务";
      case "coding": return "实现任务";
      case "mixed": return "综合任务";
      default: return taskType;
    }
  }

  private describeStrategy(strategy: TeamStrategy): string {
    switch (strategy) {
      case "single_agent": return "单 Agent 处理";
      case "parallel_perspectives": return "多视角并行发散";
      case "sequential_refinement": return "顺序递进完善";
      case "research_then_synthesize": return "先研究再汇总";
      case "critique_and_revise": return "先产出再批判修订";
      default: return strategy;
    }
  }

  private getLastAssistantText(ctx: ModeExecutionContext, agentId: string): string {
    const active = ctx.agents.get(agentId);
    if (!active) return "";
    return this.extractLastAssistantText(active.agent.state.messages);
  }

  private extractLastAssistantText(messages: unknown[]): string {
    const lastAssistant = [...messages].reverse().find((message: any) => message?.role === "assistant") as
      | { content?: unknown }
      | undefined;
    return lastAssistant ? extractText(lastAssistant.content) : "";
  }

  private extractJsonObject(text: string): string {
    const trimmed = text.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
    throw new Error("No JSON object found in routing response");
  }

  private normalizeTaskType(value: unknown): TeamTaskType {
    const allowed: TeamTaskType[] = ["simple_chat", "requirements_analysis", "brainstorming", "research", "document", "coding", "mixed"];
    return typeof value === "string" && allowed.includes(value as TeamTaskType) ? value as TeamTaskType : "mixed";
  }

  private normalizeStrategy(value: unknown, taskType: TeamTaskType): TeamStrategy {
    const allowed: TeamStrategy[] = ["single_agent", "parallel_perspectives", "sequential_refinement", "research_then_synthesize", "critique_and_revise"];
    if (typeof value === "string" && allowed.includes(value as TeamStrategy)) return value as TeamStrategy;
    if (taskType === "research") return "research_then_synthesize";
    if (taskType === "brainstorming") return "parallel_perspectives";
    if (taskType === "simple_chat") return "single_agent";
    return "critique_and_revise";
  }

  private normalizeRole(value: unknown): TeamRole | undefined {
    const allowed: TeamRole[] = ["owner", "analyst", "ideator", "critic", "synthesizer", "researcher", "developer", "tester", "reviewer"];
    return typeof value === "string" && allowed.includes(value as TeamRole) ? value as TeamRole : undefined;
  }

  private roleName(role: TeamRole, index: number): string {
    const suffix = role === "ideator" ? ` ${index + 1}` : "";
    return `Team ${role}${suffix}`;
  }

  private truncate(text: string, maxChars: number): string {
    return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
  }

  private async *emitAndYield(ctx: ModeExecutionContext, event: SwarmEvent): AsyncGenerator<SwarmEvent> {
    ctx.emit(event);
    yield event;
  }
}
