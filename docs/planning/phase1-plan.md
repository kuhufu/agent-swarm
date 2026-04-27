# 阶段一实施计划：基础打磨

## 概述

本阶段目标是在不改变核心架构的前提下，补齐当前项目最紧迫的基础设施和功能缺口，使 Agent Swarm 从"能跑"提升到"可靠可维护"。

计划按 P0 → P1 → P2 优先级组织，总计 10 个大项。

---

## P0-1: API 请求验证

### 现状

- 所有路由内联 `typeof` 检查（如 `swarms.ts:45-62`、`agents.ts:42-58`），无 schema 库
- 无请求体大小限制（`express.json()` 无参数，`app.ts:10`）
- 无类型安全的输入输出类型
- 错误信息不统一，部分为英文、部分为中文

### 实施方案

**引入 zod**，为所有 14 个端点添加请求验证。

#### 依赖

```bash
pnpm add zod --filter @agent-swarm/server
```

#### 新增文件

`packages/server/src/middleware/validate.ts`

- 实现 `validateBody(schema)` / `validateQuery(schema)` 通用验证中间件
- 捕获 ZodError，返回 400 + `{ error: string }` 格式，消息使用中文
- 示例：

```typescript
import { z, ZodError } from "zod";
import type { Request, Response, NextFunction } from "express";

export function validateBody<T>(schema: z.Schema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T>(schema: z.Schema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({
        error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      });
      return;
    }
    req.query = result.data as any;
    next();
  };
}
```

`packages/server/src/schemas/index.ts`

- Swarm 创建/更新 schema
- Agent 预设创建/更新 schema
- Conversation 创建/偏好设置 schema
- Config 更新 schema
- Test model 请求 schema

```typescript
import { z } from "zod";

const directModelSchema = z.object({
  provider: z.string().min(1, "提供商不能为空"),
  modelId: z.string().min(1, "模型 ID 不能为空"),
});

const agentConfigSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  model: directModelSchema.optional(),
});

const pipelineConditionSchema = z.object({
  type: z.enum(["equals", "notEquals", "contains", "regex", "minLength", "maxLength"]),
  value: z.string(),
});

const pipelineStepSchema = z.object({
  agentId: z.string(),
  condition: pipelineConditionSchema.optional(),
  transform: z.object({
    type: z.enum(["prepend", "append", "template", "trim", "replace"]),
    value: z.string().optional(),
  }).optional(),
});

const debateConfigSchema = z.object({
  rounds: z.number().int().min(1).max(10).default(3),
  proposerAgentId: z.string(),
  opponentAgentId: z.string(),
  judgeAgentId: z.string(),
  topic: z.string(),
});

const modeFieldSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.any()), z.record(z.string(), z.any())]);

const modeConfigSchema = z.object({
  type: z.enum(["router", "sequential", "parallel", "swarm", "debate"]),
  fields: z.record(z.string(), modeFieldSchema).optional(),
});

export const createSwarmSchema = z.object({
  name: z.string().min(1, "名称不能为空"),
  description: z.string().optional(),
  mode: modeConfigSchema,
  agents: z.array(agentConfigSchema).min(1, "至少需要一个 Agent"),
});

export const updateSwarmSchema = createSwarmSchema.partial();

export const createAgentPresetSchema = z.object({
  name: z.string().min(1, "名称不能为空"),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  model: directModelSchema.optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const updateAgentPresetSchema = createAgentPresetSchema.partial();

export const createConversationSchema = z.object({
  swarmId: z.string().optional(),
  title: z.string().optional(),
  enabledTools: z.array(z.string()).optional(),
  thinkingLevel: z.enum(["xhigh", "high", "medium", "low", "off"]).optional(),
  directModel: directModelSchema.optional(),
});

export const updateConversationPreferencesSchema = z.object({
  enabledTools: z.array(z.string()).optional(),
  thinkingLevel: z.enum(["xhigh", "high", "medium", "low", "off"]).optional(),
  directModel: directModelSchema.optional(),
});

export const providerConfigSchema = z.object({
  providerId: z.string().min(1),
  displayName: z.string().min(1),
  apiKey: z.string().min(1),
  apiUrl: z.string().url("API URL 格式无效").optional(),
  protocol: z.string().optional(),
  thinkingFormat: z.string().optional(),
});

export const updateConfigSchema = z.object({
  providers: z.array(providerConfigSchema).default([]),
});

export const testModelSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
});

export const listConversationsQuerySchema = z.object({
  swarmId: z.string().optional(),
});
```

#### 修改文件

`packages/server/src/app.ts`（第 10 行附近）

- 给 `express.json()` 添加 `{ limit: "1mb" }` 限制

`packages/server/src/routes/swarms.ts`

- POST `/api/swarms` → `validateBody(createSwarmSchema)`
- PUT `/api/swarms/:id` → `validateBody(updateSwarmSchema)`
- 移除 `buildSwarmConfig()` 中的手动类型检查

`packages/server/src/routes/agents.ts`

- POST `/api/agents` → `validateBody(createAgentPresetSchema)`
- PUT `/api/agents/:id` → `validateBody(updateAgentPresetSchema)`

`packages/server/src/routes/conversations.ts`

- POST `/api/conversations` → `validateBody(createConversationSchema)`
- PATCH `/api/conversations/:id/preferences` → `validateBody(updateConversationPreferencesSchema)`
- GET `/api/conversations` → `validateQuery(listConversationsQuerySchema)`

`packages/server/src/routes/config.ts`

- PUT `/api/config` → `validateBody(updateConfigSchema)`
- POST `/api/test-model` → `validateBody(testModelSchema)`

### 验收标准

- 所有 POST/PUT 端点输入不合法时返回 400 + 中文错误提示
- 现有逻辑不受影响（`buildSwarmConfig` 不再需要做类型守卫）
- `pnpm test` 全部通过

---

## P0-2: 测试基础设施

### 现状

- `core`: 5 个测试文件，使用 vitest + FakeAgent 模式
- `server`: 1 个测试文件（`app.test.ts`），使用 `node:test`，仅覆盖 7 个端点
- `web`: 无任何测试
- 无 mock LLM 提供商（测试通过 FakeAgent 绕过，不测真实 LLM 流程）

### 实施方案

#### 2.1 统一测试框架

- 保持 `core` 使用 vitest（不变）
- **将 `server` 测试迁移到 vitest**，替换 `node:test`

```bash
pnpm add -D vitest --filter @agent-swarm/server
```

在 `packages/server/package.json` 的 `test` 脚本改为 `"test": "vitest run"`。

重写 `app.test.ts`，将 `node:test` API 替换为 vitest API：
- `import { test } from "node:test"` → `import { describe, it, expect } from "vitest"`
- `assert.equal(...)` → `expect(...).toBe(...)`
- `assert.ok(...)` → `expect(...).toBeTruthy()`

#### 2.2 补充 Core 测试

| 测试文件 | 覆盖内容 |
|---------|---------|
| `modes/router.test.ts` | Router 模式：route_to_agent 正确路由、无匹配 agent 时行为、orchestrator 返回非工具消息时的处理 |
| `modes/sequential.test.ts` | Sequential 模式：管道步骤执行顺序、条件跳过（equals/contains/regex）、转换器效果（prepend/append/template）、空管道 |
| `modes/parallel.test.ts` | Parallel 模式：所有 agent 被调用、merge 聚合、vote 法定人数、best 法官选择 |
| `intervention/built-in.test.ts` | 内置策略：auto 直接通过、confirm 等待确认、review 返回审查结果、edit 允许修改、reject 拒绝执行 |
| `intervention/handler.test.ts` | 介入处理器：正确匹配介入点、超时回退为 auto、并发介入请求隔离 |
| `storage/sqlite.test.ts` | SQLite 存储：CRUD 全流程、事务回滚、schema 冲突清理、索引正确性 |
| `llm/config.test.ts` | LLM 配置：provider 管理、API key 掩码、thinkingFormat 继承、模型列表获取 |
| `tools/route-to-agent.test.ts` | route_to_agent 工具参数校验 |
| `tools/client-bridge.test.ts` | client-bridge 工具定义生成、执行回调、超时处理 |

#### 2.3 补充 Server 测试

| 测试文件 | 覆盖内容 |
|---------|---------|
| `routes/swarms.test.ts` | Swarm CRUD：创建各模式 swarm、更新、删除（含级联）、_d_ swarms 过滤、关联对话的 swarm 删除 |
| `routes/agents.test.ts` | Agent 预设：创建、更新（id 不可变）、删除内置预设被拒（403）、删除不存在预设（404） |
| `routes/conversations.test.ts` | 对话：创建、列出（按 swarmId 过滤）、上下文清除、偏好设置更新、恢复、删除 |
| `routes/config.test.ts` | 配置：获取、更新（API key "..." 保留）、模型测试、模型列表 |
| `ws.test.ts` | WebSocket：连接握手、send_message 创建对话、intervention_decision、abort、断连清理 |

**Server 测试模式**（参考现有 `app.test.ts`）：
- 每个测试创建临时 `SqliteStorage`（`:memory:` 或临时文件）
- 创建真实的 `AgentSwarm` 实例
- 通过 `fetch()` 调用真实 Express 服务器（listen 端口 0）

#### 2.4 补充 Web 组件测试

```bash
pnpm add -D vitest @vue/test-utils jsdom --filter @agent-swarm/web
```

在 `packages/web/package.json` 添加 `"test": "vitest run"`。

| 测试文件 | 覆盖内容 |
|---------|---------|
| `ChatInput.test.ts` | props 渲染、send 事件触发、回车发送、Shift+回车换行、中止按钮、thinking level 切换 |
| `MessageItem.test.ts` | 各角色（user/assistant/system）渲染、markdown 渲染、思考面板展开/折叠、工具调用卡片、流式状态指示器 |
| `MessageList.test.ts` | 空状态渲染、消息列表渲染、自动滚动、context_cleared 分隔线 |
| `ToolCallCard.test.ts` | 成功/错误/运行中状态、参数/结果折叠 |

**Web 测试注意**：
- TDesign Vue Next 组件需要在测试中注册或全局 mock
- Pinia stores 使用 `setActivePinia(createPinia())` 初始化
- 使用 `vi.mock("@/api/client")` mock API 调用

#### 2.5 创建 Mock LLM 提供商

新增 `packages/core/src/llm/mock-provider.ts`

```typescript
import type { AgentMessage } from "@mariozechner/pi-agent-core";

export interface MockResponse {
  messages: AgentMessage[];
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  delay?: number;
}

export function createMockProvider(
  responses: MockResponse[]
): /* pi-ai Provider type */ {
  // 按调用顺序返回预设响应，用于确定性测试
}
```

在测试中使用 mock 提供商替代真实 LLM，消除对 API key 的依赖。

### 验收标准

- `pnpm test` 覆盖 core + server + web 三个包
- 核心路径（协作模式、API 端点、WebSocket）覆盖率 ≥ 80%
- 全部测试在无网络环境可运行

---

## P0-3: 结构化日志

### 现状

仅 5 处 `console.log/error`：
- `server/src/index.ts:28,34,42` — 启动/关闭/致命错误
- `server/src/middleware/error-handler.ts:4` — 未处理错误
- `web/src/composables/useWebSocket.ts:77` — WS 解析失败

Core 包中无任何日志。

### 实施方案

#### 新增文件

`packages/core/src/logger/index.ts`

```typescript
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}
```

`packages/core/src/logger/console-logger.ts`

- 实现 `Logger` 接口，包装 `console.log/error`
- 支持通过环境变量 `LOG_LEVEL` 控制输出级别
- JSON 格式输出（便于日志收集），包含 `timestamp`, `level`, `message`, `...meta`
- 开发模式下可切换为人类可读格式（通过 `LOG_FORMAT=pretty` 环境变量）

```typescript
export class ConsoleLogger implements Logger {
  constructor(private level: LogLevel = "info") {}

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ["debug", "info", "warn", "error"];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    if (!this.shouldLog(level)) return;
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...meta,
    };
    if (process.env.LOG_FORMAT === "pretty") {
      console.log(`[${entry.timestamp}] ${level.toUpperCase()} ${message}`, meta ?? "");
    } else {
      console.log(JSON.stringify(entry));
    }
  }

  debug(message: string, meta?: Record<string, unknown>) { this.log("debug", message, meta); }
  info(message: string, meta?: Record<string, unknown>) { this.log("info", message, meta); }
  warn(message: string, meta?: Record<string, unknown>) { this.log("warn", message, meta); }
  error(message: string, meta?: Record<string, unknown>) { this.log("error", message, meta); }
  child(bindings: Record<string, unknown>): Logger {
    return new BoundLogger(this, bindings);
  }
}
```

#### Core 包集成

在 `AgentSwarm` 构造函数中接受可选的 `logger?: Logger` 参数：

`packages/core/src/core/swarm.ts` → 新增字段并注入到模式执行器：

- `AgentSwarm` 内存储 `this.logger`
- 通过构造函数注入模式执行器（`new RouterMode(swarm, options)` → 添加 `logger` 参数）
- 关键日志点：
  - Swarm 创建/删除：`logger.info("swarm_created", { swarmId, mode })`
  - 对话开始/结束：`logger.info("conversation_started", { conversationId, swarmId })`
  - Agent 调用：`logger.debug("agent_invoked", { agentId, provider, modelId })`
  - 工具执行：`logger.debug("tool_executed", { agentId, toolName, duration })`
  - 错误：`logger.error("conversation_error", { conversationId, error })`

`packages/core/src/storage/sqlite.ts`

- 构造函数接受可选的 `logger?: Logger`
- 日志点：数据库打开、表创建、schema 迁移、查询慢（>100ms 时 `logger.warn`）

#### Server 包集成

`packages/server/src/index.ts`

- 替换 `console.log` → `logger.info`
- 替换 `console.error` → `logger.error`

`packages/server/src/middleware/error-handler.ts`

- 替换 `console.error` → `logger.error`

新增 `packages/server/src/middleware/request-logger.ts`

- 每个 HTTP 请求记录方法、路径、状态码、耗时
- 5xx → `error` 级别，4xx → `warn` 级别，2xx → `debug` 级别

`packages/server/src/ws.ts`

- WebSocket 连接/断开：`logger.info/debug`
- 消息处理错误：`logger.error`
- 介入/工具超时：`logger.warn`

#### Web 前端

`packages/web/src/composables/useWebSocket.ts:77`

- 替换 `console.error` → 使用前端 console 保持（Web 端 Logger 可延后实施，前端 console 足够）

### 验收标准

- Core 和 Server 中不再有裸 `console.log/error`（除 `index.ts` 启动消息外）
- 通过 `LOG_LEVEL=debug` 可查看详细日志流
- 通过 `LOG_FORMAT=pretty` 可在开发时使用人类可读格式
- 错误日志包含足够的上下文用于排查

---

## P1-1: 令牌使用量跟踪与成本仪表板

### 现状

- `messages.metadata` JSON 中存储 `usage: { input, output, cacheRead, cacheWrite, cost: { ... } }`
- `message-mapper.ts:44-49` 序列化 usage 数据
- 无聚合查询 API
- 前端未展示

### 实施方案

#### 数据库变更

`packages/core/src/storage/schema.ts` — `messages` 表不变，保持 metadata JSON 字段。新增聚合查询方法。

#### 存储层新增方法

`packages/core/src/storage/interface.ts` — `IStorage` 接口新增：

```typescript
interface ConversationUsage {
  conversationId: string;
  conversationTitle?: string;
  modelId: string;
  provider: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
}
interface DailyUsage {
  date: string;
  modelId: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
}
// 新增方法
getConversationUsage(conversationId: string): Promise<ConversationUsage[]>;
getDailyUsage(days?: number): Promise<DailyUsage[]>;
```

`packages/core/src/storage/sqlite.ts` — 实现：

```typescript
async getConversationUsage(conversationId: string): Promise<ConversationUsage[]> {
  // 查询该对话的所有 assistant 消息，解析 metadata JSON 聚合
  const messages = await this.db
    .select({ metadata: messagesTable.metadata })
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.conversationId, conversationId),
        eq(messagesTable.role, "assistant")
      )
    )
    .all();

  // 按 provider + modelId 聚合
  const usage = new Map<string, ConversationUsage>();
  for (const msg of messages) {
    if (!msg.metadata) continue;
    const meta = JSON.parse(msg.metadata);
    const key = `${meta.provider}:${meta.model}`;
    const existing = usage.get(key) ?? {
      conversationId, modelId: meta.model, provider: meta.provider,
      totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0, totalCost: 0,
    };
    existing.totalInputTokens += meta.usage?.input ?? 0;
    existing.totalOutputTokens += meta.usage?.output ?? 0;
    existing.totalTokens = existing.totalInputTokens + existing.totalOutputTokens;
    existing.totalCost += meta.usage?.cost?.total ?? 0;
    usage.set(key, existing);
  }
  return [...usage.values()];
}

async getDailyUsage(days = 30): Promise<DailyUsage[]> {
  const since = Date.now() - days * 86400000;
  const messages = await this.db
    .select({ metadata: messagesTable.metadata, timestamp: messagesTable.timestamp })
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.role, "assistant"),
        gte(messagesTable.timestamp, since)
      )
    )
    .all();
  // 按日期 + provider + modelId 聚合
  const usage = new Map<string, DailyUsage>();
  for (const msg of messages) {
    if (!msg.metadata) continue;
    const meta = JSON.parse(msg.metadata);
    const date = new Date(msg.timestamp).toISOString().slice(0, 10);
    const key = `${date}:${meta.provider}:${meta.model}`;
    // ... 聚合逻辑同 conversationUsage
  }
  return [...usage.values()].sort((a, b) => b.date.localeCompare(a.date));
}
```

#### API 路由

新增 `packages/server/src/routes/usage.ts`：

```
GET /api/usage/conversations/:id    → 单对话用量
GET /api/usage/daily?days=30        → 按日汇总用量
```

`packages/server/src/app.ts` 挂载路由：`app.use("/api", usageRouter)`。

#### 前端页面

新增 `packages/web/src/views/UsageView.vue`

- 页面级布局，卡片式展示：
- **概览卡片**：最近 7/30 天总 token、总成本
- **按日趋势图**：折线图（input/output/cost 三条线），可使用简单的 SVG 或 Chart.js
- **按模型分布**：饼图或柱状图展示各模型用量占比
- **按对话明细**：表格列出每个对话的总 token 和成本，点击跳转到对应对话

路由注册：在 `packages/web/src/router/index.ts` 添加 `/usage` → `UsageView.vue`。

侧边栏添加导航项：在 `AppSidebar.vue` 中添加入口。

#### 聊天界面实时显示

在 `ChatInput.vue` 或 `MessageList.vue` 底部区域添加当前对话的 token 消耗显示（调用 `GET /api/usage/conversations/:id` 并 poll 或通过 WebSocket 事件更新）。

### 验收标准

- `/api/usage/conversations/:id` 返回正确的聚合数据
- `/api/usage/daily` 支持 `days` 参数，返回正确的时间序列
- 用量页面可直观查看历史消耗趋势和模型分布
- 聊天界面底部实时显示当前对话 token 数

---

## P1-2: Web 搜索工具

### 现状

- 4 个工具：`handoff`, `route_to_agent`, `client-bridge`, `javascript_execute`
- 无外部搜索能力
- 客户端工具桥接模式已支持服务端定义工具、前端执行

### 实施方案

**作为服务端工具实现**（搜索 API 调用在服务端完成，无需客户端参与）。

#### 新增文件

`packages/core/src/tools/web-search.ts`

```typescript
import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

export interface WebSearchConfig {
  provider: "tavily" | "serpapi" | "brave" | "duckduckgo";
  apiKey?: string;
  maxResults?: number;
}

export function createWebSearchTool(config: WebSearchConfig): AgentTool<...> {
  return {
    name: "web_search",
    label: "搜索互联网",
    description: "使用搜索引擎搜索互联网获取最新信息。返回搜索结果列表，包含标题、URL 和摘要。",
    parameters: Type.Object({
      query: Type.String({ description: "搜索查询词" }),
      maxResults: Type.Optional(Type.Number({ description: "返回结果数量", default: 5 })),
    }),
    async execute(toolCallId, params): Promise<AgentToolResult> {
      const results = await searchWeb(config, params.query, params.maxResults ?? 5);
      return {
        toolCallId,
        toolName: "web_search",
        status: "success",
        data: results,
        output: JSON.stringify(results, null, 2),
      };
    },
  };
}

async function searchWeb(config: WebSearchConfig, query: string, maxResults: number) {
  switch (config.provider) {
    case "tavily": return searchTavily(config.apiKey!, query, maxResults);
    case "serpapi": return searchSerpApi(config.apiKey!, query, maxResults);
    case "brave": return searchBrave(config.apiKey!, query, maxResults);
    case "duckduckgo": return searchDuckDuckGo(query, maxResults);
  }
}

// DuckDuckGo 免费搜索 — 无需 API Key，通过 HTML 解析即时搜索结果
async function searchDuckDuckGo(query: string, maxResults: number) {
  const html = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q: query }),
  }).then((r) => r.text());

  // 解析 HTML 提取搜索结果
  const results: { title: string; url: string; snippet: string }[] = [];
  // 使用正则匹配 class="result__a" / class="result__snippet" 提取标题、URL、摘要
  const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([^<]*)<\/a>/g;
  // ... 解析逻辑

  return results.slice(0, maxResults);
}
```

- 使用 `fetch()` 调用各搜索 API
- **Tavily** 推荐作为默认（专为 AI Agent 设计，返回结构化结果 + 内容提取）
- **DuckDuckGo** 作为免费后备方案（无需 API Key，通过 HTML 解析获取结果）
- 结果统一格式：`{ title, url, snippet }`

#### 配置集成

在 `packages/core/src/llm/types.ts` 或 `agent-swarm.config.ts` 中添加工具配置：

```typescript
// agent-swarm.config.ts 扩展
tools: {
  webSearch: {
    enabled: true,
    provider: "duckduckgo" as const,  // 免费，无需 API Key；也可选 tavily/brave/serpapi
    // apiKey: process.env.TAVILY_API_KEY,  // Tavily/Brave/SerpAPI 时需要
    maxResults: 5,
  },
}
```

`AgentSwarm` 构造函数中，根据配置创建 `createWebSearchTool` 并注册。

#### 前端工具开关

在 `ChatInput.vue` 的工具切换面板中添加 "搜索互联网" 开关。在 `conversation.preferences.enabledTools` 中包含 `"web_search"` 时启用。

#### 环境变量

`.env.example` 中添加：
```
TAVILY_API_KEY=    # Tavily 需要（推荐，AI Agent 专用）
BRAVE_API_KEY=     # Brave Search 需要
SERPAPI_API_KEY=   # SerpAPI（Google 代理）需要
# DuckDuckGo 无需 API Key，开箱即用
```

### 验收标准

- Agent 可调用 `web_search("今天天气怎么样")` 并返回搜索结果
- 默认支持 **DuckDuckGo**（免费，无需配置 API Key）
- Tavily / Brave / SerpAPI 作为可选增强（需配置 API Key）
- 前端可开关搜索工具
- 搜索结果以 ToolCallCard 形式展示

---

## P1-3: Agent 协作可视化 DAG 图

### 现状

- `AgentStatus.vue`（389 行）仅以列表展示 agent 状态
- 事件系统包含 `handoff`、`agent_start/end` 等流转信息
- `conversation.ts` store 维护 `agentStates` Map

### 实施方案

#### 图数据结构

新增 `packages/web/src/utils/workflow-graph.ts`

```typescript
export interface GraphNode {
  id: string;           // agentId
  label: string;        // agent name
  status: "idle" | "thinking" | "executing_tool" | "handing_off" | "error";
  model?: string;
  totalMessages: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: "handoff" | "route" | "sequential" | "parallel";
  message?: string;
}

export function buildWorkflowGraph(
  events: SwarmEvent[],
  agents: AgentState[]
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  // 从事件流重建节点和边
  // agent_start → 创建/更新节点
  // handoff → 创建边
  // agent_end → 标记节点完成
}
```

#### 新建组件

`packages/web/src/components/chat/WorkflowGraph.vue`

- 基于真实 DOM + CSS 渲染（不引入第三方图库，减少依赖）
- 从左到右流式布局：根节点 → 参与的 agents → 边 → 最终输出
- 节点样式：圆形头像 + 名称 + 状态点 + 模型标签
- 边样式：箭头线 + 交接类型标签（handoff/route/sequential）
- 动画：当前活跃节点呼吸发光效果、流转边虚线动画
- 悬停效果：显示交接消息预览

**布局算法**：

- 基于协作模式选择布局策略：
  - **Router**：星型布局（orchestrator 居中，worker agents 环绕）
  - **Sequential**：水平链条
  - **Parallel**：垂直列
  - **Swarm**：动态网格（根据实时 handoff 事件增量构建）
  - **Debate**：三角布局（正方 ↔ 反方 → 法官）

- 使用 CSS Grid 实现响应式布局

#### 事件流订阅

组件实时监听 WebSocket 事件：

```typescript
// 在 WorkflowGraph.vue 中
const conversationStore = useConversationStore();

watch(() => conversationStore.agentStates, (states) => {
  for (const [id, state] of states) {
    updateNode(id, { status: state.status });
  }
}, { deep: true });

// 监听 handoff 事件创建边
// 监听 agent_start 创建节点
// 监听 agent_end 标记完成
```

#### 集成到聊天页面

修改 `ChatView.vue`，将右侧 `AgentStatus.vue` 替换或共存于 `WorkflowGraph.vue`：
- 方案 A：在 AgentStatus 卡片列表上方增加小图，点击展开全屏图
- **方案 B（推荐）**：AgentStatus 上方嵌入图视图，支持折叠/展开。默认折叠（保持现有列表视图），展开后显示完整图

### 验收标准

- 5 种协作模式分别有对应的可视化布局
- 实时更新：agent 状态变化时节点颜色/动画响应
- 支持折叠切换（列表 ↔ 图）
- 性能：10+ agent 的图渲染无明显延迟

---

## P1-4: MCP (Model Context Protocol) 客户端支持

### 现状

- 客户端工具桥接（`client-bridge.ts`）与 MCP 概念相似，但：
  - 非 JSON-RPC 2.0 协议
  - 无 MCP 服务器发现/握手
  - 无工具列表协商

### 实施方案

#### 新增模块

`packages/core/src/tools/mcp/` 目录：

```
mcp/
├── client.ts          # MCP 客户端实现
├── transport.ts       # 传输层：stdio + SSE
├── tool-provider.ts   # MCP 工具提供者，将 MCP tools 转为 AgentTool
└── types.ts           # MCP 协议类型
```

`types.ts`：

```typescript
export interface MCPServerConfig {
  id: string;
  transport: "stdio" | "sse";
  command?: string;      // stdio: npm exec, python, etc.
  args?: string[];
  url?: string;          // SSE: http://localhost:3001
  headers?: Record<string, string>;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
}

export interface MCPCapabilities {
  tools?: { listChanged?: boolean };
  resources?: Record<string, unknown>;
}
```

`client.ts`：

```typescript
import { spawn } from "child_process";
import { EventEmitter } from "events";

export class MCPClient extends EventEmitter {
  private servers: Map<string, MCPServerConnection> = new Map();

  async connectServer(config: MCPServerConfig): Promise<void> {
    // 根据 transport 类型选择连接方式
    // stdio: spawn 子进程
    // SSE: fetch + EventSource
    // 握手: initialize → initialized
  }

  async listTools(serverId: string): Promise<MCPToolDefinition[]> {
    // 发送 tools/list 请求
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>) {
    // 发送 tools/call 请求
  }

  async disconnectServer(serverId: string): Promise<void> {}
}
```

`tool-provider.ts`：

```typescript
import { Type } from "@sinclair/typebox";

export function createMCPToolProvider(client: MCPClient, serverId: string, toolDef: MCPToolDefinition): AgentTool {
  return {
    name: `mcp_${serverId}_${toolDef.name}`,
    label: toolDef.name,
    description: toolDef.description,
    parameters: Type.Unsafe(toolDef.inputSchema), // 转发 JSON Schema
    execute: async (toolCallId, params) => {
      const result = await client.callTool(serverId, toolDef.name, params);
      return {
        toolCallId,
        toolName: toolDef.name,
        status: "success",
        data: result,
        output: JSON.stringify(result, null, 2),
      };
    },
  };
}
```

#### 配置集成

`agentswarm.config.ts` 扩展：

```typescript
mcpServers: [
  {
    id: "filesystem",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
  },
  {
    id: "brave-search",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    env: { BRAVE_API_KEY: process.env.BRAVE_API_KEY },
  },
]
```

`AgentSwarm` 初始化时自动连接配置的 MCP 服务器，发现工具并注册。

#### 前端 MCP 管理

在 `SettingsView.vue` 或新的 `MCPSettings.vue` 中添加：
- MCP 服务器列表：显示名称、传输方式、状态（connected/disconnected/error）、工具数
- 添加/删除 MCP 服务器
- 重新连接

#### API 端点

新增 `packages/server/src/routes/mcp.ts`：

```
GET  /api/mcp/servers              → 列出已配置的 MCP 服务器
POST /api/mcp/servers              → 添加 MCP 服务器
DELETE /api/mcp/servers/:id        → 移除 MCP 服务器
POST /api/mcp/servers/:id/reconnect → 重新连接
GET  /api/mcp/servers/:id/tools    → 列出该服务器提供的工具
```

### 验收标准

- 可连接 stdio 和 SSE 两种传输的 MCP 服务器
- 支持至少 filesystem 和 brave-search 两个官方 MCP 服务器
- MCP 工具自动注册为 Agent 可用工具
- 前端可管理 MCP 服务器连接

---

## P2-1: Docker 部署

### 现状

- 无 Dockerfile 或 docker-compose
- Server 入口 `packages/server/src/index.ts`，监听 `localhost:3000`
- Web 开发服务器 `vite`，监听 `localhost:5173`
- `better-sqlite3` 是原生依赖，需要编译环境
- 数据目录 `./data/`

### 实施方案

#### 新增文件

`packages/server/Dockerfile`

```dockerfile
FROM node:20-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/server/package.json ./packages/server/

RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY packages/core/ ./packages/core/
COPY packages/server/ ./packages/server/

RUN pnpm run build:core && pnpm run build:server

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/agent-swarm.db

VOLUME /app/data

EXPOSE 3000

CMD ["node", "packages/server/dist/index.js"]
```

`packages/web/Dockerfile`

```dockerfile
FROM node:20-alpine AS build

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/web/package.json ./packages/web/

RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY packages/core/ ./packages/core/
COPY packages/web/ ./packages/web/

RUN pnpm run build:core && pnpm run build:web

FROM nginx:alpine
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
```

`packages/web/nginx.conf`

```nginx
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://server:3000;
    }

    location /ws {
        proxy_pass http://server:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

`docker-compose.yml`（根目录）

```yaml
services:
  server:
    build:
      context: .
      dockerfile: packages/server/Dockerfile
    ports:
      - "3000:3000"
    volumes:
      - agent-swarm-data:/app/data
    env_file:
      - .env
    restart: unless-stopped

  web:
    build:
      context: .
      dockerfile: packages/web/Dockerfile
    ports:
      - "8080:80"
    depends_on:
      - server
    restart: unless-stopped

volumes:
  agent-swarm-data:
```

Multi-stage 构建优化：

- 第一层：安装 dev 依赖 + 构建
- 第二层：仅复制运行时依赖 + dist 产物
- Server 镜像包含 `python3` + `make` + `g++` 用于 better-sqlite3 编译
- Web 镜像最终使用 nginx 提供静态文件

`.dockerignore`

```
node_modules
dist
data
.git
.gitignore
*.md
.DS_Store
```

### 验收标准

- `docker compose up` 一键启动 server + web
- `localhost:3000` 提供 API 服务
- `localhost:8080` 提供前端界面
- 数据持久化到 named volume

---

## P2-2: 暗色/亮色主题切换

### 现状

- 仅有暗色毛玻璃主题
- `packages/web/src/styles/index.css` 中定义 CSS 自定义属性（`--color-*`）
- Tailwind CSS v4 使用 `@theme` 块定义 token

### 实施方案

#### 策略

最小侵入方案：使用 CSS 自定义属性 + `data-theme` 属性控制。不修改组件样式，只修改 CSS 变量值。

#### 修改文件

`packages/web/src/styles/index.css`

- 将所有 CSS 变量从 `:root` 移到 `[data-theme="dark"]` 选择器中
- 新增 `[data-theme="light"]` 选择器，定义亮色主题变量

关键变量映射：

```css
[data-theme="dark"] {
  --color-surface-0: #0a0e1a;
  --color-surface-1: #111827;
  --color-surface-2: #1a1f35;
  --color-surface-3: #1f2937;
  --color-text-primary: #f3f4f6;
  --color-text-secondary: #9ca3af;
  --color-text-muted: #6b7280;
  --color-border-subtle: rgba(255, 255, 255, 0.06);
  --color-border-default: rgba(255, 255, 255, 0.1);
  /* ... 暗色渐变背景 (linear-gradient(135deg, #0a0e1a, #1a1f35, #0d1220)) */
}

[data-theme="light"] {
  --color-surface-0: #f8fafc;
  --color-surface-1: #ffffff;
  --color-surface-2: #f1f5f9;
  --color-surface-3: #e2e8f0;
  --color-text-primary: #0f172a;
  --color-text-secondary: #475569;
  --color-text-muted: #94a3b8;
  --color-border-subtle: rgba(0, 0, 0, 0.06);
  --color-border-default: rgba(0, 0, 0, 0.1);
  /* ... 亮色渐变背景 */
}
```

`.glass` 类暗色适配：亮色主题下改为 `background: rgba(255,255,255,0.8)` + `border: 1px solid rgba(0,0,0,0.08)`。

`.glass-hover`：亮色主题下悬停背景改为 `rgba(255,255,255,0.95)`。

`packages/web/src/App.vue`

- 添加 `data-theme` 属性到 `#app` 或 `<html>`

```html
<template>
  <div :data-theme="themeStore.current">
    <router-view />
  </div>
</template>
```

新增 `packages/web/src/stores/theme.ts`

```typescript
import { defineStore } from "pinia";
import { ref, watch } from "vue";

export const useThemeStore = defineStore("theme", () => {
  const current = ref<"dark" | "light">(
    (localStorage.getItem("theme") as "dark" | "light") ?? "dark"
  );

  watch(current, (val) => {
    localStorage.setItem("theme", val);
    document.documentElement.setAttribute("data-theme", val);
  }, { immediate: true });

  function toggle() {
    current.value = current.value === "dark" ? "light" : "dark";
  }

  return { current, toggle };
});
```

`packages/web/src/components/layout/AppSidebar.vue`（或 `SettingsView.vue`）

- 添加主题切换按钮：图标按钮（太阳/月亮），点击调用 `themeStore.toggle()`

### 验收标准

- 主题切换按钮在侧边栏可见
- 点击后主题即时切换，无需刷新
- 亮色主题下所有文本可读（对比度足够）
- 刷新后主题持久化（localStorage）

---

## P2-3: 消息反馈按钮

### 现状

- `MessageItem.vue` 渲染消息但无可交互的反馈功能
- 无反馈 API 端点
- `messages` 表无 feedback 字段

### 实施方案

#### 数据库变更

`packages/core/src/storage/schema.ts`

- `messages` 表新增 `feedback TEXT` 列（可为 NULL，值为 `"helpful"` / `"not_helpful"`）
- 通过 `ensureConversationColumns` 方法自动迁移

`packages/core/src/storage/interface.ts`

- `IStorage` 新增：
```typescript
setMessageFeedback(messageId: string, feedback: "helpful" | "not_helpful"): Promise<void>;
```

`packages/core/src/storage/sqlite.ts`

- 实现 `setMessageFeedback`：`UPDATE messages SET feedback = ? WHERE id = ?`
- `getMessages` 返回的 `StoredMessage` 增加 `feedback` 字段

#### API 端点

`packages/server/src/routes/messages.ts` 新增：

```
POST /api/conversations/:id/messages/:msgId/feedback
  body: { feedback: "helpful" | "not_helpful" }
```

#### 前端组件

修改 `packages/web/src/components/chat/MessageItem.vue`

- 助手消息（role="assistant"）底部添加反馈按钮组：
  - 👍 点赞（helpful）
  - 👎 点踩（not_helpful）
- 状态：
  - 未评价：两个按钮无色（outline 样式）
  - 已评价：选中按钮高亮（accent 色填充）
- 点击后调用 API，更新本地状态
- 防重复点击（已评价消息不允许再切换）

```html
<!-- 在 MessageItem.vue 中，助手消息尾部 -->
<div class="message-feedback" v-if="msg.role === 'assistant' && !streaming">
  <button
    class="feedback-btn"
    :class="{ active: msg.feedback === 'helpful' }"
    :disabled="!!msg.feedback"
    @click="submit('helpful')"
  >👍</button>
  <button
    class="feedback-btn"
    :class="{ active: msg.feedback === 'not_helpful' }"
    :disabled="!!msg.feedback"
    @click="submit('not_helpful')"
  >👎</button>
</div>
```

#### 类型更新

`packages/web/src/types/index.ts` — `ChatMessage` 新增 `feedback?: "helpful" | "not_helpful"`

### 验收标准

- 助手消息下方显示反馈按钮
- 点击后按钮状态视觉反馈正确
- 已反馈消息不可重复提交
- 刷新后反馈状态保持
- 数据库 feedback 列正确保存

---

## 实施顺序建议

```
第1周:   P0-1 (API 验证) + P0-3 前半 (Logger 接口 + Console 实现)
第2周:   P0-2 前半 (统一测试框架 + Core 测试补充)
第3周:   P0-2 后半 (Server 测试 + Web 组件测试)
第4周:   P1-1 (Token 用量跟踪)
第5周:   P1-2 (Web 搜索工具)
第6周:   P1-3 (DAG 可视化)
第7周:   P1-4 (MCP 客户端)
第8周:   P2-1 (Docker 部署)
第9周:   P2-2 (主题切换)
第10周:  P2-3 (消息反馈)
```

---

## 环境变量汇总

阶段一中涉及的新增环境变量：

```bash
# 日志
LOG_LEVEL=info         # debug | info | warn | error
LOG_FORMAT=pretty       # 留空为 JSON，开发时设为 pretty

# 搜索
TAVILY_API_KEY=          # Tavily 需要（可选，推荐）
BRAVE_API_KEY=           # Brave Search 需要（可选）
SERPAPI_API_KEY=         # SerpAPI 需要（可选）
# DuckDuckGo 免费，无需 API Key

# MCP 服务器（也可在 agent-swarm.config.ts 中配置）
MCP_SERVER_FILESYSTEM_ENABLED=false
MCP_SERVER_BRAVE_ENABLED=false
```

`agent-swarm.config.ts` 扩展字段预览：

```typescript
export default defineConfig({
  // ... 现有字段

  // 新增
  tools: {
    webSearch: {
      enabled: true,
      provider: "duckduckgo",  // 免费默认；也可选 tavily/brave/serpapi
      // apiKey: process.env.TAVILY_API_KEY,  // 仅非 duckduckgo 时需要
      maxResults: 5,
    },
  },

  mcpServers: [
    // {
    //   id: "filesystem",
    //   transport: "stdio",
    //   command: "npx",
    //   args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/agent-swarm-io"],
    // },
  ],
});
```
