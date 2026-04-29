# 认证与多租户隔离

本文记录服务端当前认证与租户隔离行为。

## 认证入口

- 公开接口：
  - `POST /api/auth/register`
  - `POST /api/auth/login`
- 受保护接口：
  - `GET /api/auth/me`
  - `POST /api/auth/logout`
  - 其他 `/api/*` 业务接口（`/api/health` 除外）

`authMiddleware` 仅放行登录/注册，不再放行整个 `/auth/*` 前缀，因此 `/api/auth/me` 会执行 JWT 校验并写入 `req.user`。

`/api/auth/logout` 为无状态退出接口：服务端返回成功，客户端负责清理本地 token 与会话状态。

## 用户角色

用户角色写入 `users.role`，JWT 中也会携带 `role`：

- 首个注册用户自动成为 `admin`。
- 后续注册用户默认为 `user`。

全局资源需要管理员权限：

- LLM 配置：`GET/PUT /api/config`、`GET /api/config/providers`、`GET /api/config/providers/:providerId/models`、`POST /api/config/test-model`
- 系统 Agent 模板写操作：`POST /api/templates`、`PUT /api/templates/:id`、`DELETE /api/templates/:id`

普通用户仍可读取系统模板列表并导入模板为自己的用户级 Agent 预设。

## 租户隔离范围

服务端默认并且始终按 `req.user.id` 进行数据隔离：

- `swarms`
- `conversations`
- `agent presets`
- `documents`（知识库）
- `usage analytics`（用量统计）

对应列表/查询/创建/更新/删除操作均传递用户上下文，避免跨用户可见或误操作。

用户级 Agent 预设使用 `(userId, id)` 作为业务键；不同用户可以使用相同预设 ID，不会互相覆盖。

Swarm 内 Agent 使用 `(swarmId, agentId)` 作为业务键；不同 Swarm 可以复用相同 Agent ID，消息与事件仅保存 Agent 字符串标识，不再依赖全局 Agent 外键。

## 文档知识库隔离

文档上传会写入 `userId`，以下接口均按当前用户过滤：

- `GET /api/documents`
- `GET /api/documents/:id`
- `POST /api/documents/upload`
- `PUT /api/documents/:id`
- `POST /api/documents/search`
- `DELETE /api/documents/:id`

聊天运行时启用 `retrieve_knowledge` 后，服务端会按当前 WebSocket 用户创建知识库检索工具；Agent 调用该工具时同样传入当前 `userId`，不会检索其他用户上传的文档。

## 用量统计隔离

以下接口会按当前 `req.user.id` 聚合/查询，不会返回历史公共用户（`__public__`）或其他用户数据：

- `GET /api/conversations/:id/usage`
- `GET /api/usage/daily`
- `GET /api/llm/calls`

## WebSocket 认证

WebSocket 连接需要携带 JWT：

- 查询参数：`/ws?token=<JWT>`
- 或请求头：`Authorization: Bearer <JWT>`

连接后会将用户身份绑定到会话创建/恢复/偏好更新流程。

## 会话分支偏好继承

`forkConversation` 在创建分支会话时会复制源会话偏好：

- `enabledTools`
- `thinkingLevel`
- `directModel`

分支对话将保持与源会话一致的运行配置。
