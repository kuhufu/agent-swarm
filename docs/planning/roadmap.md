# Agent Swarm 拓展路线图

## 项目现状

Agent Swarm 是一个架构清晰的多 Agent 协作框架，采用 `core → server → web` 三层分离。已具备 5 种协作模式（Router、Sequential、Parallel、Swarm、Debate）、15 种子事件类型、7 个介入点和完整的 REST + WebSocket 实时通信。核心架构设计良好，但以下三个方向存在明显差距：

1. **部署运维就绪度不足**：缺测试基础设施、仅 SQLite 存储、无可观测性
2. **集成点缺失**：无搜索工具、无 RAG、无 MCP 协议支持
3. **编排复杂度有限**：与 LangGraph 等基于 DAG 的框架相比，工作流模式过于简单

---

## 阶段一：基础打磨（1-2 个月）

### P0 - API 请求验证

所有 REST 端点添加请求体验证，防止错误数据污染和崩溃。

- 引入 zod 或 express-validator（`packages/server/src/routes/`）
- 覆盖创建/更新 Swarm、Agent 预设、Conversation 等所有 POST/PUT 操作
- 统一错误响应格式

### P0 - 测试基础设施

当前 `core` 有少量单元测试，`server` 和 `web` 几乎无测试覆盖。

- `core`：补充协作模式测试、介入策略测试、存储接口测试
- `server`：添加 API 集成测试、WebSocket 协议测试
- `web`：使用 Vitest + Vue Test Utils 添加 `ChatInput`、`MessageList`、`SwarmEditor` 等组件测试
- 创建 mock LLM 提供商用于确定性测试
- 添加快照测试用于 SwarmEvent 序列化验证

### P0 - 结构化日志

替换当前遍布代码的 `console.log/error`。

- 引入 pino 或 winston（`packages/core/src/` 和 `packages/server/src/`）
- 支持日志级别（debug/info/warn/error）
- 为 LLM 调用、工具执行、协作模式切换等关键路径添加结构化日志字段

### P1 - 令牌使用量跟踪与成本仪表板

当前 `message-mapper.ts` 已存储 usage 数据到消息 metadata，但前端未展示。

- 后端：新增 `/api/usage` 端点，按会话/日期/模型维度聚合 token 消耗
- 前端：在 `SettingsView.vue` 或新增 `UsageView.vue` 展示成本仪表板
- 聊天界面实时显示当前对话消耗的 token 数

### P1 - Web 搜索工具

Agent 最需要的外部能力。

- 在 `packages/core/src/tools/` 添加 `search_web` 工具定义
- 集成 Tavily、SerpAPI 或 Brave Search API
- 前端工具开关中展示搜索工具状态

### P1 - Agent 协作可视化 DAG 图

当前 `AgentStatus.vue` 仅显示卡片列表，缺少 Agent 间流转关系的可视化。

- 新增 `WorkflowGraph.vue` 组件
- 基于 `handoff`、`agent_start/end` 事件实时构建节点和边
- 展示 Agent 状态（空闲/思考/执行工具/交接）的颜色编码

### P1 - MCP (Model Context Protocol) 支持

MCP 正成为 LLM 工具接入的标准协议。

- 新增 `packages/core/src/tools/mcp/` 模块
- 实现 MCP 客户端：连接 MCP 服务器、发现可用工具、转发工具调用
- 支持通过 UI 配置 MCP 服务器端点

### P2 - Docker 部署

- 为 `packages/server/` 添加 Dockerfile
- 为 `packages/web/` 添加 Dockerfile（或使用 Nginx 静态文件服务）
- 根目录添加 `docker-compose.yml` 用于一键启动 server + web

### P2 - 暗色/亮色主题切换

当前仅暗色主题，Tailwind CSS v4 已内建主题切换支持。

- 在 `App.vue` 或 layout 层添加主题状态管理
- 为玻璃拟态卡片、按钮、输入框等适配亮色样式
- 在设置页添加主题切换开关

### P2 - 消息反馈按钮

- 每条助手消息下方添加 👍/👎 按钮
- 后端新增 `POST /api/conversations/:id/messages/:msgId/feedback` 端点
- `messages` 表添加 `feedback` 字段

---

## 阶段二：差异化功能（3-6 个月）

### P0 - 水平扩展与 PostgreSQL 适配器

SQLite 适合单机开发，不适合多进程生产部署。

- 新增 `PostgresStorage` 实现 `IStorage` 接口（`packages/core/src/storage/`）
- 引入 Redis pub/sub 替代当前内存广播（`packages/server/src/ws.ts` 第 391-406 行的 `broadcastPacketToConversation`）
- 保持 SQLite 作为开发/单机部署的默认选项

### P0 - 基于图的工作流模式 (DAG 执行引擎)

当前协作模式均为简单拓扑，缺少条件分支和多路径编排。

- 新增 `packages/core/src/modes/graph.ts`
- 支持节点（Agent 执行）和边（条件路由、并行扇出/扇入）
- 状态机驱动，支持检查点/恢复
- 在 `SwarmsView.vue` 中添加可视化编辑器（拖拽节点、连线）

### P1 - RAG 知识检索

企业用户的核心需求。

- 新增 `IVectorStore` 接口（`packages/core/src/storage/vector-store.ts`）
- 集成 Pinecone / Weaviate / Qdrant / pgvector
- 添加 `retrieve_knowledge` 工具，Agent 可主动检索知识库
- 前端添加文档管理页面：上传、索引、查看

### P1 - 用户认证与多租户

当前无任何用户区分，所有数据共享。

- 引入 JWT 认证 + bcrypt 密码哈希
- 新增 `users` 表，现有表添加 `userId` 外键
- `packages/server/src/middleware/auth.ts` 实现认证中间件
- 前端添加登录/注册页面

### P1 - LLM 调用日志专用表

独立于 SwarmEvent 的 API 调用记录，便于成本归因和性能分析。

- 新增 `llm_calls` 表：`providerId`, `modelId`, `promptTokens`, `completionTokens`, `latencyMs`, `status`, `error`
- 从 `message-mapper.ts` 中抽取日志记录逻辑
- 按 provider/modelId/date 维度提供聚合查询 API

### P1 - OpenTelemetry 分布式追踪

为 Agent 调用、工具执行、模式转换建立追踪链。

- 集成 `@opentelemetry/api` + `@opentelemetry/sdk-node`
- 新增 `traces` 表或直接导出到 Jaeger/Tempo
- 每个 SwarmEvent 携带 `traceId` / `spanId` / `parentSpanId`

### P2 - Agent 模板市场

社区驱动的 Agent 预设共享。

- 前端新增 `MarketView.vue`，展示公开共享的预设列表
- 后端新增 `GET /api/marketplace` + `POST /api/marketplace/import`
- Agent 预设支持 `public` 和 `author` 字段

### P2 - Slack/Discord Bot 集成

把 Swarm 部署到消息平台。

- 新增 `packages/server/src/bots/slack.ts` 和 `discord.ts`
- 复用现有 `Conversation` 和协作模式
- 通过环境变量配置 bot token 和 webhook

### P2 - LLM 故障转移

主模型不可用时的自动切换。

- 在 `packages/core/src/llm/` 添加 `FallbackProvider`
- Swarm 和 Agent 配置支持 `fallbackModelId` 字段
- 失败时自动重试指定次数后切换到备用模型

---

## 阶段三：企业化与扩展（6-12 个月）

### P1 - RBAC 角色访问控制

- `packages/server/src/middleware/rbac.ts`
- admin（全部权限）、operator（管理 Swarm/Agent）、viewer（只读对话）角色
- Swarm 粒度的权限控制

### P1 - SSO 单点登录

- 集成 OIDC / SAML
- 支持 Azure AD、Okta、Keycloak 等主流身份提供商

### P1 - 审计日志

记录所有管理操作和配置变更的完整追踪。

- 新增 `audit_logs` 表：`userId`, `action`, `resource`, `details`, `timestamp`
- 所有 POST/PUT/DELETE 操作自动记录
- 非可删除（append-only）

### P1 - 内容审核过滤器

- 可插拔的 `IContentFilter` 接口
- 预置基于 Perspective API 或自定义分类器的实现
- 在 Agent 输入前和输出后应用过滤

### P2 - Prometheus 指标导出

- `GET /metrics` 端点
- 指标：conversation_count、agent_call_count、error_rate、latency_p50/p95/p99、token_usage
- 配套 Grafana 仪表板模板

### P2 - A2A (Agent-to-Agent) 协议支持

跨系统 Agent 互操作。

- 实现 Google A2A 协议或类似开放标准
- 外部 Agent 可以发现并调用本 Swarm 中的 Agent
- 本 Swarm 的 Agent 也可以调用外部 Agent

### P2 - OpenAPI 规范生成

- 集成 `swagger-jsdoc` 或 `tsoa`
- 为所有 REST 端点生成 OpenAPI 3.1 规范
- 前端可自动生成类型安全的 API 调用代码

### P3 - Helm Chart / Kubernetes 部署

- 编写 Helm Chart 用于 server 和 web 的 K8s 部署
- 支持 Ingress、ConfigMap、Secret 管理
- 提供水平自动扩缩容 (HPA) 配置

---

## 潜在探索方向

以下方向值得关注但尚未纳入路线图：

- **代码执行沙箱**：服务端 Python/Node 沙箱，当前仅有浏览器端 `javascript_execute`
- **多模态支持**：图片/音频输入输出，需等 pi-ai 上游支持
- **Agent 协商协议**：多 Agent 投票、共识算法、角色协商
- **长期记忆系统**：对话摘要、实体追踪、持久化向量记忆
- **输出质量评估**：基准测试、成对比较、自动化评分
- **多 Agent 强化学习**：基于反馈的 Agent 策略优化
- **API 工具自动生成**：从 OpenAPI 规范自动创建 Agent 工具
- **Email 集成**：通过 email 发起任务、接收报告
- **CI/CD 集成**：GitHub Actions 中调用 Swarm 进行代码审查
- **浏览器通知**：长时间运行任务完成或需介入时推送通知
- **语音输入**：Web Speech API 语音转文字
- **协作会话**：多人同时观察和干预同一个 Swarm 对话
