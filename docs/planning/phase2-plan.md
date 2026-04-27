# 阶段二实施计划：差异化能力

## 概述

阶段一补齐了基础短板（API 验证、测试、日志、主题、Docker、搜索工具）。阶段二聚焦于**差异化能力**——让 Agent Swarm 从"可用"变成"强大"。

本阶段包含 5 个项目，按优先级排序：
- **P0-1** 用户认证与多租户 —— 安全基础，所有功能的数据隔离依赖它
- **P0-2** MCP 协议 —— 工具生态，让 Agent 接入外部能力
- **P0-3** LLM 调用日志 —— 可观测性，生产部署的必需品
- **P1-1** RAG 知识检索 —— 核心差异化能力
- **P1-2** 对话分支与对比 —— 用户体验提升

### 架构影响评估

| 项目 | Core | Server | Web | Storage |
|------|------|--------|-----|---------|
| P0-1 认证多租户 | ✅ AgentSwarm 用户上下文 | ✅ 中间件 + 路由 | ✅ 登录/注册页 + store | ✅ users 表 + 各表加 userId |
| P0-2 MCP 协议 | ✅ MCPClient + ToolProvider | ✅ MCP 管理 API | ✅ MCPSettings 组件 | — |
| P0-3 LLM 日志 | ✅ 拦截 complete() 调用 | ✅ 查询 API | ✅ 日志查看页（可复用 UsageView） | ✅ llm_calls 表 |
| P1-1 RAG | ✅ IVectorStore + 工具 | ✅ 文档管理 API | ✅ DocumentsView | ✅ SQLite 向量存储 |
| P1-2 对话分支 | ✅ forkConversation | ✅ 分支 API | ✅ ChatView 分支按钮 | ✅ 消息复制逻辑 |

预计周期：7-8 周。

---

## P0-1: 用户认证与多租户

### 现状

- 无任何用户区分，所有数据共享同一 SQLite 数据库
- 无登录/注册功能，API 路由全部公开

### 目标

添加 JWT 用户认证，实现多用户数据隔离。这是后续所有功能的安全基础。

### 实施方案

#### 新增依赖

```bash
pnpm add jsonwebtoken bcrypt --filter @agent-swarm/server
pnpm add -D @types/jsonwebtoken @types/bcrypt --filter @agent-swarm/server
```

#### 数据库变更

`packages/core/src/storage/schema.ts` 新增 `users` 表：

```typescript
export const usersTable = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at").notNull(),
});
```

**多租户改造**——所有数据表新增 `userId` 字段：

```typescript
// swarms 表 — 直接添加（用户拥有自己的 swarm 配置）
// conversations 表 — 直接添加（用户拥有自己的对话）
// preset_agents 表 — 直接添加（用户拥有自己的预设）
// messages / events — 通过 conversations.id 间接隔离，无需直接加 userId
```

所有新增 `userId` 为可空列（兼容旧数据，旧数据 userId=NULL 视为共享数据）。通过 `ensureConversationColumns` 在 `SqliteStorage.init()` 中执行 `ALTER TABLE ADD COLUMN`。

#### IStorage 接口变更

查询方法新增可选的 `userId` 参数：

```typescript
listSwarms(userId?: string): Promise<SwarmConfig[]>;
listConversations(swarmId: string, userId?: string): Promise<Conversation[]>;
listAllConversations(userId?: string): Promise<Conversation[]>;
listAgentPresets(userId?: string): Promise<AgentPreset[]>;
```

`userId` 为 `undefined` 时不加过滤（兼容旧数据和 `AUTH_ENABLED=false` 模式）。

#### AgentSwarm 变更

`packages/core/src/core/swarm.ts`：

```typescript
export class AgentSwarm {
  private currentUserId?: string;

  setCurrentUser(userId: string | undefined): void;
  getCurrentUser(): string | undefined;

  // 所有查询方法自动传入 currentUserId
  // 创建数据时自动设置 userId = currentUserId
}
```

#### 认证中间件

`packages/server/src/middleware/auth.ts`：

```typescript
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET ?? "change-me";

export interface AuthUser { id: string; username: string; }

declare global {
  namespace Express { interface Request { user?: AuthUser; } }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (process.env.AUTH_ENABLED !== "true") {
    return next();
  }

  // 排除 auth 路由
  if (req.path.startsWith("/api/auth/")) return next();

  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "未登录" });
    return;
  }

  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as AuthUser;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "登录已过期" });
  }
}
```

#### 认证路由

`packages/server/src/routes/auth.ts`：

```
POST /api/auth/register → { username, password }
    响应 { token, user: { id, username } }
    逻辑：bcrypt 哈希密码 → 写入 users 表 → 签发 JWT

POST /api/auth/login    → { username, password }
    响应 { token, user: { id, username } }
    逻辑：bcrypt 验证 → 签发 JWT

GET  /api/auth/me       → 需认证
    响应 { id, username }
    逻辑：从 token 解析用户信息返回
```

#### 路由保护策略

`packages/server/src/app.ts`：

```typescript
// 认证路由始终公开
app.use("/api/auth", authRoutes);

if (process.env.AUTH_ENABLED === "true") {
  app.use("/api", authMiddleware);
}

// 其他路由...
```

`AUTH_ENABLED=false` 时走开发模式：所有请求共享同一个默认用户（或无用户上下文查询全部数据）。

#### 前端

`packages/web/src/stores/auth.ts`：

```typescript
export const useAuthStore = defineStore("auth", () => {
  const token = ref<string | null>(localStorage.getItem("token"));
  const user = ref<User | null>(null);

  async function login(username: string, password: string): Promise<void>;
  async function register(username: string, password: string): Promise<void>;
  function logout(): void;
  async function fetchMe(): Promise<void>;

  const isAuthenticated = computed(() => !!token.value);
  // token 变更时同步 localStorage
  watch(token, (t) => t ? localStorage.setItem("token", t) : localStorage.removeItem("token"));

  return { token, user, isAuthenticated, login, register, logout, fetchMe };
});
```

`packages/web/src/views/LoginView.vue` / `RegisterView.vue`：

- 登录页：居中卡片，用户名 + 密码输入框，登录按钮，注册链接
- 注册页：同上 + 确认密码
- 样式：玻璃拟态，暗色主题背景

`packages/web/src/router/index.ts` 路由守卫：

```typescript
router.beforeEach((to) => {
  const publicRoutes = ["login", "register"];
  const authStore = useAuthStore();
  if (!publicRoutes.includes(to.name as string) && !authStore.isAuthenticated) {
    return "/login";
  }
});
```

`packages/web/src/App.vue` 启动时恢复会话：

```typescript
onMounted(async () => {
  const authStore = useAuthStore();
  if (authStore.isAuthenticated) {
    await authStore.fetchMe().catch(() => authStore.logout());
  }
});
```

`packages/web/src/api/client.ts`（fetch 封装）自动附加认证头：

```typescript
const headers: HeadersInit = { "Content-Type": "application/json" };
const token = useAuthStore().token;
if (token) headers["Authorization"] = `Bearer ${token}`;
```

#### 边界情况

| 场景 | 处理 |
|------|------|
| JWT 过期 | 401 → 前端自动跳转登录页 |
| 用户名已存在 | 注册返回 409 |
| AUTH_ENABLED 从 true 切到 false | 旧数据 userId 为 NULL 时仍可见 |
| Token 伪造/篡改 | `jwt.verify` 报错 → 401 |
| 并发注册同名用户 | `INSERT ... unique(username)` 冲突 → 409 |

### 验收标准

- 用户可注册/登录
- 登录后只能看到自己的对话、swarm、agent 预设
- 未登录用户重定向到登录页
- `AUTH_ENABLED=false` 时保持原有单用户行为
- 现有 29 个测试不受影响

---

## P0-2: MCP 协议客户端支持

### 现状

- 无 MCP 客户端连接能力
- 现有 `client-bridge.ts` 架构与 MCP 概念类似（服务端定义工具 → 客户端执行 → 结果回传），但基于自定义 WebSocket 协议而非 JSON-RPC 2.0
- Agent 只能使用内置工具：`handoff`、`route_to_agent`、`web_search`、`current_time`、`javascript_execute`

### 目标

接入 Model Context Protocol 标准（JSON-RPC 2.0），使 Agent 能使用任何 MCP 服务器提供的工具。

### 实施方案

#### 新增文件

`packages/core/src/tools/mcp/types.ts`

```typescript
export type MCPTransport = "stdio" | "sse";

export interface MCPServerConfig {
  id: string;
  transport: MCPTransport;
  command?: string;       // stdio: npx -y @server/name
  args?: string[];
  url?: string;           // SSE: http://localhost:3001/sse
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;  // JSON Schema
}

/** JSON-RPC 2.0 message envelope */
export interface JSONRPCMessage<T = unknown> {
  jsonrpc: "2.0";
  method?: string;
  params?: T;
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}
```

`packages/core/src/tools/mcp/client.ts`

实现 MCP 协议标准化：

```typescript
export class MCPClient extends EventEmitter {
  private servers = new Map<string, MCPServerConnection>();

  // ── 生命周期 ──

  async connect(serverId: string, config: MCPServerConfig): Promise<void> {
    // 1. 根据 transport 建立连接
    //    stdio: child_process.spawn(command, args)
    //    SSE:   GET ${url}/sse → 解析 data: 事件
    // 2. 发送 initialize 请求
    //    { method: "initialize", params: { protocolVersion: "2024-11-05", ... } }
    // 3. 等待服务器响应 capabilities
    // 4. 发送 initialized 通知
    // 5. 发送 tools/list 请求，缓存工具列表
  }

  async disconnect(serverId: string): Promise<void>

  // ── 工具操作 ──

  async listTools(serverId: string): Promise<MCPTool[]> {
    // 返回缓存或重新请求
    // 请求: { method: "tools/list" }
    // 响应: { result: { tools: [...] } }
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ content: Array<{ type: string; text?: string; data?: string }> }> {
    // 请求: { method: "tools/call", params: { name, arguments: args } }
    // 响应: { result: { content: [...] } }
  }

  // ── 查询 ──

  getServerStatus(serverId: string): "disconnected" | "connecting" | "connected" | "error"
  getConnectedServers(): string[]
  getServerConfig(serverId: string): MCPServerConfig | undefined
}
```

**stdio 传输细节**：

```typescript
class StdioTransport {
  private process: ChildProcess;

  constructor(command: string, args: string[], env?: Record<string, string>) {
    this.process = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    // stdout 读取 JSON-RPC 响应
    // stdin 写入 JSON-RPC 请求
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const line = JSON.stringify(message) + "\n";
    this.process.stdin!.write(line);
  }

  onMessage(handler: (msg: JSONRPCMessage) => void): void {
    // 按行读取 stdout，解析 JSON
  }

  close(): void {
    this.process.stdin!.end();
    this.process.kill();
  }
}
```

**SSE 传输细节**：

```typescript
class SSETransport {
  private eventSource: EventSource | null = null;
  private endpoint: string;

  constructor(url: string) {
    this.endpoint = url.endsWith("/sse") ? url : url + "/sse";
  }

  async connect(headers?: Record<string, string>): Promise<void> {
    // 方案 A: 使用 AbortController + fetch + ReadableStream 读取 SSE
    // 方案 B: 简单轮询（如果 EventSource 不可用）
    // 方案 A 优先，方案 B 作为 fallback
  }

  async send(message: JSONRPCMessage): Promise<void> {
    // POST 到 SSE 端点，接收 JSON-RPC 响应
    await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
  }

  onMessage(handler: (msg: JSONRPCMessage) => void): void { ... }
  close(): void { ... }
}
```

`packages/core/src/tools/mcp/tool-provider.ts`

```typescript
import { Type } from "@sinclair/typebox";

export function createMCPToolProvider(
  client: MCPClient,
  serverId: string,
  toolDef: MCPTool,
): AgentTool {
  return {
    name: `mcp_${serverId}_${toolDef.name}`,
    label: `${serverId}/${toolDef.name}`,
    description: `[${serverId}] ${toolDef.description}`,
    parameters: Type.Unsafe(toolDef.inputSchema),  // 转发 JSON Schema
    execute: async (toolCallId, params) => {
      const result = await client.callTool(serverId, toolDef.name, params);
      const text = result.content
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
      return {
        content: [{ type: "text", text: text || "工具执行完成" }],
        details: result.content,
      };
    },
  };
}
```

#### 运行时集成

MCP 工具注册到 Agent，在 `getAutoTools` 中替代 `web_search` 的注册逻辑：

`packages/core/src/core/conversation.ts`：

```typescript
private getAutoTools(config: SwarmAgentConfig): AgentTool<any>[] {
  // ... 现有工具注册 ...

  // MCP 工具 — 根据 enabledTools 动态包含
  if (this.runtimeOptions.enabledTools.includes("mcp")) {
    const mcpTools = this.loadMCPTools();  // 从 AgentSwarm 获取
    tools.push(...mcpTools);
  }

  // Web search（现有）
  if (this.runtimeOptions.enabledTools.includes("web_search")) { ... }

  return tools;
}
```

**注意**：MCP 工具不与单个 enabledTool 名称绑定，而是通过 `"mcp"` 作为一个组开关。用户启用 MCP 后，所有已连接 MCP 服务器的工具都可用。

#### 配置集成

`AgentSwarmOptions` 新增：

```typescript
export interface AgentSwarmOptions {
  // ... 现有字段
  mcpServers?: MCPServerConfig[];
}
```

`AgentSwarm` 初始化时：

```typescript
async init(): Promise<void> {
  // ... 现有逻辑 ...

  // 连接 MCP 服务器（后台进行，不阻塞）
  for (const server of this.mcpServers ?? []) {
    this.mcpClient.connect(server.id, server).catch((err) => {
      this.logger.warn("mcp_connect_failed", { serverId: server.id, error: err.message });
    });
  }
}
```

#### API 端点

`packages/server/src/routes/mcp.ts`：

```
GET    /api/mcp/servers            → { data: Array<{ id, transport, status, toolCount }> }
POST   /api/mcp/servers            → body: MCPServerConfig → 连接并返回
DELETE /api/mcp/servers/:id        → 断开连接
POST   /api/mcp/servers/:id/reconnect → 断开后重新连接
GET    /api/mcp/servers/:id/tools  → { data: MCPTool[] }
```

#### 前端

`packages/web/src/components/settings/MCPSettings.vue`（设置页新增 tab）

```
┌─────────────────────────────────────────┐
│ MCP 服务器          [添加服务器]          │
├─────────────────────────────────────────┤
│ ● filesystem        已连接  5 个工具      │
│   传输: stdio  npx -y @modelcontext...   │
│   [断开]                                 │
├─────────────────────────────────────────┤
│ ◌ brave-search      连接失败             │
│   传输: stdio  缺少 BRAVE_API_KEY        │
│   [重连]  [删除]                         │
├─────────────────────────────────────────┤
│ ○ database          已断开               │
│   传输: sse    http://localhost:3001     │
│   [连接]  [删除]                         │
└─────────────────────────────────────────┘
```

#### 错误处理

| 场景 | 处理 |
|------|------|
| MCP 服务器启动失败 | `mcp_connect_failed` 日志，状态标记为 error，不影响其他服务器 |
| MCP 服务器运行时崩溃 | `disconnect` 事件 → 状态标记为 disconnected，新请求返回友好错误 |
| 工具调用超时 | AbortSignal 30 秒超时 → `tools/call` 返回超时错误 |
| 工具名不存在 | MCP 服务器返回 -32602 Method not found → Agent 收到错误 |

### 验收标准

- 可连接 stdio（如 filesystem）和 SSE 两种 MCP 服务器
- MCP 工具自动注册为 Agent 可用工具（前缀 `mcp_{serverId}_`）
- 前端可查看和管理 MCP 服务器
- 服务器断连时 Agent 调用返回友好错误信息，不影响对话继续
- 已有测试不受影响

---

## P0-3: LLM 调用日志专用表

### 现状

- LLM 调用 token/usage 数据嵌入在 `messages.metadata` JSON 中（阶段一实现的 `getConversationUsage` 需要解析 JSON 聚合）
- 无独立调用记录，查询效率低，无法做性能分析
- 无请求级 latency 记录

### 目标

创建 `llm_calls` 表，每次 `pi-ai` 的 `complete()` 调用写入一条记录，支持按时间/provider/模型/对话高效查询和成本归因。

### 实施方案

#### 数据库

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
  status: text("status").notNull().default("ok"),   // ok | error
  errorMessage: text("error_message"),
  timestamp: integer("timestamp").notNull(),
});
```

`packages/core/src/storage/interface.ts` 新增：

```typescript
export interface LLMCallRecord {
  id: string;
  conversationId: string;
  agentId?: string;
  providerId: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  latencyMs?: number;
  status: "ok" | "error";
  errorMessage?: string;
  timestamp: number;
}

export interface IStorage {
  // ... 现有方法 ...
  logLLMCall(call: LLMCallRecord): Promise<void>;
  queryLLMCalls(filter: {
    conversationId?: string;
    providerId?: string;
    modelId?: string;
    days?: number;
    limit?: number;
  }): Promise<LLMCallRecord[]>;
}
```

#### 数据写入点

**关键挑战**：`pi-ai` 的 `complete()` 是外部库，无法直接修改。最佳切入点是在 `AgentSwarm` 的 LLM 调用包装层。

`packages/core/src/core/swarm.ts`：

```typescript
private async completeWithLogging(
  provider: string,
  modelId: string,
  options: any,
  conversationId: string,
  agentId?: string,
): Promise<any> {
  const startedAt = Date.now();
  try {
    const result = await complete(provider, modelId, options);
    await this.storage.logLLMCall({
      id: crypto.randomUUID(),
      conversationId,
      agentId,
      providerId: provider,
      modelId,
      promptTokens: result.usage?.input ?? 0,
      completionTokens: result.usage?.output ?? 0,
      cacheReadTokens: result.usage?.cacheRead ?? 0,
      cacheWriteTokens: result.usage?.cacheWrite ?? 0,
      cost: result.usage?.cost?.total ?? 0,
      latencyMs: Date.now() - startedAt,
      status: "ok",
      timestamp: Date.now(),
    });
    return result;
  } catch (err) {
    await this.storage.logLLMCall({
      id: crypto.randomUUID(),
      conversationId,
      agentId,
      providerId: provider,
      modelId,
      promptTokens: 0,
      completionTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
      latencyMs: Date.now() - startedAt,
      status: "error",
      errorMessage: (err as Error).message,
      timestamp: Date.now(),
    });
    throw err;
  }
}
```

**集成点**：在 `Conversation.createAgent()` 或 `agent-factory.ts` 中，将 `complete` 调用替换为 `completeWithLogging`。

#### 迁移

`packages/core/src/storage/sqlite.ts`：

```typescript
private ensureLLMCallsColumn(): void {
  // 如果表不存在 → CREATE TABLE
  // 如果表存在但缺列 → ALTER TABLE ADD COLUMN
}
```

在 `init()` 中调用。

#### API 端点

`packages/server/src/routes/usage.ts` 扩展：

```
GET /api/llm/calls?conversationId=xxx&days=30&limit=100 → 调用记录列表
GET /api/llm/stats?days=30 → { daily: DailyUsage[], totalTokens, totalCost, avgLatencyMs }
```

（可复用已有 `UsageView.vue` 前端页面）

#### 索引优化

```sql
CREATE INDEX idx_llm_calls_conversation ON llm_calls(conversation_id, timestamp);
CREATE INDEX idx_llm_calls_provider ON llm_calls(provider_id, timestamp);
CREATE INDEX idx_llm_calls_status ON llm_calls(status, timestamp);
```

### 验收标准

- 每次 LLM API 调用（成功/失败）写入一条 `llm_calls` 记录
- 包含 latency/usage/cost/status/errorMessage 全字段
- 可按对话/日期/provider 查询
- 已有测试不受影响

---

## P1-1: RAG 知识检索

### 现状

- Agent 无知识库访问能力
- 无向量存储接口、无文档索引和检索流程
- 阶段一的 `web_search` 是实时搜索，RAG 是预索引的私有知识库

### 目标

用户上传文档 → 索引 → Agent 通过 `retrieve_knowledge` 工具检索相关内容，提高回答准确度。

### 实施方案

#### 向量存储接口

`packages/core/src/storage/vector-store.ts`：

```typescript
export interface Document {
  id: string;
  userId?: string;
  title: string;
  source: string;          // 原始文件名
  createdAt: number;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  index: number;           // 在文档中的顺序
  metadata?: Record<string, unknown>;
  embedding?: number[];
}

export interface IVectorStore {
  addDocument(doc: Document, chunks: DocumentChunk[]): Promise<void>;
  deleteDocument(documentId: string): Promise<void>;
  search(query: string, topK?: number): Promise<Array<{ chunk: DocumentChunk; document: Document; score: number }>>;
  listDocuments(userId?: string): Promise<Document[]>;
  getChunks(documentId: string): Promise<DocumentChunk[]>;
  clear(): Promise<void>;
}
```

#### 内置 SQLite 实现

`packages/core/src/storage/vector-store-sqlite.ts`：

**文档分块策略**：

```typescript
function splitTextIntoChunks(text: string, chunkSize = 500, overlap = 50): string[] {
  // 按段落 + 句子边界切分
  // 滑动窗口重叠保留上下文
  // 尽量减少 chunk 在句子中间的断裂
}
```

**检索算法**（无需嵌入服务，开箱即用）：

```typescript
// 默认：TF-IDF 关键词匹配
// 方案：对 query 分词 → 计算每个 chunk 的 TF-IDF 向量 → cosine similarity → 排序

class SQLiteVectorStore implements IVectorStore {
  // documents 表: id, userId, title, source, created_at
  // chunks 表: id, documentId, content, index
  // full-text search (FTS5) 扩展用于快速检索

  async search(query: string, topK = 5): Promise<SearchResult[]> {
    // 1. 对 query 分词
    // 2. 使用 SQLite FTS5 MATCH 查询
    // 3. BM25 排序
    // 4. 返回 topK 结果
  }
}
```

**可选语义检索升级**：如果配置了 `EMBEDDINGS_PROVIDER=openai`：

```typescript
async search(query: string, topK = 5): Promise<SearchResult[]> {
  if (this.embeddingsProvider) {
    const queryVec = await this.embeddingsProvider.embed(query);
    // cosine similarity 排序
    return this.findTopKBySimilarity(queryVec, topK);
  }
  return this.ftsSearch(query, topK);  // fallback
}
```

#### 知识库工具

`packages/core/src/tools/retrieve-knowledge.ts`：

```typescript
export function createRetrieveKnowledgeTool(store: IVectorStore): AgentTool {
  return {
    name: "retrieve_knowledge",
    label: "检索知识库",
    description: "从用户上传的文档中检索与查询相关的内容片段。适合回答需要特定文档上下文的问题。",
    parameters: Type.Object({
      query: Type.String({ description: "检索查询" }),
      topK: Type.Optional(Type.Number({ description: "返回结果数", default: 5 })),
    }),
    execute: async (_, params) => {
      const results = await store.search(params.query, params.topK ?? 5);
      if (results.length === 0) {
        return {
          content: [{ type: "text", text: "知识库中没有找到相关内容。" }],
          details: [],
        };
      }
      const output = results.map((r, i) =>
        `[${i + 1}] 来源: ${r.document.title}\n${r.chunk.content}`
      ).join("\n---\n");
      return {
        content: [{ type: "text", text: output }],
        details: results,
      };
    },
  };
}
```

#### API 端点

`packages/server/src/routes/documents.ts`：

```
GET    /api/documents              → 文档列表
POST   /api/documents/upload       → multipart/form-data → 保存 + 分块 + 索引
DELETE /api/documents/:id          → 删除文档及其所有 chunk
GET    /api/documents/:id/chunks   → 查看分块
POST   /api/documents/search       → { query } → 测试检索结果
```

#### 上传解析

```typescript
// 支持格式：.txt, .md, .html (strip tags), .json (取文本字段)
// 可选：.pdf（需要 pdf-parse 库）
function parseDocumentText(filename: string, buffer: Buffer): string;
```

#### 前端

`packages/web/src/views/DocumentsView.vue`

```
┌─────────────────────────────────────────────┐
│ 知识库                        [📤 上传文档]  │
├─────────────────────────────────────────────┤
│ 📄 readme.md            3.2KB  15 chunks    │
│ 📄 api-docs.md          12KB   48 chunks    │
│ 📄 产品需求.pdf          2.1MB  82 chunks   │
│ [检索测试: ______________]  [搜索]          │
└─────────────────────────────────────────────┘
```

路由：`/documents`，侧边栏添加导航项。

### 验收标准

- 上传 .txt/.md 文档后逐段索引
- Agent 可调用 `retrieve_knowledge` 工具检索到相关内容
- 内置 SQLite FTS5 实现开箱即用，无需外部向量数据库
- 可选 OpenAI Embeddings 启用语义搜索

---

## P1-2: 对话分支与对比

### 现状

- 所有对话是线性的，无法从中间分叉
- 用户想尝试不同 Agent 配置时只能新建对话从头开始

### 目标

允许用户在对话任意位置创建分支（fork），继承历史上下文，使用不同 swarm/agent 配置继续对话。

### 实施方案

#### 核心逻辑

`packages/core/src/core/swarm.ts`：

```typescript
async forkConversation(sourceId: string, options: {
  swarmId?: string;
  title?: string;
}): Promise<Conversation> {
  const source = await this.storage.getConversation(sourceId);
  const sourceMessages = await this.storage.getMessages(sourceId);

  // 创建新对话（绑定不同 swarm 配置或相同配置）
  const newConv = await this.storage.createConversation(
    options.swarmId ?? source.swarmId,
    options.title ?? `${source.title} (分支)`,
  );

  // 复制消息（保留原始时间戳，新 ID）
  for (const msg of sourceMessages) {
    await this.storage.appendMessage(newConv.id, {
      ...msg,
      id: crypto.randomUUID(),  // 新 ID，避免冲突
    });
  }

  // 复制 contextResetAt（上下文边界保持一致）
  if (source.contextResetAt) {
    await this.storage.updateConversationContextReset(newConv.id, source.contextResetAt);
  }

  return new Conversation(newConv.id, swarmConfig, this.storage, ...);
}
```

#### API 端点

`packages/server/src/routes/conversations.ts` 扩展：

```
POST /api/conversations/:id/fork
  body: { swarmId?: string, title?: string }
  response: { data: ConversationInfo }
```

#### 前端

`packages/web/src/views/ChatView.vue`：

- 消息列表工具栏新增「分支」按钮
- 点击弹出对话分支对话框：
  - 选择目标 Swarm（可选与源对话相同或不同）
  - 确认后调用 `/api/conversations/:id/fork` API
  - 创建成功后自动跳转到新对话 `navigateTo("/chat/" + newConversationId)`

#### WebSocket 集成

分支创建后通过 WebSocket 广播 `conversation_created` 事件，使侧边栏实时更新。

### 验收标准

- 可在对话任意位置创建分支
- 分支继承源对话完整消息历史和上下文边界
- 分支后可绑定不同 swarm 配置
- 源对话不受影响
- 分支显示在侧边栏对话列表中

---

## 实施顺序建议

```
第1-2周:  P0-1 (认证与多租户)     — 安全基础，先做
第3-4周:  P0-2 (MCP 协议)         — 工具生态
第5周:    P0-3 (LLM 调用日志)     — 可观测性，可与 MCP 并行
第6-7周:  P1-1 (RAG 知识检索)     — 核心差异化能力
第8周:    P1-2 (对话分支)         — UX 提升，工作量小
```

---

## 环境变量新增

```bash
# ── 用户认证 ──
AUTH_ENABLED=false                        # 默认关闭
JWT_SECRET=change-me-to-random-string      # 修改为随机值
JWT_EXPIRES_IN=7d

# ── LLM 调用日志 ──
LLM_LOG_ENABLED=true                      # 是否写入 llm_calls 表

# ── MCP ──
# （服务器配置在 agent-swarm.config.ts 中）

# ── RAG ──
EMBEDDINGS_PROVIDER=none                  # 可选: openai
EMBEDDINGS_API_KEY=""
EMBEDDINGS_CHUNK_SIZE=500                 # 文档分块大小
EMBEDDINGS_CHUNK_OVERLAP=50               # 滑动窗口重叠
```
