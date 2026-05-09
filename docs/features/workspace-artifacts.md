# Workspace 产物管理

Workspace 产物是用户级工作区中的文件视图，用于把 `workspace_write_file`、容器执行等工具产生的文件暴露给用户查看和下载。工作区是独立资源，会话只挂载 `workspaceId`；未挂载工作区时后端不会向 Agent 注入 workspace 工具。产物文件仍存放在 `WorkspaceManager` 管理的本地沙箱目录中。

## 前端体验

聊天页右侧提供 Agent、Trace、产物三个 tab。产物 tab 会按目录分组列出当前挂载 workspace 文件，展示路径、类型、大小和更新时间，并支持：

- 目录分组展示与目录折叠。
- 按文件名、路径、类型或语言搜索过滤。
- 文本、Markdown、JSON、HTML 等文本类文件预览。
- 常见代码文件预览和语法高亮，例如 JavaScript、TypeScript、Vue、CSS、Python、Go、Rust、Java、C/C++、Shell、SQL 等。
- 图片文件预览。
- 单文件三点菜单操作：预览、下载、加入文档、标记或取消最终结果、删除。
- 多选产物后批量打包下载、加入文档、标记或取消最终结果、删除。
- 整个工作区打包下载。
- `workspace_write_file` 写入历史记录，详情区可查看、预览并恢复每个文件最近 20 个版本快照。
- 手动刷新列表。

`workspace_write_file` 工具结果会返回 `artifact: true`、`path`、`size`、`kind`、`language`、`previewable` 和 `nextActions`。聊天工具卡识别这组结构化字段后展示为产物卡片，点击“查看”会切换到产物 tab 并打开对应文件。`workspace_list_files`、`workspace_read_file` 和 `workspace_grep` 也会返回结构化路径、文件元信息或 `matchedPaths`，并通过 `nextActions` 提示可继续调用的 workspace 工具。

## API

当前阶段工作区管理 API 已独立为用户级资源：

- `GET /api/workspaces`：列出当前用户未归档工作区。
- `GET /api/workspaces?includeArchived=true`：包含已归档工作区。
- `POST /api/workspaces`：创建工作区，请求体 `{ name: string, description?: string }`。
- `GET /api/workspaces/:id`：读取工作区详情。
- `PATCH /api/workspaces/:id`：更新名称或描述。
- `POST /api/workspaces/:id/archive`：归档工作区。
- `DELETE /api/workspaces/:id`：硬删除工作区，清理文件目录和容器，并解除关联会话挂载。
- `PATCH /api/conversations/:id/workspace`：按 `{ workspaceId: string | null }` 挂载或清除会话工作区。

文件产物 API 归属于 workspace 路由，访问前会校验当前用户拥有该 workspace：

- `GET /api/workspaces/:id/files`：列出 workspace 文件，返回路径、文件名、大小、类型、预览能力、更新时间、下载地址和版本数量。
- `GET /api/workspaces/:id/files/content?path=...`：读取文件预览内容，使用 `WorkspaceManager.readFile()` 的大小和行数限制，过长内容会返回 `truncated: true`。
- `GET /api/workspaces/:id/files/versions?path=...`：读取指定文件的版本记录，按更新时间倒序返回。
- `GET /api/workspaces/:id/files/versions/content?path=...&versionId=...`：读取指定版本快照内容，过长内容会返回 `truncated: true`。
- `POST /api/workspaces/:id/files/versions/restore`：请求体 `{ path: string, versionId: string }`，把指定版本内容恢复为当前文件，并记录一次新的写入历史。
- `GET /api/workspaces/:id/files/download?path=...`：下载指定文件。
- `POST /api/workspaces/:id/files/download-zip`：请求体 `{ paths: string[] }`，把多个产物打包为 zip 下载。
- `POST /api/workspaces/:id/files/import-document`：请求体 `{ path: string }`，读取产物文本内容并写入文档知识库，来源标记为 `workspace_artifact`。
- `PATCH /api/workspaces/:id/files/final`：请求体 `{ path: string, final: boolean }`，标记或取消最终结果。标记信息保存在 workspace 内部 metadata 文件中，不暴露为普通产物。
- `DELETE /api/workspaces/:id/files?path=...`：删除指定产物，并同步清理最终结果标记。

## 安全边界

所有文件路径都通过 `WorkspaceManager.checkPath()` 校验，禁止逃逸当前 workspace 根目录。下载、删除、导入文档等接口在操作前会确认目标是普通文件。会话删除不会清理 workspace 目录和容器；硬删除 workspace 时才清理对应目录和 `agent-swarm.workspace-id` 关联容器。
