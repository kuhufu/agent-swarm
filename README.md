# Agent Swarm

基于 `@mariozechner/pi-agent-core` 的多 Agent 协作框架，提供：

- `@agent-swarm/core`：协作编排与持久化 SDK
- `@agent-swarm/server`：Express + WebSocket API 服务
- `@agent-swarm/web`：Vue 3 可视化管理与对话界面

## 核心能力

- 五种协作模式：`router` / `sequential` / `parallel` / `swarm` / `debate`
- 直接对话模式：无需预建 swarm，可按会话选择 `provider + modelId`
- 输入体验优化：重复点击“新对话/直接对话”、切换模型、启停工具、点击 `chat-input` 非交互区后会自动聚焦输入框且保持光标
- 历史消息持久化：SQLite 存储，支持恢复会话上下文
- 上下文清空：保留历史消息，仅重置后续模型上下文
- 消息 Markdown 渲染：基于 `marked + marked-highlight + highlight.js + dompurify`，支持代码高亮与安全净化
- 介入机制：支持工具调用/错误/handoff 等节点人工决策
- 事件分级落库：`eventLogLevel = none | key | full`（默认 `key`）
- 提供商兼容参数：支持 `enable_thinking`（适配部分使用该字段控制思考开关的模型）

## Monorepo 结构

```text
agent-swarm/
├── packages/
│   ├── core/        # @agent-swarm/core
│   ├── server/      # @agent-swarm/server
│   └── web/         # @agent-swarm/web
├── docs/
│   ├── context-recovery.md
│   ├── frontend-conversation-runtime.md
│   ├── message-markdown-rendering.md
│   └── provider-compatibility.md
├── agent-swarm.config.ts     # SDK 配置示例（示例文件，不会被 server 自动读取）
└── README.md
```

## 环境要求

- Node.js `>= 18`
- pnpm `>= 8`

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

最小配置：

```env
PORT=3000
DB_PATH=./data/agent-swarm.db
```

### 3. 启动开发环境

```bash
pnpm dev
```

默认地址：

- Web: `http://localhost:5173`
- API: `http://localhost:3000`
- WebSocket: `ws://localhost:3000/ws`

## 常用命令

```bash
# 开发
pnpm dev
pnpm dev:core
pnpm dev:server
pnpm dev:web

# 构建
pnpm build
pnpm build:core
pnpm build:server
pnpm build:web

# 测试
pnpm test
pnpm --filter @agent-swarm/core test
pnpm --filter @agent-swarm/server test
```

## REST API 概览

### 健康检查

- `GET /api/health`

### Swarm 管理

- `GET /api/swarms`
- `GET /api/swarms/:id`
- `POST /api/swarms`
- `PUT /api/swarms/:id`
- `DELETE /api/swarms/:id`

### 会话管理

- `GET /api/conversations?swarmId=...`
- `POST /api/conversations`
- `GET /api/conversations/:id`
- `PATCH /api/conversations/:id/preferences`
- `POST /api/conversations/:id/context/clear`
- `POST /api/conversations/:id/resume`
- `DELETE /api/conversations/:id`

### 消息查询

- `GET /api/conversations/:id/messages`

### LLM 配置

- `GET /api/config`
- `PUT /api/config`
- `GET /api/config/providers`
- `GET /api/config/providers/:providerId/models`
- `POST /api/config/test-model`

## WebSocket 协议（核心）

连接：`ws://localhost:3000/ws`

客户端 -> 服务端常用消息：

- `send_message`
- `subscribe_conversation`
- `unsubscribe_conversation`
- `abort`
- `intervention_decision`
- `client_tool_result`

服务端 -> 客户端常用消息：

- `connected`
- `conversation_created`
- `intervention_required`
- `client_tool_execution_required`
- `swarm_start` / `agent_start` / `message_update` / `handoff` / `swarm_end` 等事件流
- `prompt_completed`
- `error`

### `send_message` 三种启动方式

1. 指定 `swarmId`：走 swarm 模式会话。
2. 指定 `conversationId`：续聊已有会话。
3. 指定 `provider + modelId`：直接对话模式（不依赖预建 swarm）。

## 提供商兼容参数

部分 OpenAI 兼容模型用 `enable_thinking` 控制思考开关，而不是 `reasoning_effort`。  
可在 provider 配置中启用：

- `providers.<providerId>.enable_thinking = true`

详细说明见：

- [Provider 兼容参数：enable_thinking](./docs/provider-compatibility.md)

## 上下文恢复机制

当前实现的恢复逻辑：

1. `resumeConversation(conversationId)` 读取会话与历史消息。
2. 若会话存在 `context_reset_at`，仅恢复 `created_at > context_reset_at` 的消息。
3. 恢复消息注入到 Agent 运行时 `messages`，用于继续推理。
4. 历史消息不删除，仍可在消息列表查看。

详细说明见：

- [历史消息恢复上下文机制](./docs/context-recovery.md)

## 前端会话运行态机制

当前前端会话状态管理采用“按会话 ID 分桶缓存”的单一状态源模型：

1. 所有运行态（消息、流式消息、Agent 状态、活动状态）都按 `conversationId` 存入 `runtimeStates`。
2. UI 只读取当前会话对应 bucket，不再通过 `snapshot/restore` 切换会话。
3. 新会话创建前的消息先写入草稿 bucket，收到 `conversation_created` 后归并到真实会话 bucket。

详细说明见：

- [前端会话运行态分桶机制](./docs/frontend-conversation-runtime.md)

## SDK 配置示例

> 以下是 `@agent-swarm/core` 使用方式示例。  
> 注意：`packages/server/src/index.ts` 当前默认直接在代码里构造配置。

```ts
import { defineConfig } from "@agent-swarm/core";

export default defineConfig({
  llm: {
    apiKeys: {},
  },
  storage: {
    type: "sqlite",
    path: "./data/agent-swarm.db",
  },
  eventLogLevel: "key", // none | key | full，默认 key
  swarms: [
    {
      id: "research-team",
      name: "Research Team",
      mode: "router",
      orchestrator: {
        id: "router",
        name: "Router",
        description: "Routes to specialist agents",
        systemPrompt: "Route tasks to the right specialist.",
        model: { provider: "deepseek", modelId: "deepseek-chat" },
      },
      agents: [
        {
          id: "researcher",
          name: "Researcher",
          description: "Information gathering",
          systemPrompt: "You are a research specialist.",
          model: { provider: "deepseek", modelId: "deepseek-chat" },
        },
      ],
    },
  ],
});
```

## 文档索引

- [历史消息恢复上下文机制](./docs/context-recovery.md)
- [前端会话运行态分桶机制](./docs/frontend-conversation-runtime.md)
- [消息 Markdown 渲染](./docs/message-markdown-rendering.md)
- [Provider 兼容参数：enable_thinking](./docs/provider-compatibility.md)

## License

MIT
