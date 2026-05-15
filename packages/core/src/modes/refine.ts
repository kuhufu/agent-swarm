import type { SwarmAgentConfig, SwarmEvent } from "../core/types.js";
import type { ModeExecutor, ModeExecutionContext } from "./types.js";
import type { StoredMessage } from "../storage/interface.js";
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

type RefineMessageType = "expansion" | "critique" | "final_report";

interface RefineMessageMetadata {
  type: RefineMessageType;
  runId: string;
  iteration: number;
  stepId: string;
  role: "expander" | "critic";
  approved?: boolean;
}

interface RefineTurn {
  iteration: number;
  expanded?: string;
  critique?: string;
  approved?: boolean;
}

interface RefineResumeState {
  runId: string;
  nextAction: "expand" | "critique" | "final_report";
  iteration: number;
  expanded?: string;
  turns: RefineTurn[];
}

interface RefineHistoryContext {
  latestFinalReport?: string;
  resumeTurns: RefineTurn[];
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

    const storedMessages = await ctx.storage.getMessages(ctx.conversationId);
    const latestFinalReport = this.loadLatestFinalReport(storedMessages);
    const resumeState = latestFinalReport ? undefined : this.buildResumeState(storedMessages);
    const runId = resumeState?.runId ?? crypto.randomUUID();
    const maxIterations = Math.max(1, Math.min(ctx.swarmConfig.maxTotalTurns ?? DEFAULT_MAX_ITERATIONS, DEFAULT_MAX_ITERATIONS));
    const results: RefineIterationResult[] = this.completedResultsFromTurns(resumeState?.turns ?? []);
    let finalReport = "";
    const historyContext: RefineHistoryContext = {
      latestFinalReport,
      resumeTurns: latestFinalReport ? [] : (resumeState?.turns ?? []),
    };

    yield* this.emitAndYield(ctx, {
      type: "refine_run_start",
      runId,
      conversationId: ctx.conversationId,
      status: "created",
      summary: latestFinalReport
        ? "打磨模式已启动。检测到上一轮最终报告，本次将在其基础上继续讨论。"
        : (
          resumeState
            ? "打磨模式已启动。检测到未完成的打磨过程，本次将从最近的完整步骤继续。"
            : "打磨模式已启动：拓展者会先完善输入，审视者随后评审并决定是否继续修订。"
        ),
      iteration: 0,
      maxIterations,
    });

    let iteration = resumeState?.iteration ?? 1;
    let pendingExpanded = resumeState?.nextAction === "critique" ? resumeState.expanded : undefined;
    let resumeFinalReport = resumeState?.nextAction === "final_report";
    if (resumeState?.nextAction === "expand" && iteration > maxIterations && results.length > 0) {
      iteration = results.at(-1)!.iteration;
      resumeFinalReport = true;
    }

    for (; iteration <= maxIterations; iteration += 1) {
      if (ctx.isAborted()) break;

      let expanded = pendingExpanded;
      pendingExpanded = undefined;

      if (!expanded && !resumeFinalReport) {
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

        expanded = this.getLastAssistantText(ctx, expander.id);
        await this.tagLatestAssistantMessage(ctx, expander.id, {
          type: "expansion",
          runId,
          iteration,
          stepId: expansionStepId,
          role: "expander",
        });
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
      }

      if (resumeFinalReport) {
        finalReport = yield* this.runFinalReport(ctx, runId, iteration, expander, historyContext, results, "审视者已通过，继续生成最终报告。");
        break;
      }

      if (!expanded) break;

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
      await this.tagLatestAssistantMessage(ctx, critic.id, {
        type: "critique",
        runId,
        iteration,
        stepId: reviewStepId,
        role: "critic",
        approved: decision.approved,
      });

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
    await ctx.storage.updateLatestAssistantMessageMetadata(
      ctx.conversationId,
      expander.id,
      {
        refine: {
          type: "final_report",
          runId,
          iteration,
          stepId,
          role: "expander",
        },
      },
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

  private async tagLatestAssistantMessage(
    ctx: ModeExecutionContext,
    agentId: string,
    refine: RefineMessageMetadata,
  ): Promise<void> {
    console.log("tagLatestAssistantMessage", agentId, refine);
    await ctx.storage.updateLatestAssistantMessageMetadata(ctx.conversationId, agentId, { refine });
  }

  private loadLatestFinalReport(messages: StoredMessage[]): string | undefined {
    const latest = messages
      .filter((message) => {
        const refine = this.parseRefineMetadata(message.metadata);
        return refine?.type === "final_report" && typeof message.content === "string" && message.content.trim().length > 0;
      })
      .sort((a, b) => (b.createdAt ?? b.timestamp) - (a.createdAt ?? a.timestamp))[0];
    return latest?.content?.trim();
  }

  private buildResumeState(messages: StoredMessage[]): RefineResumeState | undefined {
    const refineMessages = messages
      .map((message) => ({ message, refine: this.parseRefineMetadata(message.metadata) }))
      .filter((item): item is { message: StoredMessage; refine: RefineMessageMetadata } => Boolean(item.refine))
      .filter((item) => item.refine.type === "expansion" || item.refine.type === "critique")
      .sort((a, b) => (a.message.createdAt ?? a.message.timestamp) - (b.message.createdAt ?? b.message.timestamp));

    const latest = refineMessages.at(-1);
    if (!latest) return undefined;

    const runId = latest.refine.runId;
    const runMessages = refineMessages.filter((item) => item.refine.runId === runId);
    const turnsByIteration = new Map<number, RefineTurn>();

    for (const { message, refine } of runMessages) {
      const turn = turnsByIteration.get(refine.iteration) ?? { iteration: refine.iteration };
      if (refine.type === "expansion" && typeof message.content === "string") {
        turn.expanded = message.content;
      }
      if (refine.type === "critique" && typeof message.content === "string") {
        turn.critique = message.content;
        turn.approved = refine.approved === true;
      }
      turnsByIteration.set(refine.iteration, turn);
    }

    const turns = Array.from(turnsByIteration.values()).sort((a, b) => a.iteration - b.iteration);
    if (latest.refine.type === "expansion") {
      const expanded = typeof latest.message.content === "string" ? latest.message.content : undefined;
      if (!expanded) return undefined;
      return {
        runId,
        nextAction: "critique",
        iteration: latest.refine.iteration,
        expanded,
        turns,
      };
    }

    if (latest.refine.approved === true) {
      return {
        runId,
        nextAction: "final_report",
        iteration: latest.refine.iteration,
        turns,
      };
    }

    return {
      runId,
      nextAction: "expand",
      iteration: latest.refine.iteration + 1,
      turns,
    };
  }

  private parseRefineMetadata(raw: unknown): RefineMessageMetadata | undefined {
    const metadata = this.parseMetadata(raw);
    const refine = metadata?.refine;
    if (!refine || typeof refine !== "object" || Array.isArray(refine)) return undefined;
    const r = refine as Record<string, unknown>;
    if (
      (r.type !== "expansion" && r.type !== "critique" && r.type !== "final_report")
      || typeof r.runId !== "string"
      || typeof r.iteration !== "number"
      || typeof r.stepId !== "string"
      || (r.role !== "expander" && r.role !== "critic")
    ) {
      return undefined;
    }
    return {
      type: r.type,
      runId: r.runId,
      iteration: r.iteration,
      stepId: r.stepId,
      role: r.role,
      approved: typeof r.approved === "boolean" ? r.approved : undefined,
    };
  }

  private parseMetadata(raw: unknown): Record<string, unknown> | undefined {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
    if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : undefined;
    } catch {
      return undefined;
    }
  }

  private completedResultsFromTurns(turns: RefineTurn[]): RefineIterationResult[] {
    return turns
      .filter((turn): turn is RefineTurn & { expanded: string; critique: string; approved: boolean } =>
        typeof turn.expanded === "string"
        && typeof turn.critique === "string"
        && typeof turn.approved === "boolean",
      )
      .map((turn) => ({
        iteration: turn.iteration,
        expanded: turn.expanded,
        critique: turn.critique,
        approved: turn.approved,
      }));
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
      this.formatCompletedIterations(currentResults),
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
      this.formatCompletedIterations(currentResults),
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
      this.formatCompletedIterations(currentResults),
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
      "Recovered unfinished refine run context:",
      this.formatResumeTurns(historyContext.resumeTurns),
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

  private formatCompletedIterations(results: RefineIterationResult[]): string {
    if (results.length === 0) return "No completed iterations.";
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

  private formatResumeTurns(turns: RefineTurn[]): string {
    if (turns.length === 0) return "No recovered unfinished context.";
    return turns
      .map((turn) => [
        `## Iteration ${turn.iteration}`,
        turn.expanded ? ["### Expanded version", turn.expanded].join("\n") : undefined,
        turn.critique ? ["### Critique", turn.critique].join("\n") : undefined,
        typeof turn.approved === "boolean" ? `Approved: ${turn.approved}` : undefined,
      ].filter((line): line is string => Boolean(line)).join("\n"))
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
