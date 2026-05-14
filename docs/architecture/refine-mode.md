# Refine 打磨模式

`refine` 是独立协作模式，不挂在 `team` 下面。它对应 Human-in-the-loop Critique-and-Revise：一个 Agent 负责生成、拓展和修订，另一个 Agent 负责审视、追问、反馈和通过判断。

## 执行协议

`packages/core/src/modes/refine.ts` 实现固定双角色循环：

- 拓展者：基于用户输入、历史轮次和审视反馈生成当前版本；信息不足时可使用 `ask_user` 连续追问。
- 审视者：从用户价值、落地可行性、风险、隐藏假设和下一步清晰度审视当前版本；信息不足时可使用 `ask_user` 连续追问。
- 审视者每轮结尾应输出 `APPROVED: true` 或 `APPROVED: false`。
- `APPROVED: true` 时提前生成最终报告。
- 未通过且达到轮次上限时，基于当前最佳版本生成最终报告。

`maxTotalTurns` 在该模式下表示最大打磨轮数，默认最多 3 轮。

## 事件

Refine 使用独立事件，避免混用 Team 语义：

- `refine_run_start`
- `refine_run_update`
- `refine_run_end`
- `refine_step_started`
- `refine_step_completed`
- `refine_review_started`
- `refine_review_completed`
- `refine_revision_requested`
- `refine_final_report_started`
- `refine_final_report_completed`

这些事件会在 `eventLogLevel = key` 或 `full` 时落库，可通过 `/api/conversations/:id/events?type=refine_run_start` 等方式过滤。

## 前端入口

创建或编辑 Swarm 时选择 `Refine 打磨` 模式。如果当前 Agent 列表为空，前端会自动加入内置 `Refine Expander` 和 `Refine Critic`，并用已保存模型列表中的第一个模型补齐空模型。

聊天 WebSocket 会展示打磨开始、轮次更新和结束通知，并更新拓展者/审视者的运行状态。`ask_user` 仍显示在聊天输入框上方，用于拓展者和审视者向用户追问。

## 最终报告

最终报告使用固定结构：

- 核心想法
- 背景与问题
- 目标用户与场景
- 完善后的方案
- 用户价值
- 风险与反对意见
- 待验证问题
- 下一步行动
