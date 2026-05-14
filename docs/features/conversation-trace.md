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

独立 `/team/:conversationId?` 页面是 Team 模式的主工作台入口，采用左侧 Team 会话列表 + 右侧宽版工作台布局，适合发起和查看需求分析、头脑风暴和落地规划过程。页面可选择 Team 配置，使用需求分析/头脑风暴/落地规划提示模板，发起新会话或继续当前会话；左侧 Team 会话列表支持按标题、Team 名称和会话 ID 搜索，选中会话会同步到 URL，刷新后可恢复同一工作台。运行中的 Team 会话可直接在独立工作台终止。聊天页右侧 Team 面板和历史详情页也复用同一个 Team 工作台视图，聊天页右侧可跳转到对应独立工作台。运行中的事件来自 WebSocket，打开已有会话时会从 `/events` 接口恢复已落库事件。同一会话包含多个 Team Run 时，工作台会按 `runId` 切换查看。Team 工作台概览会显示当前状态、实际执行角色和风险数量，并展示 Owner 路由出的任务类型、协作策略和决策理由；任务视图会按 `taskId` 聚合 Team Task，展示角色、状态、最新摘要、更新时间和任务内事件摘要，并支持按全部、风险、进行中、已完成筛选；产出视图会按角色展示已完成任务的完整输出，并可复制当前 Run 或全部 Run 为 Markdown。新 Team 事件会直接携带完整 `output`；旧 Team 事件如果只保留了截断摘要，工作台会按角色 `agentId` 从会话消息中回填完整 assistant 正文。时间线视图保留当前 Run 的完整事件流，并支持按全部、风险、警告、Run、Task 筛选。当 `maxTotalTurns` 裁剪了角色时，工作台会展示被跳过的角色。

进入“历史对话”，选择任意会话后，详情面板也会展示同一类 Trace 信息：

- 事件类型：开始、结束、Agent 开始/结束、工具完成、交接、Team 过程、介入、错误等。
- Agent 或工具上下文。
- handoff 的来源、目标和原因。
- Team 模式下的 Owner 路由、任务创建、角色执行、审视和结束摘要。
- 错误摘要。
- 相对本次 Trace 起点的耗时。
