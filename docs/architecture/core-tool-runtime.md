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
- 组合能力：`createWorkspaceTool(workspace)` 返回 id 为 `workspace` 的 `RuntimeTool`，展开后包含 `workspace_write_file`、`workspace_read_file`、`workspace_list_files`、`workspace_run_container`、`workspace_list_containers`、`workspace_remove_containers`。

WebSocket 层只传递用户选择的 `enabledTools` 和前端工具执行器。它不创建具体工具，也不判断工具是否启用。

## Swarm handoff 协议

`handoff` 是 `swarm` 模式的内置调度协议，不是普通工具副作用。Agent 调用 `handoff` 只是在提出交接请求；`SwarmMode` 会完成目标校验、`on_handoff` 介入审批、循环保护和事件记录，审批通过后才中断当前 Agent 并把控制权交给目标 Agent。

`handoff` 参数：

- `agentId`：目标 Agent ID，必须来自当前 Swarm 可用 Agent 列表。
- `message`：兼容旧用法的交接消息，可为空。
- `reason`：交接原因。
- `task`：目标 Agent 应完成的具体任务。
- `context`：目标 Agent 需要的上下文。
- `expectedOutput`：目标 Agent 应返回的结果形态。
- `returnToAgentId`：可选的回交 Agent ID，用于表达接力计划。

执行器只识别工具名为 `handoff` 且执行成功的工具结果。其他工具返回 `details.handoffTo` 不会触发切换。`SwarmMode` 会把结构化字段组装成目标 Agent 的输入，并在 `handoff` 事件里透传这些字段，便于前端展示协作链路。连续 `A -> B -> A` 且任务上下文相同的短循环会被拒绝；全局轮次仍受 `maxTotalTurns` 控制。

### 共享上下文摘要

`SwarmMode` 支持 `swarmContext` 配置：

```ts
swarmContext?: {
  mode: "handoff_only" | "summary";
  maxAgentSummaries?: number;
  maxSummaryChars?: number;
  maxTotalChars?: number;
}
```

默认模式为 `summary`。每个 Agent 执行结束后，执行器从该 Agent 最后一条 assistant 消息提取轻量摘要，保存在本次 Swarm 执行的共享工作记忆中。下一次 handoff 时，目标 Agent 的输入会包含：

- 原始用户请求。
- 最近若干个 Agent 的摘要。
- 当前 handoff 的 `task/context/expectedOutput/reason/returnToAgentId/message`。

摘要不会写回各 Agent 自己的长期 `state.messages`，只作为当前 handoff prompt 的附加上下文使用。`handoff_only` 会关闭摘要注入，仅传递当前 handoff payload。

## Workspace 执行进程

`workspace_run_container` 不允许在宿主机 shell 直接执行模型生成的命令。命令必须通过 `docker run` 在隔离容器内执行：workspace 目录 bind mount 到 `/workspace`，默认禁用网络，限制 CPU、内存和 pids，rootfs 只读，丢弃 Linux capabilities，并启用 `no-new-privileges`。默认镜像为 `node:22-alpine`，可通过 `AGENT_SWARM_WORKSPACE_IMAGE` 覆盖。

启动 Web 服务时必须显式传 `ports` 和 `background: true`。`containerPort` 是应用在容器内实际监听的端口，必须与代码或启动命令一致；`hostPort` 是宿主机 `127.0.0.1` 上用于访问的端口。只想改变浏览器访问端口时只改 `hostPort`，不要改应用代码中的监听端口。例如应用监听 `3000`，希望通过 `http://127.0.0.1:5174` 访问，则传 `{ "containerPort": 3000, "hostPort": 5174 }`，会生成 `127.0.0.1:5174:3000`。设置 `ports` 后容器不再使用 `--network none`，而是使用 Docker 默认 bridge 网络以支持端口映射。

不要用 `workspace_run_container` 再启动一个新容器执行 `curl`、`http.get('http://localhost:...')` 等命令去验证后台服务。每次工具调用都是新的 Docker 容器，容器内 `localhost` 指向新容器自身，不是已后台运行的服务容器，也不是宿主机。启动服务后应把 `http://127.0.0.1:<hostPort>` 返回给用户访问；如果需要自动健康检查，应新增宿主侧受控检查工具，而不是复用 `workspace_run_container`。

`cwd` 默认就是 `/workspace`，不要传 `"workspace"` 表示根目录；只有文件确实位于工作区子目录时才传相对路径。`background: true` 默认会等待 `startupWaitMs=2000` 后才返回后台运行，若容器在这段时间内退出，应返回实际退出码和 stderr。

每次 `workspace_run_container` 都会生成容器名 `agent-swarm-<conversationId>-<toolCallId>`，并写入 Docker labels：`agent-swarm=true`、`agent-swarm.conversation-id=<conversationId>`、`agent-swarm.tool-call-id=<toolCallId>`。后台运行返回的 `details.containerName` 是后续排查和清理的容器标识。

Agent 如需主动管理当前会话的容器，只能使用受控 workspace 工具：`workspace_list_containers` 和 `workspace_remove_containers`。这两个工具只按当前 `conversationId` 的 Docker label 查询和清理资源，不维护内存进程表，也不接受任意容器名，避免越权清理宿主机上的其他容器。

`workspace_run_container` 会监听工具调用的 `AbortSignal`。当用户点击停止、WebSocket 断开或 `Conversation.abort()` 被调用时，Conversation 会按当前 `conversationId` 的 Docker label 清理该会话关联容器；服务进程重启后仍可通过 Docker label 找回和清理残留容器。

删除会话时，`AgentSwarm.deleteConversation()` 会先清理对应 `conversationId` 的 workspace 目录，并按 `agent-swarm.conversation-id` label best-effort 清理仍在运行或服务重启后残留的容器，再删除会话消息、事件和会话记录。

新增前端执行工具时，更新 `createClientToolDefinitions()` 和前端 `packages/web/src/tools/client-tools.ts` 的实际执行逻辑，二者的工具名和参数 schema 必须保持一致。
