# AGENTS.md

本文件为 AI 编码助手提供项目上下文和开发规范，确保代码生成符合项目约定。

## 维护规则

- 本文件必须随项目演进持续维护；当目录结构、脚本命令、接口协议或实现行为发生变化时，需按项目实际情况调整此文件并保持与代码一致。
- 对代码、接口、配置、行为的任何变更，必须同步更新 `README.md` 与 `docs/` 目录下相关文档，确保说明与示例和当前实现一致。

---

## 项目概览

Agent Swarm 是一个多 Agent 协作框架，基于 `@mariozechner/pi-agent-core` 构建。采用 pnpm monorepo 结构，包含三个包：

| 包 | 路径 | 职责 |
|---|------|------|
| `@agent-swarm/core` | `packages/core/` | 后端 SDK：协作模式、介入机制、存储、LLM 桥接、工具定义、Agent 预设管理 |
| `@agent-swarm/server` | `packages/server/` | API 服务：Express REST + WebSocket，桥接 core 和前端 |
| `@agent-swarm/web` | `packages/web/` | Vue 3 前端：对话 UI、Agent 状态可视化、Swarm/Agent 预设管理 |

详细规格见 `spec.md`。

---

## 技术栈

- **语言**：TypeScript（strict 模式），ESM（`"type": "module"`）
- **后端**：Node.js 18+、Express 4、ws 8、better-sqlite3 + drizzle-orm
- **前端**：Vue 3.5+（Composition API + `<script setup>`）、Vite 6、Pinia 2、Vue Router 4、TDesign Vue Next、Tailwind CSS v4
- **测试**：Vitest
- **Monorepo**：pnpm workspace，TypeScript project references

---

## 项目结构

```
agent-swarm/
├── packages/
│   ├── core/                    # @agent-swarm/core
│   │   ├── src/
│   │   │   ├── core/            # AgentSwarm 主类、Conversation、类型、配置、内置预设
│   │   │   ├── modes/           # 5种协作模式：router/sequential/parallel/swarm/debate
│   │   │   ├── intervention/    # 介入处理器和内置策略
│   │   │   ├── storage/         # IStorage 接口 + SQLite 实现
│   │   │   ├── llm/             # LLM 配置管理 + pi-ai 桥接
│   │   │   └── tools/           # 工具定义、MCP、workspace 组合工具、运行时工具注入
│   │   └── package.json
│   ├── server/                  # @agent-swarm/server
│   │   ├── src/
│   │   │   ├── routes/          # REST API 路由
│   │   │   ├── middleware/      # 错误处理中间件
│   │   │   ├── app.ts           # Express 应用
│   │   │   ├── ws.ts            # WebSocket 服务
│   │   │   └── index.ts         # 入口
│   │   └── package.json
│   └── web/                     # @agent-swarm/web
│       ├── src/
│       │   ├── api/             # HTTP 请求封装
│       │   ├── composables/     # useWebSocket / useChat / useIntervention
│       │   ├── stores/          # Pinia stores（swarm/agents/conversation/intervention/settings）
│       │   ├── views/           # 页面组件（Chat/Swarms/Agents/History/Settings）
│       │   ├── components/      # 通用组件（layout/chat/intervention/swarm）
│       │   ├── router/          # Vue Router 配置
│       │   ├── types/           # 前端本地类型
│       │   └── styles/          # Tailwind 入口
│       └── package.json
├── spec.md                      # 完整规格书
├── agent-swarm.config.ts        # 示例配置
└── pnpm-workspace.yaml
```

---

## 开发命令

```bash
pnpm install               # 安装依赖
pnpm dev                   # 同时启动 server + web
pnpm dev:core              # 仅 SDK（tsc --watch）
pnpm dev:server            # 仅 API 服务（tsx watch）
pnpm dev:web               # 仅前端（vite）
pnpm build                 # 构建所有包
pnpm test                  # 运行 core 单元测试
```

- 服务端默认端口：`3000`
- 前端开发服务器：`5173`，自动代理 `/api` → `localhost:3000`，`/ws` → `ws://localhost:3000`

---

## 编码规范

### 通用

- 使用 ESM：所有 import 路径必须带 `.js` 后缀（即使源文件是 `.ts`）
- 严格 TypeScript：启用 `strict`、`noUncheckedIndexedAccess` 风格
- 命名：类用 PascalCase，函数/变量用 camelCase，常量用 UPPER_SNAKE_CASE，类型/接口用 PascalCase
- 导出：优先命名导出，避免 `export default`（配置文件除外）
- 错误处理：使用自定义错误类或带类型的 Error，不要裸 throw 字符串
- 异步：优先 `async/await`，异步迭代器使用 `AsyncGenerator`

### 后端 (`@agent-swarm/core` + `@agent-swarm/server`)

- 依赖方向：`server` → `core`，`core` 不依赖 `server` 或 `web`
- 存储：通过 `IStorage` 接口抽象，默认 `SqliteStorage` 实现
- 事件：所有协作过程通过 `SwarmEvent` 类型的事件流暴露
- 介入：通过 `InterventionHandler` 抽象类实现，内置 5 种策略
- 工具注入：统一通过 `packages/core/src/tools/runtime.ts`；`Conversation` 按 `enabledTools` 决定启用，`AgentSwarm.createToolRuntimeAvailability()` 只提供可用工具资源，WebSocket 不创建具体工具
- API 路由：RESTful 风格，响应格式 `{ data: T }` 或 `{ error: string }`
- WebSocket 消息格式：`{ type: string, payload: any, conversationId?: string }`

### 前端 (`@agent-swarm/web`)

- 组件风格：`<script setup lang="ts">` + `<template>` + `<style scoped>`
- 状态管理：Pinia Composition API 风格（`defineStore` + `setup` 函数）
- 路径别名：`@/` 映射到 `src/`
- UI 组件库：TDesign Vue Next（`t-button`、`t-input`、`t-select` 等）
- 样式：Tailwind CSS v4 优先，复杂样式使用 `<style scoped>` + CSS 变量
- 设计风格：Glassmorphism 毛玻璃拟态，暗色主题
  - 背景：`linear-gradient(135deg, #0a0e1a, #1a1f35, #0d1220)`
  - 卡片：`rgba(255,255,255,0.03)` + `backdrop-filter: blur(12px)` + `border: 1px solid rgba(255,255,255,0.08)`
  - 主色调：`#6366f1`（indigo），状态色用 green/amber/red
- 虚拟滚动：消息列表大量消息时使用虚拟滚动
- 会话路由：聊天页使用 `/chat/:conversationId?`；切换会话需同步更新 URL 中的 `conversationId`

---

## 关键类型

### SwarmEvent（core/src/core/types.ts）

所有协作事件的基础类型，包含 15 种子类型：
- `swarm_start` / `swarm_end` — 生命周期
- `agent_start` / `agent_end` — Agent 级
- `turn_start` / `turn_end` — 轮次级
- `message_start` / `message_update` / `message_end` — 消息流
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end` — 工具执行
- `handoff` — Agent 交接
- `intervention_required` — 需要用户介入
- `error` — 错误

### InterventionPoint（core/src/intervention/types.ts）

7 个介入点：`before_agent_start` / `after_agent_end` / `before_tool_call` / `after_tool_call` / `on_handoff` / `on_error` / `on_approval_required`

### InterventionStrategy

5 种策略：`auto` / `confirm` / `review` / `edit` / `reject`

### AgentPreset（core/src/core/types.ts）

独立可复用 Agent 模板，字段包含 `id/name/description/systemPrompt/model/category/tags/builtIn`。  
内置预设在初始化时自动写入；所有预设均可更新，`id` 在创建后固定不可修改。  
`builtIn=true` 的预设不允许删除。

---

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/swarms` | 列出所有 Swarm |
| GET | `/api/swarms/:id` | 获取 Swarm 详情 |
| GET | `/api/agents` | 列出所有 Agent 预设 |
| GET | `/api/agents/:id` | 获取 Agent 预设详情 |
| POST | `/api/agents` | 创建 Agent 预设 |
| PUT | `/api/agents/:id` | 更新 Agent 预设（`id` 不可变） |
| DELETE | `/api/agents/:id` | 删除 Agent 预设（内置预设只读） |
| GET | `/api/conversations?swarmId=` | 列出对话 |
| POST | `/api/conversations` | 创建对话 |
| GET | `/api/conversations/:id/messages` | 获取消息 |
| GET | `/api/config` | 获取 LLM 配置 |
| PUT | `/api/config` | 更新 LLM 配置 |
| WS | `/ws` | WebSocket 连接 |

---

## WebSocket 协议

```
# 服务端 → 前端
{ type: SwarmEventType, payload: any, conversationId: string }

# 前端 → 服务端
{ type: "send_message", conversationId: string, payload: { content: string } }
{ type: "intervention_decision", payload: { requestId: string, decision: InterventionDecision } }
```

---

## 注意事项

- `better-sqlite3` 是 native 模块，需要 C++ 编译环境（Python 3.12 及以下 + setuptools）
- `@mariozechner/pi-agent-core` 和 `@mariozechner/pi-ai` 是核心依赖，Agent/AgentTool/AgentMessage 等类型来自这些包
- 环境变量（API Key）通过 `.env` 注入 server，不暴露到前端
- 配置文件 `agent-swarm.config.ts` 使用 `defineConfig()` 辅助函数提供类型检查
- 开发阶段如果会话/消息 schema、工具协议或事件结构发生变化，直接清理历史会话数据（`conversations/messages/events`），不做向后兼容迁移
