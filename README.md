# Agent Swarm

基于 `@mariozechner/pi-agent-core` 的多 Agent 协作框架，包含后端 SDK/服务 + Vue 前端 UI。

## 功能特性

- **多 Agent 协作**：Router / Sequential / Parallel / Swarm / Debate 五种协作模式
- **用户介入机制**：7 个介入点、5 种策略，支持分级配置
- **可配置 LLM 后端**：支持 Anthropic / OpenAI / Google / Bedrock / OpenRouter
- **历史消息持久化**：SQLite 存储，支持对话恢复
- **Web UI**：Vue 3 + Vite 构建的交互界面

## 项目结构

```
agent-swarm/
├── packages/
│   ├── core/       # @agent-swarm/core — 后端 SDK
│   ├── server/     # @agent-swarm/server — Express + WebSocket API
│   └── web/        # @agent-swarm/web — Vue 3 前端
├── agent-swarm.config.ts  # 示例配置
└── spec.md                # 规格书
```

## 快速开始

### 前置条件

- Node.js >= 18
- pnpm >= 9

### 安装

```bash
pnpm install
```

### 配置

1. 复制 `.env.example` 为 `.env` 并填入 API Key：

```bash
cp .env.example .env
```

2. 编辑 `agent-swarm.config.ts` 配置 Swarm

### 开发

```bash
# 启动所有服务（server + web）
pnpm dev

# 单独启动
pnpm dev:core    # 仅 SDK
pnpm dev:server  # 仅 API 服务
pnpm dev:web     # 仅前端
```

### 构建

```bash
pnpm build
```

## 技术栈

| 层 | 技术 |
|---|------|
| 后端 SDK | TypeScript + pi-agent-core + pi-ai |
| API 服务 | Express + WebSocket (ws) |
| 数据存储 | better-sqlite3 + drizzle-orm |
| 前端 | Vue 3 + Vite + Pinia + TDesign |
| 样式 | Tailwind CSS v4 |
| Monorepo | pnpm workspace |

## 协作模式

| 模式 | 说明 |
|------|------|
| Router | 路由到专业 Agent |
| Sequential | 顺序 Pipeline 处理 |
| Parallel | 并行处理 + 聚合 |
| Swarm | Handoff 自由协作 |
| Debate | 多轮辩论 + Judge |

## License

MIT
