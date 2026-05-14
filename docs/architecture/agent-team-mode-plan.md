# Agent Team 模式落地计划

本文档描述在 Agent Swarm 中落地 `team` 协作模式的实施方案。`team` 模式目标不是把多段 prompt 串起来，而是为复杂任务提供可追踪、可验证、可恢复的 Owner-Worker-Verifier 协作闭环。

> 当前项目已实现 `team` 模式的最小 MVP：Owner 私下路由、简单请求降级为单 Agent、复杂请求按通用角色执行，并通过现有会话事件流记录 Team Run / Team Task。聊天页和历史详情已能展示 Team 过程；本文后续章节仍包含未完成的演进计划。

## 目标

`team` 模式用于解决单 Agent 在复杂任务中的四类问题：

- 长任务中途停止或过早汇报。
- 上下文膨胀后指令遗漏、质量下降和自检失效。
- 长时间执行期间无法快速响应用户的新消息。
- 不同任务角色、工具权限、记忆和验收标准混在同一个 Agent 中。

当前 MVP 已实现一个受控 Team Engine 的基础闭环：

- 支持 Owner 拆解任务。
- 支持 Worker 执行子任务。
- 支持 Critic/Verifier 角色做独立审视。
- 使用确定性流程控制 Team Run / Team Task 的基本状态。
- 将所有关键过程写入事件流和持久化存储，便于前端 Trace 和恢复。
- Team 执行受 `maxTotalTurns` 限制；当任务预算不足以执行全部角色时，会优先保留 `synthesizer` 作为最后一步，即使只允许 1 个 Team 任务也优先产出最终汇总，避免只有发散或分析而没有交付答案。运行事件会通过 `plannedRoles` / `selectedRoles` / `skippedRoles` 记录原计划、实际执行角色和被预算裁剪的角色，并在结束摘要中说明是否包含独立审视和最终汇总。
- Critic 输出中明确出现 blocker、阻塞、严重风险、不可行等信号时，当前 MVP 会记录 `team_task_verification_failed`，Team Run 结束摘要会提示存在阻塞风险，并继续交给后续汇总角色吸收风险；聊天页和历史详情的 Team 工作台会用风险样式高亮这类事件。自动打回重试仍留作后续阶段。
- 内置 `Team Owner` Agent 模板，便于快速创建通用 `team` 模式 Swarm。
- 前端创建/编辑 Swarm 时选择 `Team` 模式，如果当前 Agent 列表为空，会自动加入 `Team Owner`，并优先填入已保存模型列表中的第一个模型。

当前 MVP 暂未实现独立 Team 数据表、并行执行、自动打回重试和独立 Team API；这些仍是后续阶段。当前前端已通过聊天页右侧和历史详情的 Team 工作台展示 Team 事件，后续可再演进成可操作的 Team 控制台。

## 非目标

第一阶段不做以下能力：

- Agent 任意创建无限数量的 Agent。
- Agent 之间绕过引擎直接互相调度。
- 所有 Agent 共享完整会话历史。
- 无上限重试或由模型自由决定停止条件。
- 把 Verifier 降级成一句自然语言“看起来没问题”的可选步骤。

## 核心角色

### Owner

Owner 是 Team 的控制面，负责理解用户目标和约束、判断是否需要启用 Team、拆分子任务并设置验收标准、为子任务选择 Worker 和 Verifier、合并 Worker 结果，以及在成本、风险或需求不清时升级给用户。

Owner 可以使用模型判断任务内容，但流程推进必须由 Team Engine 的状态机控制。

### Worker

Worker 负责具体执行。不同 Worker 可以拥有不同的 system prompt、enabled tools、workspace 访问范围、上下文摘要、输出 schema 和质量要求。通用 Team 中的 Worker 不固定为代码、研究或文档角色，而是由 Owner 根据用户问题选择合适的角色模板。

Worker 的输出必须结构化，至少包含：

- 结果摘要。
- 产物位置、结论摘要、候选方案或变更摘要。
- 已执行的验证。
- 未解决风险。
- 建议下一步。

### Verifier

Verifier 负责把“已完成”变成“可交付”。它不应复用 Worker 的完整上下文，只接收原始任务目标、子任务验收标准、Worker 输出，以及必要的证据、引用来源、用户约束、workspace 文件或工具结果。

Verifier 输出结构化结果：

```ts
interface TeamVerificationResult {
  passed: boolean;
  issues: Array<{
    severity: "blocker" | "major" | "minor";
    description: string;
    evidence?: string;
    requiredChange?: string;
  }>;
  confidence: "low" | "medium" | "high";
  summary: string;
}
```

## 适用场景

优先启用 Team 的任务：

- 需求分析、方案拆解、产品设计、技术选型和头脑风暴。
- 需要多视角讨论、正反论证或风险识别的问题。
- 需要多个来源交叉验证的研究任务。
- 正式文档、报告、表格、PPT 等可交付产物。
- 任务超过 3 个步骤，或有明显并行空间。
- 高风险操作，需要人工确认和完整过程记录。

不建议启用 Team 的任务：

- 简单问答。
- 单文件小改。
- 明确的一次性命令执行。
- 摘要一段已有文本。
- 低风险格式转换。

## MVP 范围

第一版建议实现通用 Team，由 Owner 先判断用户问题是否需要组队，并选择最小可行角色组合。需求分析和头脑风暴是首批优化场景，但不把 Team 固定成某一种业务模板。

```text
User
  -> Owner: 判断是否需要 Team、选择协作策略、拆分任务
  -> Worker A: 从一个视角分析问题或生成候选方案
  -> Worker B: 从另一个视角补充、反驳或扩展
  -> Verifier/Critic: 检查遗漏、冲突、证据和约束符合度
  -> Owner: 汇总、取舍、给出结构化结论和下一步建议
```

MVP 约束：

- `maxTasks = 5`
- `maxRetries = 2`
- `parallelism = 2`
- Owner 可以选择不启用 Team，直接降级为单 Agent 回复。
- 默认角色池只包含少量通用角色：Analyst、Ideator、Critic、Synthesizer、Researcher。
- 默认启用人工介入点：需求不清、范围扩大、结论冲突、超出重试、Verifier blocker、高风险工具。
- workspace 工具仍按现有 `workspaceId` 挂载规则注入；未挂载工作区时不提供 workspace 能力，但纯需求分析和头脑风暴不强依赖 workspace。

## Owner 路由策略

Owner 在每次用户请求开始时先做轻量路由，输出结构化决策：

```ts
interface TeamRoutingDecision {
  useTeam: boolean;
  reason: string;
  taskType:
    | "simple_chat"
    | "requirements_analysis"
    | "brainstorming"
    | "research"
    | "document"
    | "coding"
    | "mixed";
  strategy:
    | "single_agent"
    | "parallel_perspectives"
    | "sequential_refinement"
    | "research_then_synthesize"
    | "critique_and_revise";
  roles: Array<"analyst" | "ideator" | "critic" | "synthesizer" | "researcher" | "developer" | "tester" | "reviewer">;
  clarificationQuestion?: string;
}
```

路由规则：

- 简单问答、单步任务、低风险格式转换：`useTeam=false`。
- 需求分析：使用 Analyst + Critic + Synthesizer。
- 头脑风暴：使用多个 Ideator 并行产出，再由 Critic 收敛风险，Synthesizer 汇总。
- 研究任务：使用 Researcher 并行检索，Verifier 检查来源和时效性。
- 代码任务：仅在后续 Coding 模板成熟后启用 Developer / Tester / Reviewer。
- 需求明显不清时，Owner 先提澄清问题，不直接派发多个 Worker。

## 首批通用角色

### Analyst

负责把用户输入转成结构化需求，包括目标、用户、场景、约束、成功标准、未知问题和优先级。

### Ideator

负责发散候选方案。多个 Ideator 可以使用不同风格或视角，例如保守方案、激进方案、低成本方案、长期演进方案。

### Critic

负责审视方案中的缺口、风险、反例、成本、依赖和不可验证假设。Critic 不直接生成最终答案，只输出问题清单和改进建议。

### Synthesizer

负责合并多方观点，去重、排序、取舍，并生成用户可执行的最终结构。

### Researcher

在需要外部或知识库信息时启用，负责检索 Wiki、Documents 或 WebSearch，并输出带来源的证据摘要。

## 状态机

Team Run 状态：

```text
created
  -> planning
  -> running
  -> summarizing
  -> completed

planning/running/summarizing
  -> waiting_for_user
  -> running

planning/running/summarizing
  -> failed
  -> aborted
```

Team Task 状态：

```text
pending
  -> running
  -> verifying
  -> completed

verifying
  -> revision_required
  -> running

running/verifying
  -> waiting_for_user
  -> running

running/verifying
  -> failed
  -> skipped
```

关键规则：

- Worker 停止后必须进入 `verifying`，除非该任务显式标记为无需验证。
- Verifier `passed=false` 且 `retryCount < maxRetries` 时进入 `revision_required`。
- Verifier 发现 blocker、重试耗尽或成本超过预算时进入 `waiting_for_user`。
- Engine 决定是否继续、重试或停止；Agent 只能提出建议。

## 数据模型草案

```ts
type TeamRunStatus =
  | "created"
  | "planning"
  | "running"
  | "summarizing"
  | "waiting_for_user"
  | "completed"
  | "failed"
  | "aborted";

type TeamTaskStatus =
  | "pending"
  | "running"
  | "verifying"
  | "revision_required"
  | "waiting_for_user"
  | "completed"
  | "failed"
  | "skipped";

interface TeamRun {
  id: string;
  conversationId: string;
  userId: string;
  workspaceId: string | null;
  status: TeamRunStatus;
  goal: string;
  ownerAgentId: string;
  maxTasks: number;
  maxRetries: number;
  parallelism: number;
  createdAt: number;
  updatedAt: number;
}

interface TeamTask {
  id: string;
  runId: string;
  parentTaskId: string | null;
  status: TeamTaskStatus;
  title: string;
  goal: string;
  acceptanceCriteria: string[];
  workerAgentId: string;
  verifierAgentId: string | null;
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  retryCount: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}
```

建议新增 SQLite 表：

- `team_runs`
- `team_tasks`
- `team_task_events`
- `team_artifacts`

短期也可以把 Team 事件复用现有 conversation events 落库，但长期应保留独立查询能力。

## 事件设计

扩展 `SwarmEvent` 时建议新增 Team 事件类型：

- `team_run_start`
- `team_run_update`
- `team_run_end`
- `team_task_created`
- `team_task_started`
- `team_task_update`
- `team_task_completed`
- `team_task_verification_started`
- `team_task_verification_passed`
- `team_task_verification_failed`
- `team_task_retry`
- `team_task_human_review_required`

事件 payload 应包含：

- `runId`
- `taskId`
- `agentId`
- `status`
- `summary`
- `artifactIds`
- `retryCount`
- `issues`

前端 Trace、聊天工具卡和未来 Team 面板应使用同一套事件数据，避免运行时展示和历史恢复不一致。

## 上下文隔离

`team` 模式必须避免把所有信息塞进一个共享上下文。

推荐策略：

- Owner 持有用户目标、全局计划、任务状态摘要。
- Worker 只接收当前子任务、必要背景、相关文件路径和验收标准。
- Verifier 只接收验收标准、Worker 输出、必要证据。
- 大产物通过 workspace 文件、文档、Wiki 或 `team_artifacts` 引用传递。
- Agent 间交接使用结构化摘要，不直接拼接完整对话历史。

对于需求分析和头脑风暴 MVP：

- Analyst 只接收用户目标、背景材料和已有约束。
- Ideator 只接收发散方向、禁止项和目标用户，不接收其他 Ideator 的完整输出。
- Critic 接收候选方案和验收标准，重点检查遗漏、冲突、风险和假设。
- Synthesizer 接收结构化摘要和 Critic 意见，生成最终结论。

## 工具权限

工具注入继续走 `packages/core/src/tools/runtime.ts`。

建议为 Team 引入角色级工具策略：

```ts
interface TeamRoleToolPolicy {
  role: "owner" | "worker" | "verifier";
  enabledTools: string[];
  requiresApproval?: string[];
}
```

默认策略：

- Owner：允许查询上下文、读任务状态，不直接执行高风险写操作。
- Worker：按任务需要启用 workspace、knowledge、wiki、web_search。
- Verifier：默认只读；只在具体模板明确需要时启用执行型工具。

高风险动作必须进入介入机制：

- 删除文件。
- 大范围重写。
- 安装依赖。
- 外部网络访问。
- 提交、发布、部署。

## Core 实现落点

当前 MVP 实现为单文件入口，后续复杂度上来后再拆目录：

```text
packages/core/src/modes/team.ts
```

当前职责：

- `TeamMode`：对接现有 mode 执行接口，向 Conversation 暴露 AsyncGenerator 事件流。
- Owner 路由：使用私有 Owner Router 调用生成 `TeamRoutingDecision`，失败时用本地启发式 fallback，覆盖需求分析、头脑风暴、研究、落地规划/路线图和简单请求降级。
- 角色执行：基于首个 Agent 的模型和系统提示派生 Analyst / Ideator / Critic / Synthesizer / Researcher 等临时角色。
- 上下文隔离：临时角色创建后清空恢复历史，只接收当前任务和前序角色摘要。
- 事件输出：通过现有 `SwarmEvent` 扩展输出 Team Run / Team Task 事件。

后续可拆分：

- `team-engine.ts`：编排 run/task 生命周期、并发限制、重试、人工介入。
- `state-machine.ts`：集中定义 Team Run 和 Team Task 状态迁移。
- `planner.ts`：调用 Owner 生成结构化计划。
- `task-runner.ts`：调用 Worker 执行任务。
- `verifier.ts`：调用 Verifier 生成结构化验收结果。
- `context.ts`：构建角色隔离上下文。
- `prompts.ts`：集中维护 Owner/Worker/Verifier prompt。
- `types.ts`：Team 类型、事件 payload 和 schema。

`SwarmMode` 的 handoff、介入、循环保护和共享摘要可作为参考，但 `team` 不应复用 handoff 作为核心调度协议。Team 的任务推进应由 Engine 的状态机驱动。

## Server 实现落点

第一版可以复用会话 WebSocket 事件流，不新增独立长连接协议。

REST API 可按需新增：

- `GET /api/conversations/:id/team-runs`
- `GET /api/team-runs/:runId`
- `GET /api/team-runs/:runId/tasks`
- `POST /api/team-runs/:runId/abort`
- `POST /api/team-tasks/:taskId/retry`

也可以先只通过 `GET /api/conversations/:id/events` 查看 Team 事件，等 UI 稳定后再拆独立 API。

服务端校验要求：

- 所有 Team Run 必须按 `userId` 隔离。
- `conversationId`、`workspaceId`、`teamRunId` 的归属关系必须校验。
- 任务重试、终止、人工决策必须记录操作者。

## Web 实现落点

第一版 UI 不做复杂群聊，先做任务面板：

- Chat 主消息流仍展示用户和 Owner 的关键回复。
- 右侧或消息内嵌 Team Run 面板展示整体进度。
- Team Task 列表展示状态、角色、重试次数、Verifier 结果。
- 单个 Task 可展开查看输入、输出、工具调用、产物、验证意见。
- Trace 面板复用 Team 事件，支持历史恢复。

后续前端可继续拆分组件：

```text
packages/web/src/components/team/
  TeamRunPanel.vue
  TeamTaskList.vue
  TeamTaskDetail.vue
  VerificationResult.vue
```

模式选择上，`packages/web/src/constants/swarm-modes.ts` 已开放 `team` 选项；聊天页当前用中文通知消息展示 Team Run 级别进展，并用右侧 Team 工作台展示 Team Run / Team Task 明细，把 Analyst / Ideator / Critic / Synthesizer / Researcher 等内部角色映射成需求分析、方案发散、风险审视、结论汇总和研究调研。Team 工作台概览会显示当前状态、实际执行角色和风险数量；同一会话包含多个 Team Run 时可按 `runId` 切换；任务视图按 `taskId` 聚合角色、状态、摘要、更新时间和任务内事件，并支持按全部、风险、进行中、已完成筛选；时间线视图保留当前 Run 的完整事件流。预算裁剪、运行终止或风险审视失败会在工作台中高亮。历史对话详情页会读取 `/api/conversations/:id/events` 并复用同一个 Team 工作台展示已恢复事件，后续可继续拆独立 Team Run / Task API 和可操作的人工决策面板。

## 人工介入

Team 需要复用现有 intervention 机制，并新增触发场景：

- Owner 判断需求不清。
- Verifier 发现 blocker。
- 重试次数耗尽。
- 预计 token、时间或工具成本超限。
- 高风险工具调用。
- 最终交付前需要用户确认。

人工决策结果必须写回 Team Task：

- `approve`
- `reject`
- `edit_instruction`
- `skip_task`
- `abort_run`

## 验收标准

通用 Team MVP 的系统级验收：

- 能从用户需求创建 Team Run。
- Owner 能输出结构化路由决策，并在简单任务中降级为单 Agent。
- Owner 能为需求分析或头脑风暴生成不超过 `maxTasks` 的结构化任务计划。
- Worker 能按 Analyst / Ideator / Critic / Synthesizer 等通用角色输出结构化结果。
- Verifier/Critic 能基于目标、约束和候选方案给出遗漏、冲突、风险和改进建议。
- Critic 明确发现阻塞风险时能记录失败审视事件，并继续让后续汇总角色吸收风险。
- Team 事件能实时推送到 WebSocket，并能从历史事件恢复展示。
- 未挂载 workspace 时不会注入 workspace 工具；纯需求分析和头脑风暴仍可运行。
- 用户 abort 时能停止当前 Team Run，并清理相关运行中任务。

后续增强验收：

- 打回后 Worker 能按 Verifier 意见重试。
- 重试耗尽时进入人工介入。
- 增加独立 Team Run / Task 查询 API。
- Team 工作台支持按 run 聚合、任务详情和人工决策。

## 测试计划

Core 单元测试：

- Owner 路由决策。
- Team 降级为单 Agent 的分支。
- Team Run 状态迁移。
- Team Task 状态迁移。
- retry / maxRetries。
- Verifier passed / failed 分支。
- 人工介入分支。
- 上下文隔离构造。
- 角色级工具策略。

Server 测试：

- Team Run 查询的用户隔离。
- conversation/teamRun/workspace 归属校验。
- abort/retry 权限校验。
- WebSocket Team 事件广播。

Web 测试：

- Team Run 面板状态展示。
- Task 展开详情。
- Verifier issue 展示。
- 历史 Trace 恢复。
- abort 和人工决策交互。

## 分阶段实施

### Phase 1：类型与状态机

- 新增 Team 类型和状态机。
- 新增状态迁移测试。
- 暂不接入真实 Agent 执行。

### Phase 2：Team Engine 骨架

- 新增 `TeamMode` 和 `TeamEngine`。
- 使用 mock Owner/Worker/Verifier 跑通事件流。
- 写入 conversation events。

### Phase 3：Owner 路由与真实 Agent 执行

- Owner 输出 `TeamRoutingDecision`。
- Owner 生成结构化计划。
- Worker 执行子任务。
- Verifier 输出结构化验收。
- 接入 retry 和人工介入。

### Phase 4：需求分析 / 头脑风暴 MVP

- 定义 Analyst / Ideator / Critic / Synthesizer 预设。
- 增加需求分析任务 schema：目标、用户、场景、约束、成功标准、未知问题。
- 增加头脑风暴任务 schema：发散方向、候选方案、取舍标准、风险和推荐路径。
- 支持 Owner 在简单问题上不启用 Team。

### Phase 5：Server API 与 Web UI

- 增加 Team Run/Task 查询接口。
- 增加 Team Run 面板。
- Trace 支持 Team 事件。

### Phase 6：Research / Document / Coding 模板扩展

- Research Worker 支持多来源并行检索。
- Research Verifier 检查来源可复查性和时效性。
- Document Team 支持 Planner / Writer / Formatter / Evaluator。
- Coding Team 在 workspace、测试发现、补丁管理和审查策略成熟后再启用 Developer / Tester / Reviewer。

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| token 成本膨胀 | Team 比单 Agent 更贵 | 限制 maxTasks、parallelism、上下文摘要长度，按需加载细节 |
| Verifier 走过场 | 质量门禁失效 | 强制结构化 issue、证据、假设和 passed 字段，关键场景接入可验证证据 |
| Agent 自由调度失控 | 无限循环或越权 | 所有任务创建、重试和停止由 Engine 控制 |
| 上下文污染 | Worker/Verifier 判断偏差 | 角色上下文隔离，产物通过 artifact 引用 |
| UI 信息过载 | 用户无法理解过程 | 默认展示摘要，详情按任务展开 |
| 与 swarm handoff 概念混淆 | 架构边界不清 | `swarm` 继续是 handoff 协作，`team` 是任务状态机协作 |

## 开放问题

- `team` 应作为新的 `SwarmConfig.mode`，还是作为 conversation preference 启用的执行策略？
- Team Run 是否必须绑定 workspace，还是允许无 workspace 的纯需求分析、头脑风暴或研究 Team？
- Agent 预设库是否需要新增内置角色类型字段，例如 `roleKind = owner | worker | verifier`？
- Team 事件是否扩展现有 `SwarmEvent` union，还是新增更通用的 `CollaborationEvent` 命名？
- 是否需要为 Team artifact 建独立存储，还是复用 workspace artifact 和 conversation events？
