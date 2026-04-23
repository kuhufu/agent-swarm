# 前端会话运行态分桶机制

本文说明 `@agent-swarm/web` 如何按会话隔离缓存运行态，解决消息显示延迟、会话切换覆盖等问题。

## 1. 背景问题

旧实现同时维护两套状态：

- 当前会话实时状态：`messages / streamingMessages / agentStates / isActive`
- `runtimeStates` 会话缓存

切换会话时依赖 `snapshot/restore`。在 `conversation_created`、`swarm_start`、`message_update` 等事件乱序到达时，容易出现：

- 刚发送的用户消息被旧快照覆盖；
- 当前会话与目标会话状态互相污染；
- 刷新后才看到消息（因为是从历史接口重新拉取）。

## 2. 设计目标

- 以会话 ID 为唯一分组键，前端运行态天然隔离。
- WS 事件到达即按 `conversationId` 落入对应 bucket。
- 切换会话只切“指针”，不再做 `restore` 覆盖。
- 首条消息创建会话前，先进入草稿态；拿到 `conversationId` 后归并。

## 3. 核心数据结构

实现位于：

- `packages/web/src/stores/conversation.ts`
- `packages/web/src/composables/useWebSocket.ts`

### 3.1 `runtimeStates`

`Map<string, ConversationRuntimeState>`，每个会话一个 bucket：

- `messages`
- `streamingMessages`
- `agentStates`
- `isActive`

### 3.2 草稿 bucket

定义常量 `DRAFT_RUNTIME_ID = "__draft__"`。

用于承接“尚未拿到 conversationId 之前”的本地消息和事件。收到 `conversation_created` 后归并到真实会话 bucket。

## 4. 状态读写规则

### 4.1 单一状态源（SSOT）

`conversationStore` 中：

- `messages`
- `streamingMessages`
- `agentStates`
- `isActive`

都由 `runtimeStates[currentConversationId]`（无选中时取 `__draft__`）计算得出。

### 4.2 所有写入统一走 bucket

以下方法都通过 `conversationId` 定位 bucket 写入，不再区分“当前会话/非当前会话”：

- `addMessage`
- `upsertToolCall`
- `startStreamingMessage`
- `appendStreamDelta`
- `appendStreamThinkingDelta`
- `finalizeStream`
- `setAgentStatus`
- `setAgentName`
- `setActive`

## 5. 会话创建与草稿归并

在 WS `conversation_created` 事件中，前端执行：

1. `bindDraftToConversation(conversationId)`：把 `__draft__` 归并到目标会话 bucket；
2. `setCurrentConversation(conversationId)`：切换显示目标 bucket；
3. `applyConversationSettingsFromServer(payload)`：同步工具开关、Think、directModel 等会话偏好。

这样可以保证“发送后立即显示”的用户消息不会因后续事件覆盖消失。

## 6. 切换会话行为

`setCurrentConversation(id)` 现在只做：

- 校验并创建目标 bucket（不存在则初始化为空）；
- 更新 `currentConversationId`；
- 应用会话偏好配置。

不再做：

- `snapshotCurrentRuntimeState`
- `restoreRuntimeState`
- `clearMessages` 兜底覆盖

因此切换过程是纯视图切换，不会改写其他会话 runtime。

## 7. 与历史恢复的关系

`openConversation(id)` 行为：

- 若该会话 bucket 已存在活跃流式状态，优先保留内存态；
- 否则用后端历史消息填充该会话 bucket。

这与后端“历史消息恢复上下文”机制兼容，详见：

- `docs/context-recovery.md`

## 8. 调试建议

当出现“消息不显示/显示错会话”时，优先检查：

1. WS 事件是否携带正确 `conversationId`。
2. `conversation_created` 是否触发了 `bindDraftToConversation`。
3. `addMessage`/`appendStreamDelta` 的 `conversationId` 是否为空或错误。
4. 当前 UI 展示会话 ID 是否与写入 bucket 一致。
