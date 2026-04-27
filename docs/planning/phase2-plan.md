# 阶段二实施计划：差异化能力

## 概述

阶段一补齐了基础短板（API 验证、测试、日志、主题、Docker、搜索工具）。阶段二聚焦于**差异化能力**——让 Agent Swarm 从"可用"变成"强大"。

基于阶段一的实践经验，本阶段放弃大而全的路线图，聚焦 6 个高性价比项目。

预计周期：6-8 周。

---

## P0-1: MCP 协议客户端支持（阶段一未完成）

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
  url?: string;        // SSE: http://localhost:3001
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
- SSE 传输：`fetch` + `EventSource`（或轮询）
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

- `createMCPToolProvider(client, serverId, toolDef)` → 返回标准的 `AgentTool`
- 工具名前缀：`mcp_{serverId}_{toolName}` 避免冲突

#### 配置集成

`agent-swarm.config.ts` 新增 `mcpServers` 字段：

```typescript
mcpServers: [
  {
    id: "fs",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
  },
]
```

`AgentSwarm` 初始化时连接所有 MCP 服务器，发现工具并注册到全局工具池。

#### 前端 MCP 管理

`packages/web/src/components/settings/MCPSettings.vue`（设置页新增 tab）

- MCP 服务器列表：名称、传输方式、状态、工具数
- 添加/删除服务器表单
- 重连/断开按钮

#### API 端点

`packages/server/src/routes/mcp.ts`

```
GET    /api/mcp/servers            → 列出 MCP 服务器
POST   /api/mcp/servers            → 添加
DELETE /api/mcp/servers/:id        → 移除
POST   /api/mcp/servers/:id/reconnect → 重连
GET    /api/mcp/servers/:id/tools  → 列出可用工具
```

### 验收标准

- 可连接 stdio（filesystem）和 SSE 两种 MCP 服务器
- MCP 工具自动注册为 Agent 可用工具
- 前端可查看和管理 MCP 服务器
- 错误处理：服务器断连时 Agent 调用返回友好错误

---

## P0-2: LLM 调用日志专用表

### 现状

- LLM 调用 token/usage 数据嵌入在 `messages.metadata` JSON 中
- 无法高效按 provider/modelId/日期 聚合
- 无独立的调用记录（单次 LLM 调用 = 一行）

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
  status: text("status").notNull().default("ok"), // ok | error
  errorMessage: text("error_message"),
  timestamp: integer("timestamp").notNull(),
});
```

`packages/core/src/storage/interface.ts` 新增：

```typescript
logLLMCall(call: LLMCall): Promise<void>;
queryLLMCalls(filter: { conversationId?: string; providerId?: string; days?: number }): Promise<LLMCall[]>;
```

**数据写入点**：`packages/core/src/core/swarm.ts` 中的 `testModelConnection` 方法附近，或 `packages/core/src/llm/provider.ts` 中的实际调用点。

**注意事项**：需要在 `pi-ai` 的 `complete()` 调用层附近拦截，记录每次调用的 latency/usage/status。由于 `pi-ai` 是外部库，最佳切入点是在 `AgentSwarm` 或 `Conversation` 中包装调用。

### 验收标准

- 每次 LLM 调用写入一条 `llm_calls` 记录
- 可查询某对话的所有调用
- 可统计某 provider/模型的总 token 和成本
- 现有测试不受影响

---

## P1-1: LLM 故障转移

### 现状

- Agent 配置中指定 `{ provider, modelId }`，如果该模型不可用，对话直接报错
- 无重试、无后备模型

### 目标

模型不可用时自动重试并切换到备用模型，提升可靠性。

### 实施方案

`packages/core/src/llm/types.ts`（或现有 `types.ts`）扩展：

```typescript
export interface FallbackConfig {
  maxRetries?: number;        // 默认 2
  retryDelayMs?: number;      // 默认 1000
  fallbackModels?: Array<{
    provider: string;
    modelId: string;
  }>;
}
```

`packages/core/src/core/types.ts` — `SwarmAgentConfig` 和 `AgentPreset` 新增：

```typescript
fallback?: FallbackConfig;
```

`packages/core/src/llm/fallback-provider.ts`：

```typescript
export function withFallback(
  agent: Agent,
  config: FallbackConfig,
  resolveModel: (provider: string, modelId: string) => ModelConfig,
): Agent {
  // 包装 agent 的 prompt 方法：
  // 1. 调用原始 prompt
  // 2. 如果失败且可重试 → 等待 → 重试
  // 3. 达到重试上限后尝试 fallbackModels
  // 4. 全部失败才抛错
}
```

**集成点**：`packages/core/src/core/agent-factory.ts` 中创建 Agent 时应用 fallback 包装。

### 验收标准

- 模型返回 5xx 时自动重试 2 次
- 重试全部失败后切换到 `fallbackModels[0]`
- 切换时产生事件通知
- 前端 Agent 配置表单增加 fallback 模型字段

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

- 复制源对话的消息历史到新对话
- 保持 `contextResetAt` 边界
- 新对话绑定到不同的 swarm/agent 配置

**前端**：

`packages/web/src/views/ChatView.vue` 新增对比模式：

- 消息列表上方增加分支按钮
- 分支后右侧显示 swarm/agent 配置选择器
- 并排对比视图（可选）

**WebSocket 管理**：分支创建后自动广播 `conversation_created` 事件。

### 验收标准

- 可在对话中创建分支（使用不同 swarm 配置）
- 分支继承源对话消息历史
- 不影响源对话

---

## P2-1: Agent 预设模板市场

### 现状

- Agent 预设可创建但无法导出/导入
- 内置 10 个预设，无社区共享机制

### 目标

实现 Agent 预设的导出/导入，为后续社区共享打下基础。

### 实施方案

`packages/core/src/core/swarm.ts` 新增：

```typescript
async exportAgentPreset(id: string): Promise<string>              // → JSON string
async importAgentPreset(json: string): Promise<AgentPreset>       // ← JSON string
```

导出字段：`id, name, description, systemPrompt, model, category, tags`（排除 `builtIn`）。

**API 端点**：

```
GET  /api/agents/:id/export → JSON 下载
POST /api/agents/import     → body: { json: "..." } 导入
```

**前端**：

`packages/web/src/components/agents/AgentCard.vue` 扩展：

- 导出按钮 → 下载 `.json` 文件
- 导入按钮 → 文件选择 → 解析 → 确认 → 创建

### 验收标准

- Agent 预设可导出为 JSON 文件
- 从 JSON 文件可导入恢复
- 导入时 ID 冲突给出提示
- 内置预设可导出但不可删除

---

## 实施顺序建议

```
第1-2周:  P0-1 (MCP 协议) — 最复杂，先做
第3周:    P0-2 (LLM 调用日志表) — 独立，可并行
第4周:    P1-1 (LLM 故障转移) — 依赖 P0-2 的日志能力
第5周:    P1-2 (对话分支与对比) — 新功能
第6周:    P2-1 (Agent 预设市场) — 收尾
```

总工时：约 6 周（视 MCP 复杂度可能延长至 8 周）。

---

## 环境变量新增

```bash
# MCP 服务器（也可在 agent-swarm.config.ts 中配置）
MCP_SERVER_FILESYSTEM_ENABLED=false
MCP_SERVER_BRAVE_ENABLED=false

# LLM 故障转移
LLM_RETRY_MAX=2
LLM_RETRY_DELAY_MS=1000
```

---

## 与阶段一的关系

| 阶段一完成项 | 阶段二依赖 |
|-------------|-----------|
| API 请求验证 | MCP API 路由复用 validate 中间件 |
| 结构化日志 | LLM 调用日志写入对接 Logger |
| Token 用量跟踪 | LLM 调用日志表取代 metadata 嵌入方案 |
| Web 搜索工具 | MCP 客户端可作为搜索工具的替代接入方式 |
| Docker 部署 | 阶段二新增服务（如 MCP 服务器）需扩展 docker-compose |
