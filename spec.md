# Agent Swarm — 多 Agent 协作框架规格书

## 1. 项目概述

基于 `@mariozechner/pi-agent-core` 构建的多 Agent 协作框架，包含后端 SDK/服务 + Vue 前端 UI，支持多种协作模式、用户介入、可配置 LLM 后端、历史消息持久化（SQLite）。

### 1.1 核心功能

- **多 Agent 协作**：支持 Router / Sequential / Parallel / Swarm / Debate 五种协作模式，通过 Orchestrator 调度多个 pi-agent-core Agent 实例
- **用户介入机制**：7 个介入点、5 种策略，支持分级配置
- **可配置 LLM 后端**：通过 pi-ai 桥接多提供商，Agent 级别可独立配置模型
- **历史消息持久化**：SQLite（better-sqlite3 + drizzle-orm）存储，支持对话恢复和上下文窗口管理
- **前端交互界面**：Vue 3 + Vite 构建的 Web UI，包含对话交互、Agent 状态可视化、协作流程展示、用户介入操作面板、Swarm 配置管理、历史对话浏览、LLM 设置

### 1.2 技术栈

| 层 | 技术 |
|---|------|
| **后端 SDK** | TypeScript + `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai` + `@sinclair/typebox` |
| **后端 API 服务** | Node.js + Express.js + WebSocket (ws)，HTTP REST + WS 双协议 |
| **数据存储** | better-sqlite3 + drizzle-orm + drizzle-kit |
| **前端框架** | Vue 3 (Composition API) + Vite + TypeScript |
| **前端状态** | Pinia |
| **前端路由** | Vue Router |
| **前端 UI** | TDesign Vue Next |
| **前端样式** | Tailwind CSS + TDesign 主题定制 |
| **Monorepo** | pnpm workspace + TypeScript project references |

### 1.3 关键技术决策

1. **WebSocket 而非 SSE**：对话涉及双向通信（流式推送 + 用户介入回传），WebSocket 是更自然的选择
2. **Pinia 而非 Vuex**：Pinia 是 Vue 3 官方推荐，API 更简洁，TypeScript 支持更好
3. **TDesign**：对 Vue 3 支持成熟，组件丰富，适合企业级场景
4. **better-sqlite3**：同步 API 性能优异，在 Node.js 服务端无阻塞风险
5. **pnpm monorepo**：三个 package（core/server/web），共享类型通过 core 导出

---

## 2. 核心架构

```
┌──────────────────────────────────────────────────────┐
│                    AgentSwarm                         │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐      │
│  │  Agent A   │  │  Agent B   │  │  Agent C   │      │
│  │ (pi-agent) │  │ (pi-agent) │  │ (pi-agent) │      │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘      │
│        │               │               │              │
│  ┌─────┴───────────────┴───────────────┴──────┐       │
│  │            Swarm Orchestrator              │       │
│  │  (路由 / 调度 / 协作模式 / 用户介入)        │       │
│  └─────────────────┬─────────────────────────┘       │
│                    │                                  │
│  ┌─────────────────┴─────────────────────────┐       │
│  │             Shared Services               │       │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────┐  │       │
│  │  │ LLM Conf │ │ SQLite   │ │ History   │  │       │
│  │  │ Provider │ │ Storage  │ │ Manager   │  │       │
│  │  └──────────┘ └──────────┘ └───────────┘  │       │
│  └───────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────┘
```

### 2.1 层次关系

| 层 | 职责 |
|---|------|
| **AgentSwarm** | 顶层入口，管理 swarm 生命周期 |
| **SwarmOrchestrator** | 协作模式调度、消息路由、用户介入控制 |
| **Agent (pi-agent-core)** | 单个 LLM Agent 实例，工具执行、状态管理 |
| **Shared Services** | LLM 配置、SQLite 存储、历史消息 |

---

## 3. 协作模式

### 3.1 Router 模式（路由模式）

一个主 Agent（Orchestrator）负责理解用户意图，将任务路由到最合适的专业 Agent。

```
User → Orchestrator Agent → Route to → Agent A / Agent B / Agent C
                                        ← Result ←
```

**特性：**
- Orchestrator 自动选择目标 Agent
- 支持多轮路由（结果不满足时可重新路由）
- 目标 Agent 可以继续与用户交互

### 3.2 Sequential 模式（顺序模式）

多个 Agent 按预设顺序依次处理，前一个 Agent 的输出作为后一个的输入。

```
User → Agent A → Agent B → Agent C → User
```

**特性：**
- 可定义 pipeline，每个节点可配置转换逻辑
- 支持 conditional 分支（基于中间结果决定下一步）
- 任一节点可暂停等待用户介入

### 3.3 Parallel 模式（并行模式）

多个 Agent 同时处理同一输入，结果由 Aggregator 合并。

```
        ┌→ Agent A ─┐
User ──→├→ Agent B ──┤→ Aggregator → User
        └→ Agent C ─┘
```

**特性：**
- 支持自定义聚合策略（投票、合并、择优）
- 可配置超时和容错策略
- 聚合结果可再路由回 Agent 进一步处理

### 3.4 Swarm 模式（群聊模式）

多个 Agent 在共享上下文中自由协作，由 Orchestrator 动态决定下一个发言的 Agent。

```
User → Orchestrator → Agent A speaks → Orchestrator → Agent B speaks → ... → User
```

**特性：**
- 类似 OpenAI Swarm 的 handoff 机制
- Agent 之间可传递控制权
- 支持最大轮次限制防止死循环
- 共享对话上下文，各 Agent 保持独立 system prompt

### 3.5 Debate 模式（辩论模式）

多个 Agent 就同一话题进行多轮辩论，由 Judge Agent 总结。

```
User → Agent A (Pro) ←→ Agent B (Con) → Judge Agent → User
```

**特性：**
- 可配置辩论轮次
- 支持 Judge 评分和裁决
- 适用于分析、决策场景

---

## 4. 用户介入机制

### 4.1 介入点

| 介入点 | 触发时机 | 说明 |
|--------|---------|------|
| `before_agent_start` | Agent 开始处理前 | 用户可修改输入或取消 |
| `after_agent_end` | Agent 完成后 | 用户可审核结果、要求重试 |
| `before_tool_call` | 工具执行前 | 用户可批准/拒绝/修改工具调用 |
| `after_tool_call` | 工具执行后 | 用户可审核工具返回 |
| `on_handoff` | Agent 交接时 | 用户可决定是否允许交接 |
| `on_error` | 发生错误时 | 用户可选择重试/跳过/中止 |
| `on_approval_required` | 需要用户确认时 | 显式等待用户确认 |

### 4.2 介入策略

```typescript
type InterventionStrategy =
  | "auto"          // 自动执行，不等待用户
  | "confirm"       // 需要用户确认后继续
  | "review"        // 执行后展示结果供用户审核
  | "edit"          // 用户可编辑后再执行
  | "reject"        // 直接拒绝，跳过此步
```

### 4.3 介入回调接口

```typescript
interface InterventionHandler {
  onIntervention(point: InterventionPoint, context: InterventionContext): 
    Promise<InterventionDecision>;
}

interface InterventionDecision {
  action: "approve" | "reject" | "edit" | "retry" | "abort";
  editedInput?: string;       // action=edit 时的修改后输入
  targetAgent?: string;       // 重新路由的目标 agent
  reason?: string;            // 决策原因
}
```

---

## 5. Agent 定义

### 5.1 Agent 配置

```typescript
interface SwarmAgentConfig {
  /** Agent 唯一标识 */
  id: string;
  /** Agent 名称 */
  name: string;
  /** Agent 描述（用于路由决策） */
  description: string;
  /** 系统提示词 */
  systemPrompt: string;
  /** LLM 模型配置 */
  model: ModelConfig;
  /** Agent 可用工具 */
  tools?: AgentTool<any>[];
  /** 思考级别 */
  thinkingLevel?: ThinkingLevel;
  /** 介入配置 */
  interventions?: Partial<Record<InterventionPoint, InterventionStrategy>>;
  /** 最大连续轮次 */
  maxTurns?: number;
  /** 思考预算 */
  thinkingBudgets?: ThinkingBudgets;
}
```

### 5.2 模型配置

```typescript
interface ModelConfig {
  /** 提供商：anthropic / openai / google / bedrock / openrouter 等 */
  provider: string;
  /** 模型 ID */
  modelId: string;
  /** API Key（可选，优先使用全局配置） */
  apiKey?: string;
  /** Base URL（可选，用于自定义端点） */
  baseUrl?: string;
  /** 额外参数 */
  options?: Record<string, any>;
}
```

### 5.3 Agent 工厂

基于 pi-agent-core 的 `Agent` 类创建实例：

```typescript
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel, streamSimple } from "@mariozechner/pi-ai";

function createAgent(config: SwarmAgentConfig): Agent {
  return new Agent({
    initialState: {
      systemPrompt: config.systemPrompt,
      model: getModel(config.model.provider, config.model.modelId),
      thinkingLevel: config.thinkingLevel ?? "off",
      tools: config.tools ?? [],
      messages: [],
    },
    streamFn: streamSimple,
    // 集成介入钩子
    beforeToolCall: async (ctx) => {
      const strategy = config.interventions?.before_tool_call ?? "auto";
      if (strategy !== "auto") {
        return await interventionHandler.onIntervention(
          { point: "before_tool_call", strategy },
          ctx
        );
      }
    },
    afterToolCall: async (ctx) => {
      const strategy = config.interventions?.after_tool_call ?? "auto";
      if (strategy !== "auto") {
        return await interventionHandler.onIntervention(
          { point: "after_tool_call", strategy },
          ctx
        );
      }
    },
  });
}
```

---

## 6. Swarm 定义与协作配置

### 6.1 Swarm 配置

```typescript
interface SwarmConfig {
  /** Swarm 唯一标识 */
  id: string;
  /** Swarm 名称 */
  name: string;
  /** 协作模式 */
  mode: CollaborationMode;
  /** 参与的 Agent 列表 */
  agents: SwarmAgentConfig[];
  /** Orchestrator 配置（Router/Swarm 模式需要） */
  orchestrator?: SwarmAgentConfig;
  /** 聚合策略（Parallel 模式需要） */
  aggregator?: AggregationStrategy;
  /** 辩论配置（Debate 模式需要） */
  debateConfig?: DebateConfig;
  /** Pipeline 配置（Sequential 模式需要） */
  pipeline?: PipelineStep[];
  /** 全局介入配置 */
  interventions?: Partial<Record<InterventionPoint, InterventionStrategy>>;
  /** 最大总轮次 */
  maxTotalTurns?: number;
  /** 最大并行数（Parallel 模式） */
  maxConcurrency?: number;
}

type CollaborationMode = "router" | "sequential" | "parallel" | "swarm" | "debate";

type AggregationStrategy =
  | { type: "merge" }                    // 合并所有结果
  | { type: "vote"; quorum: number }     // 投票，达到法定人数
  | { type: "best"; judgeAgent: string } // 由指定 Agent 择优
  | { type: "custom"; handler: string }; // 自定义聚合函数名

interface DebateConfig {
  rounds: number;           // 辩论轮次
  judgeAgent: string;       // 裁判 Agent ID
  proAgent: string;         // 正方 Agent ID
  conAgent: string;         // 反方 Agent ID
}

interface PipelineStep {
  agentId: string;
  condition?: (output: any) => boolean;  // 条件分支
  transform?: (output: any) => any;      // 输出转换
  onSkip?: string;                       // 跳过时转到的步骤 ID
}
```

---

## 7. LLM 后端配置

### 7.1 全局 LLM 配置

```typescript
interface LLMBackendConfig {
  /** 默认提供商 */
  defaultProvider: string;
  /** 默认模型 */
  defaultModel: string;
  /** 各提供商 API Key 映射 */
  apiKeys: Record<string, string>;
  /** 自定义端点 */
  endpoints?: Record<string, {
    baseUrl: string;
    headers?: Record<string, string>;
  }>;
  /** 默认思考级别 */
  defaultThinkingLevel?: ThinkingLevel;
  /** 默认思考预算 */
  defaultThinkingBudgets?: ThinkingBudgets;
}
```

### 7.2 配置文件格式 (`agent-swarm.config.ts`)

```typescript
import { defineConfig } from "agent-swarm";

export default defineConfig({
  llm: {
    defaultProvider: "anthropic",
    defaultModel: "claude-sonnet-4-20250514",
    apiKeys: {
      anthropic: process.env.ANTHROPIC_API_KEY!,
      openai: process.env.OPENAI_API_KEY!,
      google: process.env.GOOGLE_API_KEY!,
    },
  },
  storage: {
    type: "sqlite",
    path: "./data/agent-swarm.db",
  },
  swarms: [
    {
      id: "research-team",
      name: "Research Team",
      mode: "router",
      orchestrator: {
        id: "router",
        name: "Router",
        description: "Routes questions to the right specialist",
        systemPrompt: "You are a router. Decide which specialist to use.",
        model: { provider: "anthropic", modelId: "claude-sonnet-4-20250514" },
      },
      agents: [
        {
          id: "researcher",
          name: "Researcher",
          description: "Good at web search and information gathering",
          systemPrompt: "You are a research specialist.",
          model: { provider: "openai", modelId: "gpt-4o" },
        },
        {
          id: "writer",
          name: "Writer",
          description: "Good at writing and summarizing",
          systemPrompt: "You are a writing specialist.",
          model: { provider: "anthropic", modelId: "claude-sonnet-4-20250514" },
        },
      ],
    },
  ],
});
```

---

## 8. 数据存储（SQLite）

### 8.1 技术选型

- **better-sqlite3**：同步 API，性能优异，适合 Node.js
- 使用 **drizzle-orm** 作为 ORM 层，提供类型安全

### 8.2 数据库 Schema

```sql
-- Swarm 配置表
CREATE TABLE swarms (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  config      TEXT NOT NULL,  -- JSON: SwarmConfig
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Agent 实例表
CREATE TABLE agents (
  id          TEXT PRIMARY KEY,
  swarm_id    TEXT NOT NULL REFERENCES swarms(id),
  name        TEXT NOT NULL,
  config      TEXT NOT NULL,  -- JSON: SwarmAgentConfig
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- 对话/会话表
CREATE TABLE conversations (
  id          TEXT PRIMARY KEY,
  swarm_id    TEXT NOT NULL REFERENCES swarms(id),
  title       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- 消息表
CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  agent_id        TEXT REFERENCES agents(id),
  role            TEXT NOT NULL,  -- user / assistant / tool_result / system / notification
  content         TEXT,           -- 文本内容
  thinking        TEXT,           -- 思考内容
  tool_calls      TEXT,           -- JSON: ToolCall[]
  tool_call_id    TEXT,           -- tool_result 关联的 toolCallId
  metadata        TEXT,           -- JSON: 额外元数据
  timestamp       INTEGER NOT NULL,
  created_at      INTEGER NOT NULL
);

-- 事件日志表（可选，用于审计和调试）
CREATE TABLE events (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  agent_id        TEXT REFERENCES agents(id),
  event_type      TEXT NOT NULL,  -- agent_start / turn_start / tool_execution_start / ...
  event_data      TEXT,           -- JSON
  timestamp       INTEGER NOT NULL
);

-- 索引
CREATE INDEX idx_messages_conversation ON messages(conversation_id, timestamp);
CREATE INDEX idx_messages_agent ON messages(agent_id);
CREATE INDEX idx_events_conversation ON events(conversation_id, timestamp);
CREATE INDEX idx_conversations_swarm ON conversations(swarm_id);
```

### 8.3 存储接口

```typescript
interface IStorage {
  // Swarm 管理
  saveSwarm(config: SwarmConfig): Promise<void>;
  loadSwarm(id: string): Promise<SwarmConfig | null>;
  listSwarms(): Promise<SwarmConfig[]>;
  deleteSwarm(id: string): Promise<void>;

  // 对话管理
  createConversation(swarmId: string, title?: string): Promise<Conversation>;
  getConversation(id: string): Promise<Conversation | null>;
  listConversations(swarmId: string): Promise<Conversation[]>;
  deleteConversation(id: string): Promise<void>;

  // 消息管理
  appendMessage(conversationId: string, message: StoredMessage): Promise<void>;
  getMessages(conversationId: string): Promise<StoredMessage[]>;
  getMessagesByAgent(conversationId: string, agentId: string): Promise<StoredMessage[]>;
  clearMessages(conversationId: string): Promise<void>;

  // 事件日志
  logEvent(conversationId: string, event: StoredEvent): Promise<void>;
  getEvents(conversationId: string, eventType?: string): Promise<StoredEvent[]>;
}
```

### 8.4 消息与 pi-agent-core 的转换

```typescript
// pi-agent-core AgentMessage → 存储
function agentMessageToStored(msg: AgentMessage, agentId: string): StoredMessage;

// 存储 → pi-agent-core AgentMessage（用于恢复历史）
function storedToAgentMessage(msg: StoredMessage): AgentMessage;
```

---

## 9. 核心 API

### 9.1 顶层接口

```typescript
import { AgentSwarm } from "agent-swarm";

// 创建 Swarm 实例
const swarm = new AgentSwarm({
  configPath: "./agent-swarm.config.ts",
  // 或直接传入配置
  config: { /* ... */ },
});

// 初始化（连接 SQLite、创建 Agent 实例）
await swarm.init();

// 启动对话
const conversation = await swarm.createConversation("research-team");

// 发送消息（返回 AsyncIterable 事件流）
const stream = conversation.prompt("分析一下 AI 行业最新趋势");

for await (const event of stream) {
  switch (event.type) {
    case "agent_start":
      console.log(`Agent ${event.agentId} starting...`);
      break;
    case "message_update":
      process.stdout.write(event.delta ?? "");
      break;
    case "tool_execution_start":
      console.log(`Tool ${event.toolName} executing...`);
      break;
    case "intervention_required":
      // 等待用户介入
      const decision = await getUserDecision(event);
      event.respond(decision);
      break;
    case "agent_end":
      console.log(`Agent ${event.agentId} completed`);
      break;
    case "swarm_end":
      console.log("Swarm completed", event.finalMessage);
      break;
  }
}

// 使用介入回调模式
conversation.onIntervention(async (point, context) => {
  if (point === "before_tool_call" && context.toolName === "delete_file") {
    return { action: "reject", reason: "不允许删除文件" };
  }
  return { action: "approve" };
});

// 中断当前运行
conversation.abort();

// 获取历史消息
const history = await conversation.getHistory();

// 恢复对话
const resumed = await swarm.resumeConversation(conversation.id);

// 关闭
await swarm.close();
```

### 9.2 事件类型

```typescript
type SwarmEvent =
  | { type: "swarm_start"; swarmId: string; conversationId: string }
  | { type: "agent_start"; agentId: string; agentName: string }
  | { type: "agent_end"; agentId: string; agentName: string }
  | { type: "turn_start"; agentId: string; turn: number }
  | { type: "turn_end"; agentId: string; turn: number }
  | { type: "message_start"; agentId: string; role: string }
  | { type: "message_update"; agentId: string; delta?: string }
  | { type: "message_end"; agentId: string; role: string }
  | { type: "tool_execution_start"; agentId: string; toolName: string; toolCallId: string }
  | { type: "tool_execution_update"; agentId: string; toolCallId: string; progress?: any }
  | { type: "tool_execution_end"; agentId: string; toolName: string; toolCallId: string; isError: boolean }
  | { type: "handoff"; fromAgentId: string; toAgentId: string; reason?: string }
  | { type: "intervention_required"; point: InterventionPoint; context: InterventionContext; respond: (decision: InterventionDecision) => void }
  | { type: "error"; agentId?: string; error: Error }
  | { type: "swarm_end"; swarmId: string; conversationId: string; finalMessage: string };
```

---

## 10. 协作模式详细流程

### 10.1 Router 模式

```
1. 用户消息 → Orchestrator Agent
2. Orchestrator 分析意图，选择目标 Agent
3. 目标 Agent 处理消息（可多轮）
4. 目标 Agent 返回结果
5. Orchestrator 可选择：
   a. 直接返回结果给用户
   b. 路由到另一个 Agent 继续处理
   c. 要求用户补充信息
```

Orchestrator 的工具：
```typescript
const routeToAgentTool: AgentTool = {
  name: "route_to_agent",
  label: "Route to Agent",
  description: "Route the conversation to a specialist agent",
  parameters: Type.Object({
    agentId: Type.String({ description: "Target agent ID" }),
    message: Type.String({ description: "Message to send to the agent" }),
  }),
  execute: async (id, params) => ({
    content: [{ type: "text", text: `Routing to ${params.agentId}...` }],
    details: { routedTo: params.agentId },
  }),
};

const respondToUserTool: AgentTool = {
  name: "respond_to_user",
  label: "Respond to User",
  description: "Send the final response to the user",
  parameters: Type.Object({
    response: Type.String({ description: "Final response" }),
  }),
  execute: async (id, params) => ({
    content: [{ type: "text", text: params.response }],
    details: { final: true },
  }),
};
```

### 10.2 Sequential 模式

```
1. 用户消息 → Pipeline Step 1 Agent
2. Step 1 处理 → 输出（可经 transform 转换）
3. 条件判断 → 进入 Step 2 或跳过
4. Step 2 处理 → ...
5. 最后一步输出 → 用户
```

### 10.3 Parallel 模式

```
1. 用户消息 → 广播到所有并行 Agent
2. 各 Agent 并行处理
3. 收集所有结果（或超时）
4. Aggregator 按策略合并
5. 合并结果 → 用户
```

### 10.4 Swarm 模式

```
1. 用户消息 → Orchestrator
2. Orchestrator 选择第一个 Agent
3. Agent A 处理 → 可通过 handoff 工具传递给 Agent B
4. Agent B 处理 → 可继续 handoff 或完成
5. 任一 Agent 可调用 respond_to_user 结束
6. 达到 maxTotalTurns 强制结束
```

handoff 工具：
```typescript
const handoffTool: AgentTool = {
  name: "handoff",
  label: "Hand Off",
  description: "Hand off the conversation to another agent",
  parameters: Type.Object({
    agentId: Type.String({ description: "Agent to hand off to" }),
    message: Type.String({ description: "Context for the next agent" }),
  }),
  execute: async (id, params) => ({
    content: [{ type: "text", text: `Handing off to ${params.agentId}` }],
    details: { handoffTo: params.agentId },
  }),
};
```

### 10.5 Debate 模式

```
1. 用户话题 → Agent A (Pro) 发表观点
2. Agent B (Con) 反驳
3. 重复 rounds 轮
4. Judge Agent 总结裁决
5. 裁决结果 → 用户
```

---

## 11. 历史消息与对话恢复

### 11.1 自动持久化

每次 `prompt()` 调用期间，所有消息自动写入 SQLite：

- 用户消息
- Agent 助手消息（含 thinking）
- 工具调用与结果
- 系统通知

### 11.2 对话恢复

```typescript
// 恢复历史对话
const conversation = await swarm.resumeConversation("conv-123");

// 历史消息自动加载到各 Agent 的 messages 中
// 用户可继续对话
const stream = conversation.prompt("继续分析");
```

### 11.3 上下文窗口管理

```typescript
// 在 SwarmConfig 中配置 transformContext
const swarm = new AgentSwarm({
  config: {
    // ...
    contextConfig: {
      maxMessages: 100,          // 最大消息数
      maxTokens: 100000,         // 最大 token 数
      strategy: "sliding",       // sliding | summarize
      summarizeAgent?: {         // strategy=summarize 时用于摘要的 Agent
        model: { provider: "anthropic", modelId: "claude-sonnet-4-20250514" },
      },
    },
  },
});
```

---

## 12. 项目结构（pnpm Monorepo）

```
agent-swarm/
├── packages/
│   ├── core/                           # @agent-swarm/core 后端 SDK
│   │   ├── src/
│   │   │   ├── index.ts                # SDK 入口，导出公共 API 和类型
│   │   │   ├── core/
│   │   │   │   ├── swarm.ts            # AgentSwarm 主类，管理 swarm 生命周期、init/close
│   │   │   │   ├── conversation.ts      # Conversation 类，prompt/abort/getHistory/onIntervention
│   │   │   │   ├── agent-factory.ts     # 基于 pi-agent-core Agent 创建实例，集成介入钩子
│   │   │   │   └── types.ts             # 核心类型：SwarmConfig, SwarmAgentConfig, ModelConfig, SwarmEvent 等
│   │   │   ├── modes/
│   │   │   │   ├── router.ts            # Router 协作模式
│   │   │   │   ├── sequential.ts        # Sequential 协作模式
│   │   │   │   ├── parallel.ts          # Parallel 协作模式
│   │   │   │   ├── swarm-mode.ts        # Swarm 协作模式
│   │   │   │   ├── debate.ts            # Debate 协作模式
│   │   │   │   └── types.ts             # 模式接口：CollaborationMode, ModeExecutor
│   │   │   ├── intervention/
│   │   │   │   ├── handler.ts           # 介入处理器，分发介入点到策略
│   │   │   │   ├── types.ts             # InterventionPoint, InterventionStrategy, InterventionDecision
│   │   │   │   └── built-in.ts          # 内置策略实现：auto/confirm/review/edit/reject
│   │   │   ├── storage/
│   │   │   │   ├── interface.ts         # IStorage 接口定义
│   │   │   │   ├── sqlite.ts            # better-sqlite3 + drizzle-orm 实现
│   │   │   │   ├── schema.ts            # Drizzle schema：swarms/agents/conversations/messages/events
│   │   │   │   └── message-mapper.ts    # AgentMessage ↔ StoredMessage 双向转换
│   │   │   ├── llm/
│   │   │   │   ├── config.ts            # LLMBackendConfig 管理，API Key 解析
│   │   │   │   └── provider.ts          # 桥接 pi-ai getModel/streamSimple，构建 StreamFn
│   │   │   └── tools/
│   │   │       ├── route-to-agent.ts    # route_to_agent 工具定义
│   │   │       ├── handoff.ts           # handoff 工具定义
│   │   │       └── respond-to-user.ts   # respond_to_user 工具定义
│   │   ├── drizzle/
│   │   │   └── migrations/              # SQLite 迁移文件
│   │   ├── test/
│   │   │   ├── unit/
│   │   │   └── e2e/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── server/                         # @agent-swarm/server API 服务层
│   │   ├── src/
│   │   │   ├── index.ts                # 服务入口，启动 Express + WS
│   │   │   ├── app.ts                  # Express 应用配置（cors/json/路由挂载）
│   │   │   ├── ws.ts                   # WebSocket 服务端，事件推送+介入回传
│   │   │   ├── routes/
│   │   │   │   ├── swarms.ts           # CRUD /api/swarms
│   │   │   │   ├── conversations.ts    # CRUD /api/conversations + 恢复对话
│   │   │   │   ├── messages.ts         # GET /api/conversations/:id/messages
│   │   │   │   └── config.ts           # GET/PUT /api/config (LLM 设置)
│   │   │   └── middleware/
│   │   │       └── error-handler.ts    # 统一错误处理中间件
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                            # @agent-swarm/web Vue 前端
│       ├── src/
│       │   ├── App.vue                 # 根组件，布局框架
│       │   ├── main.ts                 # Vue 应用入口
│       │   ├── router/
│       │   │   └── index.ts            # Vue Router 路由定义
│       │   ├── stores/
│       │   │   ├── swarm.ts            # Swarm 配置和列表状态
│       │   │   ├── conversation.ts     # 当前对话状态、消息列表、流式事件
│       │   │   ├── intervention.ts     # 介入请求队列和决策
│       │   │   └── settings.ts         # LLM 配置和全局设置
│       │   ├── composables/
│       │   │   ├── useWebSocket.ts     # WS 连接管理、自动重连、事件分发
│       │   │   ├── useChat.ts          # 对话交互逻辑：发送消息、接收流式响应
│       │   │   └── useIntervention.ts  # 介入操作：展示介入面板、提交决策
│       │   ├── api/
│       │   │   ├── client.ts           # HTTP 请求封装（fetch + 拦截器）
│       │   │   ├── swarms.ts           # Swarm CRUD API
│       │   │   ├── conversations.ts    # 对话 CRUD API
│       │   │   └── config.ts           # 配置 API
│       │   ├── views/
│       │   │   ├── ChatView.vue        # 对话页：消息列表+输入框+Agent状态
│       │   │   ├── SwarmsView.vue      # Swarm 管理页：列表+创建/编辑
│       │   │   ├── HistoryView.vue     # 历史对话浏览页
│       │   │   └── SettingsView.vue    # 设置页：LLM 配置、API Key
│       │   ├── components/
│       │   │   ├── layout/
│       │   │   │   ├── AppHeader.vue   # 顶部导航栏
│       │   │   │   └── AppSidebar.vue  # 侧边栏：对话列表+导航
│       │   │   ├── chat/
│       │   │   │   ├── MessageList.vue     # 消息列表（虚拟滚动）
│       │   │   │   ├── MessageItem.vue     # 单条消息气泡（区分 Agent/用户/工具）
│       │   │   │   ├── ChatInput.vue       # 消息输入框+发送按钮
│       │   │   │   ├── AgentStatus.vue     # Agent 状态指示器（思考中/执行工具/空闲）
│       │   │   │   └── ToolCallCard.vue    # 工具调用展示卡片（参数+结果）
│       │   │   ├── intervention/
│       │   │   │   ├── InterventionPanel.vue  # 介入操作面板（确认/拒绝/编辑）
│       │   │   │   └── InterventionBanner.vue # 介入提示横幅
│       │   │   ├── swarm/
│       │   │   │   ├── SwarmCard.vue        # Swarm 配置卡片
│       │   │   │   ├── SwarmForm.vue        # Swarm 创建/编辑表单
│       │   │   │   ├── AgentConfigForm.vue  # Agent 配置表单
│       │   │   │   └── ModeSelector.vue     # 协作模式选择器
│       │   │   └── common/
│       │   │       ├── MarkdownRenderer.vue # Markdown 内容渲染
│       │   │       └── StreamingText.vue    # 流式文本打字效果
│       │   ├── styles/
│       │   │   └── index.css            # Tailwind 入口 + TDesign 主题变量
│       │   └── types/
│       │       └── index.ts             # 前端本地类型（API 响应、UI 状态）
│       ├── index.html
│       ├── vite.config.ts
│       ├── tailwind.config.ts
│       ├── tsconfig.json
│       └── package.json
│
├── pnpm-workspace.yaml                 # pnpm workspace 配置
├── package.json                        # 根 package.json（scripts: dev/build/test）
├── tsconfig.base.json                  # 共享 TS 配置
├── agent-swarm.config.ts               # 示例配置文件
└── README.md                           # 项目文档
```

---

## 13. 依赖

```json
{
  "dependencies": {
    "@mariozechner/pi-agent-core": "^0.9.0",
    "@mariozechner/pi-ai": "^0.9.0",
    "@sinclair/typebox": "^0.34.0",
    "better-sqlite3": "^11.0.0",
    "drizzle-orm": "^0.38.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "drizzle-kit": "^0.30.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

### @agent-swarm/server 依赖

```json
{
  "dependencies": {
    "@agent-swarm/core": "workspace:*",
    "express": "^4.21.0",
    "ws": "^8.18.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/ws": "^8.5.0",
    "@types/cors": "^2.8.0",
    "typescript": "^5.7.0"
  }
}
```

### @agent-swarm/web 依赖

```json
{
  "dependencies": {
    "vue": "^3.5.0",
    "vue-router": "^4.4.0",
    "pinia": "^2.2.0",
    "tdesign-vue-next": "^1.10.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.2.0",
    "vite": "^6.0.0",
    "typescript": "^5.7.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "vue-tsc": "^2.1.0"
  }
}
```

---

## 14. 使用示例

### 14.1 基础用法

```typescript
import { AgentSwarm } from "agent-swarm";

const swarm = new AgentSwarm({
  config: {
    llm: {
      defaultProvider: "anthropic",
      defaultModel: "claude-sonnet-4-20250514",
      apiKeys: {
        anthropic: process.env.ANTHROPIC_API_KEY!,
      },
    },
    storage: { type: "sqlite", path: "./data/swarm.db" },
    swarms: [{
      id: "helpful-team",
      name: "Helpful Team",
      mode: "router",
      orchestrator: {
        id: "router",
        name: "Router",
        description: "Routes to the right specialist",
        systemPrompt: "You route user questions to the right specialist.",
        model: { provider: "anthropic", modelId: "claude-sonnet-4-20250514" },
      },
      agents: [
        {
          id: "coder",
          name: "Coder",
          description: "Helps with programming",
          systemPrompt: "You are a coding expert.",
          model: { provider: "openai", modelId: "gpt-4o" },
        },
        {
          id: "analyst",
          name: "Analyst",
          description: "Helps with data analysis",
          systemPrompt: "You are a data analyst.",
          model: { provider: "anthropic", modelId: "claude-sonnet-4-20250514" },
        },
      ],
    }],
  },
});

await swarm.init();
const conv = await swarm.createConversation("helpful-team");
const stream = conv.prompt("写一个快速排序算法");

for await (const event of stream) {
  if (event.type === "message_update") process.stdout.write(event.delta ?? "");
  if (event.type === "swarm_end") console.log("\nDone:", event.finalMessage);
}

await swarm.close();
```

### 14.2 带用户介入

```typescript
const conv = await swarm.createConversation("helpful-team");

conv.onIntervention(async (point, ctx) => {
  if (point === "before_tool_call") {
    console.log(`Tool: ${ctx.toolName}, Args:`, ctx.arguments);
    const answer = await askUser("Allow this tool call? [y/n]");
    return { action: answer === "y" ? "approve" : "reject" };
  }
  return { action: "approve" };
});
```

### 14.3 恢复历史对话

```typescript
// 列出历史对话
const conversations = await swarm.listConversations("helpful-team");

// 恢复某个对话
const conv = await swarm.resumeConversation(conversations[0].id);
const stream = conv.prompt("继续上次的讨论");
```

---

## 15. 设计原则

1. **pi-agent-core 为核心**：每个 Agent 都是 `Agent` 实例，复用其工具执行、状态管理、事件流
2. **协作层薄封装**：Orchestrator 不重新实现 Agent 循环，而是通过 steering/followUp 和工具回调编排
3. **存储不可知**：通过 `IStorage` 接口抽象，默认 SQLite，可扩展
4. **介入可组合**：介入策略可全局、按 Swarm、按 Agent 分级配置
5. **事件驱动**：所有协作过程通过事件流暴露，方便 UI 集成和调试
6. **配置驱动**：尽量通过配置文件而非代码定义 Swarm 行为

---

## 16. 前端架构

### 16.1 通信架构

- **HTTP REST**：配置管理、对话 CRUD、历史查询等请求-响应式操作
- **WebSocket**：对话中的流式事件推送（message_update / tool_execution / intervention_required 等），用户介入决策的实时回传

WebSocket 消息格式统一为 `{type, payload, conversationId}`，事件类型与后端 SwarmEvent 一一对应。

### 16.2 WebSocket 协议

```
# 服务端 → 前端（事件推送）
{ type: SwarmEventType, payload: any, conversationId: string }

# 前端 → 服务端（介入回传）
{ type: "intervention_decision", requestId: string, decision: InterventionDecision }

# 前端 → 服务端（发送消息）
{ type: "send_message", conversationId: string, content: string }
```

### 16.3 前端状态管理（Pinia）

| Store | 职责 |
|-------|------|
| `swarm` | Swarm 配置列表、当前选中的 Swarm |
| `conversation` | 当前对话、消息列表、流式消息状态 |
| `intervention` | 介入请求队列、当前等待决策的介入 |
| `settings` | LLM 配置、API Key、全局介入策略 |

### 16.4 前端 Composables

| Composable | 职责 |
|-----------|------|
| `useWebSocket` | WS 连接管理、自动重连（指数退避）、事件分发到 Store |
| `useChat` | 对话交互逻辑：发送消息、接收流式响应、虚拟滚动 |
| `useIntervention` | 介入操作：展示介入面板、提交决策（approve/reject/edit） |

### 16.5 API 路由

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/swarms` | 列出所有 Swarm |
| POST | `/api/swarms` | 创建 Swarm |
| GET | `/api/swarms/:id` | 获取 Swarm 详情 |
| PUT | `/api/swarms/:id` | 更新 Swarm 配置 |
| DELETE | `/api/swarms/:id` | 删除 Swarm |
| GET | `/api/conversations` | 列出对话（支持 swarmId 过滤） |
| POST | `/api/conversations` | 创建新对话 |
| GET | `/api/conversations/:id` | 获取对话详情 |
| POST | `/api/conversations/:id/resume` | 恢复对话 |
| DELETE | `/api/conversations/:id` | 删除对话 |
| GET | `/api/conversations/:id/messages` | 获取消息列表 |
| GET | `/api/config` | 获取 LLM 配置 |
| PUT | `/api/config` | 更新 LLM 配置 |

---

## 17. 页面设计

### 17.0 设计风格

采用 Glassmorphism（毛玻璃拟态）风格，暗色主题为主，营造科技感与未来感。背景使用深蓝黑渐变配合动态光晕，卡片和面板使用半透明毛玻璃效果。整体界面追求沉浸式对话体验，突出多 Agent 协作的可视化流程。

### 17.1 ChatView（对话页）— 核心页面

- **顶部导航栏**：当前 Swarm 名称、协作模式标签、Agent 在线状态指示
- **侧边栏**：对话历史列表、新建对话按钮、Swarm 切换
- **消息区域**：消息列表（区分用户/各 Agent 消息，Agent 头像+名称标注），工具调用卡片可展开查看参数和结果
- **Agent 状态面板**：右侧折叠面板，显示各 Agent 当前状态（思考中/执行工具/空闲/交接中），协作流程可视化
- **介入操作区**：需要用户介入时，底部弹出介入面板，显示介入类型、上下文信息，提供确认/拒绝/编辑操作
- **输入区域**：底部输入框+发送按钮，显示当前活跃 Agent 提示

### 17.2 SwarmsView（Swarm 管理页）

- **顶部导航栏**：页面标题+创建 Swarm 按钮
- **Swarm 列表**：卡片网格布局，每张卡片显示 Swarm 名称、模式图标、Agent 数量、最近活动
- **创建/编辑表单**：右侧抽屉，包含模式选择器、Agent 配置表单（名称/描述/模型/system prompt）、介入策略配置

### 17.3 HistoryView（历史对话浏览页）

- **顶部导航栏**：页面标题+搜索框
- **对话列表**：按时间倒序展示历史对话，显示标题、参与的 Swarm、消息数、最后更新时间
- **对话详情**：点击后展开消息列表（只读），可恢复继续对话

### 17.4 SettingsView（设置页）

- **LLM 提供商配置**：卡片式展示各提供商，填写 API Key / Base URL
- **默认模型选择**：下拉选择默认提供商和模型
- **全局介入策略**：各介入点的默认策略配置

---

## 18. 性能与可靠性

- WebSocket 连接断线自动重连（指数退避），前端维护消息队列防丢失
- 流式消息使用虚拟滚动（大量消息时避免 DOM 瓶颈）
- SQLite WAL 模式，写操作批量提交减少 fsync
- 前端使用 `computed` + `shallowRef` 减少不必要响应式追踪

---

## 19. 实现备注

- **pi-agent-core 事件桥接**：server 的 ws.ts 订阅 AgentSwarm 的 SwarmEvent，将每个事件通过 WS 推送到前端；intervention_required 事件需暂停 Agent 循环等待 WS 回传决策
- **前端流式渲染**：message_update 事件的 delta 增量追加到 Pinia store 的 currentStreamingMessage，MessageList 使用 `nextTick` 自动滚动到底部
- **SQLite 初始化**：server 启动时调用 drizzle-kit push 创建表，WAL 模式开启
- **环境变量**：API Key 等敏感配置通过 .env 文件注入 server，不暴露到前端
