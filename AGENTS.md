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
| `@agent-swarm/core` | `packages/core/` | 后端 SDK：协作模式、介入机制、存储（SQLite + 向量存储 + Wiki 存储 + Workspace 存储）、LLM 桥接、工具定义（含 workspace Docker 容器）、日志、Agent 预设管理 |
| `@agent-swarm/server` | `packages/server/` | API 服务：Express REST + WebSocket + Zod 校验，桥接 core 和前端 |
| `@agent-swarm/web` | `packages/web/` | Vue 3 前端：对话 UI、Agent 状态可视化、Swarm/Agent 预设管理、工作区产物管理、文档与 LLM Wiki 管理 |

---

## 技术栈

- **语言**：TypeScript（strict 模式），ESM（`"type": "module"`）
- **后端**：Node.js 18+、Express 4、ws 8、better-sqlite3 + drizzle-orm、Zod（校验）
- **前端**：Vue 3.5+（Composition API + `<script setup>`）、Vite 6、Pinia 2、Vue Router 4、TDesign Vue Next、Tailwind CSS v4
- **测试**：Vitest
- **日志**：结构化 JSON 日志（自定义 logger，支持分级/上下文输出）
- **Monorepo**：pnpm workspace，TypeScript project references

---

## 项目结构

```
agent-swarm/
├── packages/
│   ├── core/                    # @agent-swarm/core
│   │   ├── src/
│   │   │   ├── core/            # AgentSwarm 主类、Conversation、类型、配置、内置预设
│   │   │   ├── modes/           # 4种协作模式：chat/swarm/debate/team
│   │   │   ├── intervention/    # 介入处理器和内置策略
│   │   │   ├── storage/         # IStorage 接口 + SQLite + 向量存储 + Wiki 存储实现
│   │   │   ├── llm/             # LLM 配置管理 + pi-ai 桥接
│   │   │   ├── logger/          # 结构化 JSON 日志
│   │   │   └── tools/           # 工具定义、MCP、workspace 组合工具、运行时工具注入
│   │   ├── tests/               # 集中式测试文件（core/ modes/ tools/ llm/）
│   │   └── package.json
│   ├── server/                  # @agent-swarm/server
│   │   ├── src/
│   │   │   ├── routes/          # REST API 路由
│   │   │   ├── middleware/      # 错误处理中间件
│   │   │   ├── schemas/         # Zod 校验 schema
│   │   │   ├── app.ts           # Express 应用
│   │   │   ├── ws.ts            # WebSocket 服务
│   │   │   └── index.ts         # 入口
│   │   ├── tests/               # 集中式测试
│   │   └── package.json
│   ├── server/                  # @agent-swarm/server
│   │   ├── src/
│   │   │   ├── routes/          # REST API 路由
│   │   │   ├── middleware/      # 错误处理中间件
│   │   │   ├── schemas/         # Zod 校验 schema
│   │   │   ├── app.ts           # Express 应用
│   │   │   ├── ws.ts            # WebSocket 服务
│   │   │   └── index.ts         # 入口
│   │   ├── tests/               # 集中式测试
│   │   └── package.json
│   └── web/                     # @agent-swarm/web
│       ├── src/
│       │   ├── api/             # HTTP 请求封装
│       │   ├── composables/     # useWebSocket / useChat / useIntervention
│       │   ├── stores/          # Pinia stores（swarm/agents/conversation/intervention/settings/auth/theme）
│       │   ├── views/           # 页面组件（Chat/Swarms/Agents/History/Settings/Documents/Workspaces/Wiki/Login/Register/Usage）
│       │   ├── components/      # 通用组件（layout/chat/intervention/swarm）
│       │   ├── router/          # Vue Router 配置
│       │   ├── types/           # 前端本地类型
│       │   ├── constants/       # 常量定义（swarm modes 等）
│       │   ├── tools/           # 客户端工具定义
│       │   ├── utils/           # 工具函数
│       │   └── styles/          # Tailwind 入口
│       └── package.json
├── docs/                        # 架构文档与开发指南
├── scripts/                     # 运维与开发辅助脚本
├── agent-swarm.config.ts        # 示例配置
└── pnpm-workspace.yaml
```

---

## 开发命令

```bash
pnpm install               # 安装依赖
pnpm dev                   # 先构建 core，再同时启动 core（tsc --watch）+ server + web
pnpm dev:core              # 仅 SDK（tsc --watch）
pnpm dev:server            # 仅 API 服务（tsx watch）
pnpm dev:web               # 仅前端（vite）
pnpm build                 # 构建所有包
pnpm test                  # 运行 core + server 单元测试
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
- 存储：通过 `IStorage` 接口抽象，默认 `SqliteStorage` + 向量存储实现
- 事件：所有协作过程通过 `SwarmEvent` 类型的事件流暴露
- 介入：通过 `InterventionHandler` 抽象类实现，内置 5 种策略
- 工具注入：统一通过 `packages/core/src/tools/runtime.ts`；`Conversation` 按 `enabledTools` 决定启用，`AgentSwarm.createToolRuntimeAvailability()` 只提供可用工具资源，WebSocket 不创建具体工具；workspace 是用户级资源，由用户手动创建并挂载，未挂载 `workspaceId` 时不注入 workspace 工具
- API 路由：RESTful 风格，响应格式 `{ data: T }` 或 `{ error: string }`
- WebSocket 消息格式：`{ type: string, payload: any, conversationId?: string }`

### 前端 (`@agent-swarm/web`)

- 组件风格：`<script setup lang="ts">` + `<template>` + `<style scoped>`
- 状态管理：Pinia Composition API 风格（`defineStore` + `setup` 函数）
- 路径别名：`@/` 映射到 `src/`
- UI 组件库：TDesign Vue Next（`t-button`、`t-input`、`t-select` 等）
- 样式：Tailwind CSS v4 优先，复杂样式使用 `<style scoped>` + CSS 变量
- UI 设计规范：参见 [docs/design/ui-spec.md](docs/design/ui-spec.md)
  - 风格：扁平实色，黑白灰 + 橄榄绿主题色
  - 主色调：`#9aaa64`（深色）/ `#5f7038`（浅色）
  - 圆角：`--radius-sm 6px` / `--radius-md 8px` / `--radius-lg 12px` / `--radius-xl 16px`
  - 阴影：`--shadow-sm / --shadow-md / --shadow-lg` 三层
  - 字号：`--text-xs 10px` / `--text-sm 12px` / `--text-base 14px` / `--text-lg 16px` / `--text-xl 20px`
  - 字重：`--weight-normal 400` / `--weight-medium 500` / `--weight-bold 600`
- **SVG 图标**：统一使用 `<SvgIcon name="xxx" :size="16" />` 组件（位于 `packages/web/src/components/common/SvgIcon.vue`），所有图标定义集中管理在 `packages/web/src/constants/icons.ts` 的 `ICONS` 对象中。禁止在模板中使用内联 SVG；新增图标时需在 `icons.ts` 中添加对应 `IconDef` 定义后通过组件引用
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

路由分组位于 `packages/server/src/routes/`，RESTful 风格，响应格式 `{ data: T }` 或 `{ error: string }`：

| 分组 | 前缀 | 说明 |
|------|------|------|
| Auth | `/api/auth` | 注册、登录、登出、当前用户 |
| Swarms | `/api/swarms` | CRUD |
| Agents | `/api/agents` | Agent 预设 CRUD + 模板导入 |
| Conversations | `/api/conversations` | CRUD、偏好设置、工作区挂载、清空上下文、恢复、整段/指定消息分支、消息查询与执行 Trace |
| Workspaces | `/api/workspaces` | 用户级工作区 CRUD、归档/硬删除、workspace 产物列表/预览/下载/打包/删除/加入文档/最终标记；会话通过 `workspaceId` 挂载工作区，未挂载时不注入 workspace 工具 |
| Wiki | `/api/wiki` | LLM Wiki 页面 CRUD、搜索、资料入库生成、从已有文档生成、按来源重新生成 |
| Documents | `/api/documents` | 文档知识库 CRUD、全文搜索、文档 chunk 查询；上传支持 JSON 内容和 multipart 文本文件 |
| Templates | `/api/templates` | 系统 Agent 模板 CRUD |
| Config | `/api/config` | LLM 配置读写（需 `admin`） |
| Usage | `/api/usage`、`/api/llm` | 用量统计与 LLM 调用记录 |
| Health | `/api/health` | 健康检查 |
| WebSocket | `/ws` | 实时事件推送与消息收发 |

---

## WebSocket 协议

```
# 服务端 → 前端
{ type: SwarmEventType, payload: any, conversationId: string }

# 前端 → 服务端
{ type: "send_message", conversationId: string, payload: { content: string } }
{ type: "subscribe_conversation", payload: { conversationId: string } }
{ type: "unsubscribe_conversation", payload: { conversationId: string } }
{ type: "abort", payload: { conversationId?: string } }
{ type: "intervention_decision", payload: { requestId: string, decision: InterventionDecision } }
{ type: "client_tool_result", payload: { toolCallId: string, result: any } }
```

同一个 WebSocket 连接可以订阅多个会话；服务端按 `conversationId` 广播事件并在订阅时校验用户权限。服务端跟踪每个连接上的多个活跃会话，`abort` 携带 `conversationId` 时只终止指定会话，未携带时终止该连接发起的全部活跃会话。

---

## 工具

通过 `RuntimeTool` 组合机制注入 Agent。workspace 以组合工具模式将 11 个子工具统归 `"workspace"` 一个开关：

| 工具组 | 子工具数 | 说明 |
|--------|---------|------|
| `workspace` | 11 | workspace_write_file / read_file / grep / list_files / run_container / list_containers / start_containers / stop_containers / restart_containers / remove_containers / pull_image；仅会话挂载 `workspaceId` 且启用 `workspace` 工具时注入，容器按 `agent-swarm.workspace-id` label 归属工作区 |
| `web_search` | 1 | Web 搜索（多 provider） |
| `search_wiki` | 1 | LLM Wiki 页面检索 |
| `retrieve_knowledge` | 1 | 文档知识库检索 |
| 其他内置 | — | handoff / javascript_execute / current_time / browser_automation |

---

## 注意事项

- `better-sqlite3` 是 native 模块，需要 C++ 编译环境（Python 3.12 及以下 + setuptools）
- `@mariozechner/pi-agent-core` 和 `@mariozechner/pi-ai` 是核心依赖，Agent/AgentTool/AgentMessage 等类型来自这些包
- 首个注册用户自动成为 `admin`；全局 LLM 配置写操作与系统 Agent 模板写操作需要 `admin`；开发期可用 `node scripts/set-user-role.mjs <db-path> <username> <admin|user>` 调整角色
- 用户级 Agent 预设按 `(user_id, id)` 隔离；Swarm 内 Agent 按 `(swarm_id, id)` 隔离，开发阶段 schema 变化可直接重建本地数据库
- 环境变量（API Key）通过 `.env` 注入 server，不暴露到前端
- 配置文件 `agent-swarm.config.ts` 使用 `defineConfig()` 辅助函数提供类型检查
- 开发阶段如果会话/消息 schema、工具协议或事件结构发生变化，直接清理历史会话数据（`conversations/messages/events`），不做向后兼容迁移
- 对代码、接口、配置、行为的任何变更，必须同步更新 `README.md` 与 `docs/` 目录下相关文档，确保说明与示例和当前实现一致
- 禁止自动提交
