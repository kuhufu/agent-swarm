import type { SwarmAgentConfig, SwarmEvent } from "../core/types.js";
import type { ModeExecutor, ModeExecutionContext } from "./types.js";
import { extractText, runAgent } from "./run-agent.js";

interface RefineIterationResult {
  iteration: number;
  expanded: string;
  critique: string;
  approved: boolean;
}

interface CriticDecision {
  approved: boolean;
  reason: string;
}

const DEFAULT_MAX_ITERATIONS = 3;
const REFINE_RESULTS_METADATA_KEY = "refineResults";

interface RefineHistoryContext {
  previousResults: RefineIterationResult[];
  latestFinalReport?: string;
}

export class RefineMode implements ModeExecutor {
  async *execute(ctx: ModeExecutionContext): AsyncGenerator<SwarmEvent> {
    const baseExpander = ctx.swarmConfig.agents[0];
    if (!baseExpander || ctx.isAborted()) return;

    const baseCritic = ctx.swarmConfig.agents[1] ?? baseExpander;
    const expander = this.createRoleAgentConfig(baseExpander, "expander");
    const critic = this.createRoleAgentConfig(baseCritic, "critic");
    this.ensureIsolatedAgent(ctx, expander);
    this.ensureIsolatedAgent(ctx, critic);

    const runId = crypto.randomUUID();
    const maxIterations = Math.max(1, Math.min(ctx.swarmConfig.maxTotalTurns ?? DEFAULT_MAX_ITERATIONS, DEFAULT_MAX_ITERATIONS));
    const results: RefineIterationResult[] = [];
    let finalReport = "";

    const previousResults = this.parsePreviousResults(ctx.getMetadata(REFINE_RESULTS_METADATA_KEY));
    const latestFinalReport = await this.loadLatestFinalReport(ctx);
    const historyContext: RefineHistoryContext = {
      previousResults,
      latestFinalReport,
    };

    yield* this.emitAndYield(ctx, {
      type: "refine_run_start",
      runId,
      conversationId: ctx.conversationId,
      status: "created",
      summary: latestFinalReport
        ? "打磨模式已启动。检测到上一轮最终报告，本次将在其基础上继续讨论。"
        : (
          previousResults.length > 0
            ? `打磨模式已启动。检测到之前 ${previousResults.length} 轮的打磨记录，本次将在历史基础上继续讨论。`
            : "打磨模式已启动：拓展者会先完善输入，审视者随后评审并决定是否继续修订。"
        ),
      iteration: 0,
      maxIterations,
    });

    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      if (ctx.isAborted()) break;

      yield* this.emitAndYield(ctx, {
        type: "refine_run_update",
        runId,
        conversationId: ctx.conversationId,
        status: iteration === 1 ? "running" : "revising",
        summary: `第 ${iteration} 轮：拓展者正在完善当前版本。`,
        iteration,
        maxIterations,
      });

      const expansionStepId = crypto.randomUUID();
      yield* this.emitAndYield(ctx, {
        type: "refine_step_started",
        runId,
        stepId: expansionStepId,
        iteration,
        agentId: expander.id,
        role: "expander",
        status: "running",
        summary: `第 ${iteration} 轮拓展开始。`,
      });

      yield* runAgent(expander.id, this.buildExpansionPrompt(ctx.message, iteration, historyContext, results), ctx);
      if (ctx.isAborted()) break;

      const expanded = this.getLastAssistantText(ctx, expander.id);
      yield* this.emitAndYield(ctx, {
        type: "refine_step_completed",
        runId,
        stepId: expansionStepId,
        iteration,
        agentId: expander.id,
        role: "expander",
        status: "completed",
        summary: this.truncate(expanded, 240),
        output: expanded,
      });

      yield* this.emitAndYield(ctx, {
        type: "refine_run_update",
        runId,
        conversationId: ctx.conversationId,
        status: "reviewing",
        summary: `第 ${iteration} 轮：审视者正在检查当前版本。`,
        iteration,
        maxIterations,
      });

      const reviewStepId = crypto.randomUUID();
      yield* this.emitAndYield(ctx, {
        type: "refine_review_started",
        runId,
        stepId: reviewStepId,
        iteration,
        agentId: critic.id,
        role: "critic",
        status: "running",
        summary: `第 ${iteration} 轮审视开始。`,
      });

      yield* runAgent(critic.id, this.buildCritiquePrompt(ctx.message, iteration, expanded, historyContext, results), ctx);
      if (ctx.isAborted()) break;

      const critique = this.getLastAssistantText(ctx, critic.id);
      const decision = this.parseCriticDecision(critique);
      results.push({ iteration, expanded, critique, approved: decision.approved });

      yield* this.emitAndYield(ctx, {
        type: "refine_review_completed",
        runId,
        stepId: reviewStepId,
        iteration,
        agentId: critic.id,
        role: "critic",
        status: decision.approved ? "approved" : "revision_required",
        summary: decision.reason || this.truncate(critique, 240),
        output: critique,
        feedback: critique,
        approved: decision.approved,
      });

      if (decision.approved) {
        finalReport = yield* this.runFinalReport(ctx, runId, iteration, expander, historyContext, results, "审视者判断当前版本已达到实用可落地标准。");
        break;
      }

      if (iteration >= maxIterations) {
        finalReport = yield* this.runFinalReport(ctx, runId, iteration, expander, historyContext, results, "已达到默认轮次上限，基于当前最佳版本生成最终报告。");
        break;
      }

      yield* this.emitAndYield(ctx, {
        type: "refine_revision_requested",
        runId,
        stepId: crypto.randomUUID(),
        iteration,
        agentId: critic.id,
        role: "critic",
        status: "revision_required",
        summary: "审视者要求拓展者基于反馈继续修订。",
        feedback: critique,
        approved: false,
      });
    }

    if (ctx.isAborted()) {
      yield* this.emitAndYield(ctx, {
        type: "refine_run_end",
        runId,
        conversationId: ctx.conversationId,
        status: "aborted",
        summary: "打磨运行已终止。",
        iteration: results.at(-1)?.iteration ?? 0,
        maxIterations,
      });
      return;
    }

    const allResults = [...previousResults, ...results];
    await ctx.setMetadata(REFINE_RESULTS_METADATA_KEY, allResults);

    yield* this.emitAndYield(ctx, {
      type: "refine_run_end",
      runId,
      conversationId: ctx.conversationId,
      status: "completed",
      summary: finalReport ? this.truncate(finalReport, 240) : "打磨运行已完成。",
      iteration: results.at(-1)?.iteration ?? 0,
      maxIterations,
    });
  }

  private async *runFinalReport(
    ctx: ModeExecutionContext,
    runId: string,
    iteration: number,
    expander: SwarmAgentConfig,
    historyContext: RefineHistoryContext,
    currentResults: RefineIterationResult[],
    reason: string,
  ): AsyncGenerator<SwarmEvent, string> {
    const stepId = crypto.randomUUID();
    yield* this.emitAndYield(ctx, {
      type: "refine_final_report_started",
      runId,
      stepId,
      iteration,
      agentId: expander.id,
      role: "expander",
      status: "running",
      summary: reason,
    });

    yield* runAgent(expander.id, this.buildFinalReportPrompt(ctx.message, historyContext, currentResults, reason), ctx);
    const output = this.getLastAssistantText(ctx, expander.id);
    await ctx.storage.updateLatestAssistantMessageRole(
      ctx.conversationId,
      expander.id,
      "final_report",
      { type: "refine_final_report" },
    );

    yield* this.emitAndYield(ctx, {
      type: "refine_final_report_completed",
      runId,
      stepId,
      iteration,
      agentId: expander.id,
      role: "expander",
      status: "completed",
      summary: this.truncate(output, 240),
      output,
    });
    return output;
  }

  private parsePreviousResults(raw: unknown): RefineIterationResult[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is RefineIterationResult => {
      if (typeof item !== "object" || item === null) return false;
      const r = item as Record<string, unknown>;
      return (
        typeof r.iteration === "number" &&
        typeof r.expanded === "string" &&
        typeof r.critique === "string" &&
        typeof r.approved === "boolean"
      );
    });
  }

  private async loadLatestFinalReport(ctx: ModeExecutionContext): Promise<string | undefined> {
    const messages = await ctx.storage.getMessages(ctx.conversationId);
    const latest = messages
      .filter((message) => message.role === "final_report" && typeof message.content === "string" && message.content.trim().length > 0)
      .sort((a, b) => (b.createdAt ?? b.timestamp) - (a.createdAt ?? a.timestamp))[0];
    return latest?.content?.trim();
  }

  private createRoleAgentConfig(base: SwarmAgentConfig, role: "expander" | "critic"): SwarmAgentConfig {
    return {
      ...base,
      id: `${base.id}__refine_${role}`,
      name: role === "expander" ? "Refine Expander" : "Refine Critic",
      description: role === "expander" ? "打磨模式拓展者" : "打磨模式审视者",
      systemPrompt: `${this.roleSystemPrompt(role)}\n\nBase instructions:\n${base.systemPrompt}`,
    };
  }

  private roleSystemPrompt(role: "expander" | "critic"): string {
    if (role === "critic") {
      return [
        "You are the Critic in a human-in-the-loop critique-and-revise workflow.",
        "Your job is to review the Expander's version from value, feasibility, risks, hidden assumptions, missing user context, and next-step clarity.",
        "Use ask_user when user input is needed. You may ask multiple questions if needed.",
        "If the version is practical enough to act on, clearly state APPROVED: true.",
        "If it still needs revision, clearly state APPROVED: false and provide concrete feedback for the Expander.",
        "Answer in the user's language.",
      ].join("\n");
    }
    return [
      "You are the Expander in a human-in-the-loop critique-and-revise workflow.",
      "Your job is to expand, structure, and revise the user's raw input into a clearer, more useful artifact.",
      "Use ask_user when user input is needed. You may ask multiple questions if needed.",
      "When writing the final report, produce a structured report with: 核心想法、背景与问题、目标用户与场景、完善后的方案、用户价值、风险与反对意见、待验证问题、下一步行动.",
      "Answer in the user's language.",
    ].join("\n");
  }

  private buildExpansionPrompt(
    message: string,
    iteration: number,
    historyContext: RefineHistoryContext,
    currentResults: RefineIterationResult[],
  ): string {
    return [
      `This is iteration ${iteration} of a Refine workflow.`,
      "Expand and improve the user's input. If previous critique exists, revise directly against it.",
      "If more user context is necessary, use ask_user before finalizing your version.",
      "",
      "Original user input:",
      message,
      "",
      this.formatHistoryContext(historyContext),
      "",
      "Current run iterations:",
      this.formatPreviousIterations(currentResults),
      "",
      "Output a clear current version that the Critic can review.",
    ].join("\n");
  }

  private buildCritiquePrompt(
    message: string,
    iteration: number,
    expanded: string,
    historyContext: RefineHistoryContext,
    currentResults: RefineIterationResult[],
  ): string {
    return [
      `This is iteration ${iteration} of a Refine workflow.`,
      "Review the Expander's current version. Use a practical feasibility bar: approve when value, key risks, and next steps are clear enough to act on.",
      "If user context is necessary, use ask_user before making the decision.",
      "End with a clear decision line: APPROVED: true or APPROVED: false.",
      "",
      "Original user input:",
      message,
      "",
      this.formatHistoryContext(historyContext),
      "",
      "Current run iterations:",
      this.formatPreviousIterations(currentResults),
      "",
      "Current version from Expander:",
      expanded,
      "",
      "Output review feedback for the Expander and the decision line.",
    ].join("\n");
  }

  private buildFinalReportPrompt(
    message: string,
    historyContext: RefineHistoryContext,
    currentResults: RefineIterationResult[],
    reason: string,
  ): string {
    return [
      "Generate the final report for this Refine workflow.",
      `Reason for finalization: ${reason}`,
      "Use the user's language.",
      "Use this exact report structure: 核心想法、背景与问题、目标用户与场景、完善后的方案、用户价值、风险与反对意见、待验证问题、下一步行动.",
      "",
      "Original user input:",
      message,
      "",
      this.formatHistoryContext(historyContext),
      "",
      "Current run iterations:",
      this.formatPreviousIterations(currentResults),
    ].join("\n");
  }

  private formatHistoryContext(historyContext: RefineHistoryContext): string {
    if (historyContext.latestFinalReport) {
      return [
        "Previous final report from the last completed run:",
        historyContext.latestFinalReport,
      ].join("\n");
    }
    return [
      "Historical iterations from previous runs:",
      this.formatPreviousIterations(historyContext.previousResults),
    ].join("\n");
  }

  private parseCriticDecision(output: string): CriticDecision {
    const normalized = output.toLowerCase();
    if (/approved\s*:\s*true|通过|可以进入最终报告|可以生成最终报告/.test(normalized)) {
      return { approved: true, reason: "审视者判断当前版本已通过。" };
    }
    if (/approved\s*:\s*false|不通过|需要继续|继续修订|revision required|revise/.test(normalized)) {
      return { approved: false, reason: "审视者要求继续修订。" };
    }
    return { approved: false, reason: this.truncate(output, 240) };
  }

  private formatPreviousIterations(results: RefineIterationResult[]): string {
    if (results.length === 0) return "No previous iterations.";
    return results
      .map((result) => [
        `## Iteration ${result.iteration}`,
        `Approved: ${result.approved}`,
        "### Expanded version",
        result.expanded,
        "### Critique",
        result.critique,
      ].join("\n"))
      .join("\n\n");
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

  private getLastAssistantText(ctx: ModeExecutionContext, agentId: string): string {
    const active = ctx.agents.get(agentId);
    if (!active) return "";
    const lastAssistant = [...active.agent.state.messages].reverse().find((message: any) => message?.role === "assistant") as
      | { content?: unknown }
      | undefined;
    return lastAssistant ? extractText(lastAssistant.content) : "";
  }

  private truncate(text: string, maxChars: number): string {
    return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
  }

  private async *emitAndYield(ctx: ModeExecutionContext, event: SwarmEvent): AsyncGenerator<SwarmEvent> {
    ctx.emit(event);
    yield event;
  }
}
