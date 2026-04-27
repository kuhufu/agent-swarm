# 阶段二实施计划：差异化能力

## 概述

阶段一补齐了基础短板（API 验证、测试、日志、主题、Docker、搜索工具）。阶段二聚焦于**差异化能力**——让 Agent Swarm 从"可用"变成"强大"。

本阶段包含 6 个项目，覆盖工具生态（MCP）、知识检索（RAG）、可观测性（LLM 调用日志）、用户体验（对话分支）和基础设施（认证多租户）。

预计周期：8-10 周。

---

## P0-1: MCP 协议客户端支持

### 现状

- 无 MCP 客户端连接能力
- 现有 `client-bridge.ts` 架构与 MCP 概念类似，但非标准协议
- Agent 只能使用内置工具（handoff、route_to_agent、web_search）

### 目标

接入 Model Context Protocol 标准，使 Agent 能使用任何 MCP 服务器提供的工具（文件系统、数据库、API 网关等）。

### 实施方案

#### 新增文件

`packages/core/src/tools/mcp/types.ts`

```typescript
export type MCPTransport = "stdio" | "sse";
export interface MCPServerConfig {
  id: string;
  transport: MCPTransport;
  command?: string;   // stdio: npx/mypy 等
  args?: string[];
  url?: string;        // SSE
  headers?: Record<string, string>;
  env?: Record<string, string>;
}
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
```

`packages/core/src/tools/mcp/client.ts`

- 基于 JSON-RPC 2.0 实现 MCP 客户端
- stdio 传输：`spawn` 子进程，通过 stdin/stdout 通信
- SSE 传输：`fetch` + 轮询
- 连接握手：`initialize` → `initialized` → `tools/list`
- 工具调用：`tools/call` 转发到 AgentTool

```typescript
export class MCPClient extends EventEmitter {
  async connect(serverId: string, config: MCPServerConfig): Promise<void>
  async listTools(serverId: string): Promise<MCPTool[]>
  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown>
  async disconnect(serverId: string): Promise<void>
}
```

`packages/core/src/tools/mcp/tool-provider.ts`

- `createMCPToolProvider(client, serverId, toolDef)` → 标准的 `AgentTool`
- 工具名前缀：`mcp_{serverId}_{toolName}` 避免冲突

#### 配置集成

`agent-swarm.config.ts` 新增 `mcpServers`：

```typescript
mcpServers: [
  { id: "fs", transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] },
]
```

`AgentSwarm` 初始化时连接 MCP 服务器，发现工具并注册到全局工具池。

#### API 端点

`packages/server/src/routes/mcp.ts`

```
GET    /api/mcp/servers            → 列出 MCP 服务器
POST   /api/mcp/servers            → 添加
DELETE /api/mcp/servers/:id        → 移除
POST   /api/mcp/servers/:id/reconnect → 重连
GET    /api/mcp/servers/:id/tools  → 列出可用工具
```

#### 前端

`packages/web/src/components/settings/MCPSettings.vue`

- 设置页新增 MCP tab
- 服务器列表：名称、传输方式、状态（connected/error/disconnected）、工具数
- 添加/删除表单
- 重连按钮

### 验收标准

- 可连接 stdio（filesystem）和 SSE 两种 MCP 服务器
- MCP 工具自动注册为 Agent 可用工具
- 前端可查看和管理 MCP 服务器
- 服务器断连时 Agent 调用返回友好错误

---

## P0-2: LLM 调用日志专用表

### 现状

- LLM 调用 token/usage 数据嵌入在 `messages.metadata` JSON 中
- 无法高效按 provider/modelId/日期 聚合
- 无独立的调用记录

### 目标

创建 `llm_calls` 表，每次 LLM API 调用写入一条记录，支持高效查询和成本归因。

### 实施方案

`packages/core/src/storage/schema.ts` 新增：

```typescript
export const llmCallsTable = sqliteTable("llm_calls", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  agentId: text("agent_id"),
  providerId: text("provider_id").notNull(),
  modelId: text("model_id").notNull(),
  promptTokens: integer("prompt_tokens").default(0),
  completionTokens: integer("completion_tokens").default(0),
  cacheReadTokens: integer("cache_read_tokens").default(0),
  cacheWriteTokens: integer("cache_write_tokens").default(0),
  cost: real("cost").default(0),
  latencyMs: integer("latency_ms"),
  status: text("status").notNull().default("ok"),
  errorMessage: text("error_message"),
  timestamp: integer("timestamp").notNull(),
});
```

`packages/core/src/storage/interface.ts` 新增 `logLLMCall` / `queryLLMCalls` 方法。

**数据写入点**：在 pi-ai 的 `complete()` 调用层附近包装。最佳切入点是在 `Conversation` 或 `Agent` 中拦截每次 LLM 调用的结果。

`packages/core/src/storage/sqlite.ts` 新增 `ensureLLMCallsColumn` 迁移检查。

### 验收标准

- 每次 LLM 调用写入一条 `llm_calls` 记录
- 可查询某对话的所有调用
- 可统计某 provider/模型的总 token 和成本

---

## P1-1: RAG 知识检索

### 现状

- Agent 无知识库访问能力
- 无向量存储接口
- 无文档索引和检索流程

### 目标

实现 Agent 知识检索能力：用户上传文档 → 向量化索引 → Agent 通过 `retrieve_knowledge` 工具检索相关内容。

### 实施方案

#### 向量存储接口

`packages/core/src/storage/vector-store.ts`

```typescript
export interface IVectorStore {
  addDocuments(docs: DocumentChunk[]): Promise<void>;
  search(query: string, topK?: number): Promise<DocumentChunk[]>;
  deleteDocument(documentId: string): Promise<void>;
  clear(): Promise<void>;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  metadata?: Record<string, unknown>;
  embedding?: number[];
}
```

#### 内置实现

`packages/core/src/storage/vector-store-sqlite.ts`

- 使用 SQLite 本地存储向量（不依赖外部向量数据库）
- 使用简单的 TF-IDF / 关键词匹配作为默认检索（无需嵌入服务）
- 可选集成：OpenAI Embeddings API 做语义检索

#### 知识库工具

`packages/core/src/tools/retrieve-knowledge.ts`

```typescript
export function createRetrieveKnowledgeTool(store: IVectorStore): AgentTool<...> {
  name: "retrieve_knowledge"
  description: "从知识库中检索与查询相关的信息"
  execute: async (toolCallId, params) => {
    const results = await store.search(params.query, params.topK ?? 5);
    return { content: [...], details: results };
  }
}
```

#### 文档管理 API

`packages/server/src/routes/documents.ts`

```
GET  /api/documents                    → 文档列表
POST /api/documents/upload             → 上传并索引
DELETE /api/documents/:id              → 删除
POST /api/documents/search?q=xxx       → 检索测试
```

#### 前端文档管理

`packages/web/src/views/DocumentsView.vue`

- 文档列表（名称、大小、创建时间、chunk 数）
- 上传按钮（支持 .txt/.md/.pdf）
- 删除按钮
- 搜索测试输入框

**路由注册**：`/documents`

### 验收标准

- 上传文档后可在知识库中检索到相关内容
- Agent 可调用 `retrieve_knowledge` 工具
- 内置 SQLite 实现开箱即用
- 可选 OpenAI Embeddings 做语义搜索

---

## P1-2: 对话分支与对比

### 现状

- 所有对话是线性的，无法分叉
- 用户想尝试不同 Agent 编排时只能新建对话重来

### 目标

允许用户在对话中创建分支，并排对比不同 Agent 配置的输出。

### 实施方案

`packages/core/src/core/swarm.ts` 新增：

```typescript
async forkConversation(
  sourceConversationId: string,
  newSwarmId: string,
  options?: { title?: string },
): Promise<Conversation>
```

- 复制源对话消息历史到新对话
- 保持 `contextResetAt` 边界
- 新对话绑定到不同的 swarm/agent 配置

**前端**：

`packages/web/src/views/ChatView.vue`

- 消息列表上方增加分支按钮
- 分支后弹出 swarm/agent 配置选择器
- 分支创建后自动跳转到新对话

**WebSocket**：分支创建后广播 `conversation_created` 事件。

### 验收标准

- 可在对话中创建分支（选择不同 swarm 配置）
- 分支继承源对话消息历史
- 不影响源对话

---

## P2-1: 用户认证与多租户

### 现状

- 无任何用户区分
- 所有数据共享同一 SQLite 数据库
- 无登录/注册功能

### 目标

添加 JWT 用户认证，实现多用户数据隔离。

### 实施方案

#### 依赖

```bash
pnpm add jsonwebtoken bcrypt --filter @agent-swarm/server
pnpm add -D @types/jsonwebtoken @types/bcrypt --filter @agent-swarm/server
```

#### 数据库

`packages/core/src/storage/schema.ts` 新增 `users` 表：

```typescript
export const usersTable = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at").notNull(),
});
```

所有现有表（conversations、swarms 等）新增 `userId` 列，创建时自动填充当前用户。

**注意**：多租户改造需要向后兼容。现有数据 `userId` 可为 NULL，表示"旧数据"或"共享数据"。

#### 中间件

`packages/server/src/middleware/auth.ts`

```typescript
export function authMiddleware(req: Request, res: Response, next: NextFunction): void;
// 验证 JWT token (Authorization: Bearer xxx)
// 设置 req.user = { id, username }
```

#### API 端点

`packages/server/src/routes/auth.ts`

```
POST /api/auth/register   → { username, password } → { token, user }
POST /api/auth/login      → { username, password } → { token, user }
GET  /api/auth/me         → 当前用户信息（需认证）
POST /api/auth/logout     → 清除会话
```

#### 路由保护策略

- `/api/auth/*` — 公开
- `/api/*` — 需要认证（配置开关，默认关闭以兼容开发）
- 环境变量 `AUTH_ENABLED=false` 控制是否开启认证

#### 前端

`packages/web/src/views/LoginView.vue`
`packages/web/src/views/RegisterView.vue`

- 登录/注册表单
- Token 存储到 localStorage
- 路由守卫：未登录时重定向到 /login

`packages/web/src/stores/auth.ts`

```typescript
export const useAuthStore = defineStore("auth", () => {
  const token = ref<string | null>(localStorage.getItem("token"));
  const user = ref<User | null>(null);
  async function login(username: string, password: string): Promise<void>;
  async function register(username: string, password: string): Promise<void>;
  function logout(): void;
  async function fetchMe(): Promise<void>;
});
```

**路由守卫**：在 `router/index.ts` 中添加 `beforeEach` 守卫。

### 验收标准

- 用户可注册/登录
- 认证用户只能看到自己的对话和配置
- 未登录用户重定向到登录页
- `AUTH_ENABLED=false` 时保持原有单用户行为
- 现有测试不受影响

---

## 实施顺序建议

```
第1-2周:  P0-1 (MCP 协议)           — 最复杂，先做
第3周:    P0-2 (LLM 调用日志表)      — 可并行依赖低
第4周:    P1-1 (RAG 知识检索)        — 依赖 MCP 的工具注册机制
第5周:    P1-2 (对话分支与对比)       — 新功能，独立
第6-8周:  P2-1 (认证与多租户)        — 改动面最大，最后
```

总工时：约 8-10 周。

---

## 环境变量新增

```bash
# MCP
MCP_SERVER_FILESYSTEM_ENABLED=false

# 用户认证
AUTH_ENABLED=false
JWT_SECRET=your-secret-key-here
JWT_EXPIRES_IN=7d

# 向量检索
EMBEDDINGS_PROVIDER=openai    # 可选: openai | none
EMBEDDINGS_API_KEY=
```

---

## 与阶段一的关系

| 阶段一完成项 | 阶段二依赖 |
|-------------|-----------|
| API 请求验证 | MCP API 路由复用 validate 中间件；认证路由也复用 |
| 结构化日志 | LLM 调用日志、认证操作对接 Logger |
| Token 用量跟踪 | LLM 调用日志表取代 metadata 嵌入方案 |
| Web 搜索工具 | RAG 的检索工具注册方式与 web_search 一致 |
| Docker 部署 | 认证需要配置 JWT_SECRET 环境变量；MCP 服务器扩展 compose |
