# Core Tool Runtime

`packages/core/src/tools/runtime.ts` 是 Agent 工具注入的统一入口。`Conversation` 负责根据当前会话的 `enabledTools` 决定启用哪些工具；`AgentSwarm.createToolRuntimeAvailability()` 只提供本会话可用的工具资源，例如 WebSearch 配置、MCP 工具、知识库工具和 workspace 组合工具。

## 入口

- `createToolRuntimeOptions(input)`：规范化 `enabledTools`，补齐默认前端工具执行器。
- `createRuntimeTool(tool)` / `createRuntimeTool(id, tools)`：把一个或多个 `AgentTool` 封装成统一的 `RuntimeTool`。
- `AgentSwarm.createToolRuntimeAvailability(context)`：按 `conversationId/userId` 创建可用工具资源，不读取 `enabledTools`。
- `withRuntimeTools(config, swarmConfig, runtimeOptions)`：基于 Swarm 模式和运行时开关，为单个 Agent 合并工具。
- `createRuntimeTools(config, swarmConfig, runtimeOptions)`：只生成运行时工具列表，按工具名去重。
- `createClientToolDefinitions()`：集中定义前端桥接工具声明，目前包含 `current_time` 和 `javascript_execute`。

## 工具来源

运行时会按以下顺序合并工具，已有同名工具优先保留：

1. Agent 配置中的 `config.tools`。
2. 模式内置工具：`router` 模式 orchestrator 自动获得 `route_to_agent`；`swarm` 模式 Agent 自动获得 `handoff`。
3. 前端桥接工具：`enabledTools` 包含 `current_time` 或 `javascript_execute` 时注入。
4. 服务端内置工具：`enabledTools` 包含 `web_search` 时注入 `createWebSearchTool()`。
5. MCP 工具：`enabledTools` 包含 `mcp` 时注入所有已发现 MCP 工具。
6. 运行时工具：`runtimeTools` 中工具 id 出现在 `enabledTools` 时注入其展开后的所有 `AgentTool`。

## 新增工具约定

运行时只区分一种工具抽象：`RuntimeTool`。单个工具和多个底层 `AgentTool` 组成的能力都使用这个抽象，只是 `agentTools` 长度不同。

- 单个能力：`createRuntimeTool(createRetrieveKnowledgeTool(...))`，默认使用底层工具名 `retrieve_knowledge` 作为启用 id。
- 组合能力：`createWorkspaceTool(workspace)` 返回 id 为 `workspace` 的 `RuntimeTool`，展开后包含 `write_file`、`read_file`、`list_files`、`execute_file`。

WebSocket 层只传递用户选择的 `enabledTools` 和前端工具执行器。它不创建具体工具，也不判断工具是否启用。

新增前端执行工具时，更新 `createClientToolDefinitions()` 和前端 `packages/web/src/tools/client-tools.ts` 的实际执行逻辑，二者的工具名和参数 schema 必须保持一致。
