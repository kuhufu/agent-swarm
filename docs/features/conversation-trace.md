# 会话执行 Trace

会话执行 Trace 用于查看一次对话运行中的关键事件，帮助定位多 Agent 协作、Team 过程、工具调用、handoff、人工介入和错误发生的位置。

## 后端接口

- `GET /api/conversations/:id/events`
- `GET /api/conversations/:id/events?type=handoff`
- `GET /api/conversations/:id/events?type=team_run_start`
- `GET /api/conversations/:id/events?type=team_task_completed`

接口会先按当前登录用户校验会话归属，再读取该会话的事件日志，返回格式：

```json
{
  "data": [
    {
      "id": "event-id",
      "agentId": "researcher",
      "eventType": "handoff",
      "eventData": "{\"fromAgentId\":\"router\",\"toAgentId\":\"researcher\"}",
      "timestamp": 1710000000000
    }
  ]
}
```

`eventData` 是序列化后的事件 payload，前端按需解析展示。

## 事件落库范围

事件落库受 `eventLogLevel` 控制：

- `none`：不持久化事件。
- `key`：只持久化关键事件，默认值。包含生命周期、Agent、轮次、消息完成、工具完成、handoff、Team Run/Task、介入和错误。
- `full`：持久化完整事件流。

历史对话详情页读取该接口并展示相对运行时间线；Team 事件会复用 Team 工作台聚合为任务视图和完整时间线。如果配置为 `none`，页面会显示暂无 Trace 事件。

## 前端入口

聊天页右侧和历史详情页都提供 Team 工作台，用于展示当前会话实时或已恢复的 Team 过程。运行中的事件来自 WebSocket，打开已有会话时会从 `/events` 接口恢复已落库事件。同一会话包含多个 Team Run 时，工作台会按 `runId` 切换查看。Team 工作台概览会显示当前状态、实际执行角色和风险数量；任务视图会按 `taskId` 聚合 Team Task，展示角色、状态、最新摘要、更新时间和任务内事件摘要，并支持按全部、风险、进行中、已完成筛选；时间线视图保留当前 Run 的完整事件流，并支持按全部、风险、警告、Run、Task 筛选。当 `maxTotalTurns` 裁剪了角色时，工作台会展示被跳过的角色。

进入“历史对话”，选择任意会话后，详情面板也会展示同一类 Trace 信息：

- 事件类型：开始、结束、Agent 开始/结束、工具完成、交接、Team 过程、介入、错误等。
- Agent 或工具上下文。
- handoff 的来源、目标和原因。
- Team 模式下的 Owner 路由、任务创建、角色执行、审视和结束摘要。
- 错误摘要。
- 相对本次 Trace 起点的耗时。
