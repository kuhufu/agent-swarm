# Agent 预设管理与复用

本文说明 Agent 预设（`AgentPreset`）在 Core、Server、Web 三层的实现与使用方式。

## 1. 目标

- 提供可复用的 Agent 模板库，避免每次创建 Swarm 都从零填写 Agent。
- 支持系统级 Agent 模板与用户级自定义预设分离。
- 内置常用系统模板并支持在设置页维护系统模板。
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

存储表：

- `agent_templates`：系统级模板，跨用户共享。
- `preset_agents`：用户级预设，按 `userId` 隔离。

## 3. Core 层行为

- `AgentSwarm.init()` 在系统模板表为空时自动写入内置模板列表。
- 提供用户预设 `list/get/add/update/delete` 管理方法。
- 提供系统模板 `list/add/update/delete` 管理方法。
- 用户预设和系统模板的 `id` 在创建后固定不可改。

## 4. Server API

路由前缀：`/api/agents`

- `GET /`：列出当前用户预设与系统模板，响应为 `{ presets, templates }`
- `POST /import-template/:templateId`：将系统模板导入为当前用户预设
- `GET /:id`：获取单个预设
- `POST /`：创建自定义预设
- `PUT /:id`：更新预设（`id` 不可变）
- `DELETE /:id`：删除预设

路由前缀：`/api/templates`

- `GET /`：列出系统模板
- `POST /`：创建系统模板
- `PUT /:id`：更新系统模板（`id` 不可变）
- `DELETE /:id`：删除系统模板

## 5. Web 端

### 5.1 预设管理页面

- 路由：`/agents`
- 页面：`AgentsView`
- 数据来源：`agents` Pinia store + `api/agents.ts`
- 功能：查看系统模板/自定义预设、从系统模板创建自定义预设、编辑/删除自定义预设。

### 5.2 系统模板管理

- 路由：`/settings`
- 页面：`SettingsView` 的“系统 Agent 模版”标签页
- 组件：`AgentTemplatesTab`
- 数据来源：`agents` Pinia store + `/api/templates`
- 功能：创建、编辑、删除跨用户共享的系统 Agent 模板。

### 5.3 创建 Swarm 时复用

`CreateSwarmDialog` 与 `SwarmsView` 的“添加/编辑 Agent”表单均支持选择预设模板：

- 选择后自动回填 `name/description/systemPrompt/model`
- 自动生成不与当前 Swarm 冲突的 Agent `id`
- 仍可在回填后手动编辑
- 已添加到 Swarm 的 Agent 列表支持拖动排序（创建弹窗与管理页编辑面板均支持）

## 6. 约束说明

- 预设是模板，不会自动同步影响已创建 Swarm 内的 Agent。
- 删除用户预设或系统模板仅影响后续创建，不影响历史 Swarm 配置。
- 删除系统模板不会删除已经导入到用户空间的预设。
