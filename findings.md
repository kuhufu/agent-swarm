# Findings: Agent Team 落地计划

## Project Context

- 当前 README 的核心能力仍是三种协作模式：`chat` / `swarm` / `debate`。
- `packages/core/src/modes/` 下已有 `chat.ts`、`swarm-mode.ts`、`debate.ts`、`run-agent.ts`、事件映射和消息持久化辅助。
- `packages/core/src/tools/runtime.ts` 是工具注入统一入口；workspace 是组合 RuntimeTool，未挂载 `workspaceId` 时不注入。
- `SwarmMode` 已有 handoff 协议、介入审批、循环保护、共享上下文摘要，可作为 `team` mode 调度设计的参考，但 `team` 应使用确定性状态机控制执行和验证闭环。
- 前端已有聊天页、Agent 状态、Trace、Workspace artifacts，可增量扩展为 Team Run / Team Task 面板。

## Article-Derived Requirements

- Agent Team 应解决单 Agent 在长任务中的停顿、退化、响应阻塞和角色混杂问题。
- 核心角色为 Owner、Worker、Verifier。
- 重点不是 prompt 编排，而是任务状态、权限、上下文隔离、过程追踪和可恢复执行。
- Verifier 应是架构核心，负责把 Worker 输出从“完成”推进到“可交付”。
- Team 不是默认模式，适用于复杂、长链路、高风险、可复用经验的任务。

## Implementation Bias

- 第一版应做通用 Team，由 Owner 根据用户问题决定是否组队、选择角色和协作策略。
- 需求分析和头脑风暴是首批优化场景；Coding Team 作为后续专用模板，不作为 MVP 默认目标。
- 避免一开始支持任意 Agent 自由互调，先用 Owner 路由、引擎层白名单操作和有限状态机。
- 中间结果优先写入结构化任务记录和 workspace 文件，而不是拼进一个巨大上下文。
