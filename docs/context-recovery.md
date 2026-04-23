# 历史消息恢复上下文机制

本文说明 Agent Swarm 如何从历史消息恢复模型上下文，以及“清空上下文但保留历史消息”的实现细节。

## 1. 设计目标

- 会话重开后，模型能继续基于历史消息回答。
- 支持“只清空运行时上下文，不删除历史消息”。
- 恢复边界可持久化，服务重启后仍生效。
- 避免依赖高频事件日志来判断上下文边界。

## 2. 核心数据结构

### 2.1 `messages` 表

每条消息都会持久化，关键字段：

- `conversation_id`
- `role` / `content` / `thinking` / `tool_calls` / `metadata`
- `timestamp`（逻辑时间）
- `created_at`（写库时间）

### 2.2 `conversations.context_reset_at`

`context_reset_at` 是“上下文重置边界时间戳”，语义是：

- 恢复上下文时，只加载 `created_at > context_reset_at` 的消息；
- 历史消息仍保留在 `messages` 表中用于展示/审计；
- `context_reset_at` 不存在时，恢复全部历史消息。

## 3. 写入流程

### 3.1 正常对话写入

在 `Conversation.prompt()` 中，用户消息先落库；后续 Agent 消息、工具结果等持续写入 `messages`。

### 3.2 清空上下文写入

调用 `AgentSwarm.clearConversationContext(conversationId)` 时：

1. 生成 `contextResetAt = Date.now()`；
2. 更新 `conversations.context_reset_at`；
3. 追加一条 `notification` 消息（内容为“已清空上下文...”），用于前端分割线展示与持久化。

注意：不会删除任何历史消息。

## 4. 恢复流程

调用 `AgentSwarm.resumeConversation(conversationId)` 时：

1. 读取 conversation 记录（拿到 `swarmId`、`contextResetAt`、直接对话模型配置等）；
2. 读取该会话全部消息；
3. 若存在 `contextResetAt`，按规则过滤：

```ts
const restoredMessages =
  typeof contextResetAt === "number"
    ? storedMessages.filter((m) => (m.createdAt ?? m.timestamp) > contextResetAt)
    : storedMessages;
```

4. 构造 `Conversation`，把 `restoredMessages` 注入；
5. 在首次创建 Agent 且 Agent 还没有状态消息时，把 `restoredMessages` 填入 `agent.state.messages`，完成上下文恢复。

## 5. 为什么优先用 `created_at`

过滤时优先 `created_at`，退化到 `timestamp`：

- `timestamp` 可能来自模型/客户端，不一定严格单调；
- `created_at` 是服务端写库时刻，更适合作为“恢复边界”的判定基准。

## 6. 与 `events` 表的关系

上下文恢复不再依赖 `events` 里的 `context_cleared` 事件，而是直接依赖 `conversations.context_reset_at`。

`events` 现在主要用于运行事件观测，并支持分级落库：

- `none`：不落事件
- `key`：只落关键事件（默认）
- `full`：全部事件

这可以显著降低 `events` 表增长速度。

## 7. 边界行为

- 过滤条件是严格大于：`created_at > context_reset_at`。
- 清空上下文后立刻恢复，如果没有新消息，恢复结果为空。
- 清空上下文后新写入的消息会被恢复。
- 历史消息列表始终完整可查（包含清空前后消息和通知消息）。

## 8. 关键代码位置

- `packages/core/src/core/swarm.ts`
  - `resumeConversation()`：恢复与过滤逻辑
  - `clearConversationContext()`：写入 `context_reset_at` + 通知消息
- `packages/core/src/core/conversation.ts`
  - `createAgentFn` 内恢复消息注入逻辑
  - `eventLogLevel` 事件分级落库逻辑
- `packages/core/src/storage/sqlite.ts`
  - `conversations` 表结构与 `context_reset_at` 列
  - `updateConversationContextReset()` 持久化方法
- `packages/core/src/storage/message-mapper.ts`
  - `storedToMessage()`：持久化消息恢复为模型上下文消息

## 9. 排查建议（SQL）

```sql
-- 1) 查看会话重置边界
SELECT id, context_reset_at
FROM conversations
WHERE id = ?;

-- 2) 查看该会话消息（含 created_at）
SELECT id, role, content, timestamp, created_at
FROM messages
WHERE conversation_id = ?
ORDER BY timestamp ASC;

-- 3) 计算“将被恢复”的消息数量
SELECT COUNT(*) AS restore_count
FROM messages
WHERE conversation_id = ?
  AND created_at > (
    SELECT context_reset_at FROM conversations WHERE id = ?
  );
```

