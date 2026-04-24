# Agent 预设管理与复用

本文说明 Agent 预设（`AgentPreset`）在 Core、Server、Web 三层的实现与使用方式。

## 1. 目标

- 提供可复用的 Agent 模板库，避免每次创建 Swarm 都从零填写 Agent。
- 内置常用预设并支持用户新增自定义预设。
- 在创建 Swarm 时可直接从预设模板回填 Agent 配置。

## 2. 数据模型

`AgentPreset` 字段：

- `id`：唯一标识
- `name`：名称
- `description`：描述
- `systemPrompt`：系统提示词
- `model.provider` / `model.modelId`：模型配置
- `category`：分类
- `tags`：标签数组
- `builtIn`：是否内置预设

存储表：`preset_agents`（SQLite）。

## 3. Core 层行为

- `AgentSwarm.init()` 在预设表为空时自动写入内置预设列表。
- 提供 `list/get/add/update/delete` 预设管理方法。
- 所有预设均可更新；`id` 在创建后固定不可改。
- 内置预设（`builtIn = true`）仍不允许删除。

## 4. Server API

路由前缀：`/api/agents`

- `GET /`：列出全部预设
- `GET /:id`：获取单个预设
- `POST /`：创建自定义预设
- `PUT /:id`：更新预设（`id` 不可变）
- `DELETE /:id`：删除预设（内置预设返回 `403`）

## 5. Web 端

### 5.1 预设管理页面

- 路由：`/agents`
- 页面：`AgentsView`
- 数据来源：`agents` Pinia store + `api/agents.ts`
- 功能：查看内置/自定义预设、创建自定义预设、编辑/删除自定义预设。

### 5.2 创建 Swarm 时复用

`CreateSwarmDialog` 与 `SwarmsView` 的“添加/编辑 Agent”表单均支持选择预设模板：

- 选择后自动回填 `name/description/systemPrompt/model`
- 自动生成不与当前 Swarm 冲突的 Agent `id`
- 仍可在回填后手动编辑

## 6. 约束说明

- 预设是模板，不会自动同步影响已创建 Swarm 内的 Agent。
- 删除预设仅影响后续创建，不影响历史 Swarm 配置。
