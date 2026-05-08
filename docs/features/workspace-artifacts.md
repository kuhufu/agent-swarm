# Workspace 产物管理

Workspace 产物是按会话隔离的工作区文件视图，用于把 `workspace_write_file`、容器执行等工具产生的文件暴露给用户查看和下载。产物文件仍存放在 `WorkspaceManager` 管理的会话目录中，不新增独立文件存储。

## 前端体验

聊天页右侧提供 Agent、Trace、产物三个 tab。产物 tab 会按目录分组列出当前会话 workspace 文件，展示路径、类型、大小和更新时间，并支持：

- 目录分组展示与目录折叠。
- 按文件名、路径、类型或语言搜索过滤。
- 文本、Markdown、JSON、HTML 等文本类文件预览。
- 常见代码文件预览和语法高亮，例如 JavaScript、TypeScript、Vue、CSS、Python、Go、Rust、Java、C/C++、Shell、SQL 等。
- 图片文件预览。
- 单文件三点菜单操作：预览、下载、加入文档、标记或取消最终结果、删除。
- 多选产物后批量打包下载、加入文档、标记或取消最终结果、删除。
- 整个工作区打包下载。
- `workspace_write_file` 写入历史记录，详情区可查看并预览每个文件最近 20 个版本快照。
- 手动刷新列表。

`workspace_write_file` 工具结果会返回 `artifact: true`、`path`、`size`、`kind`、`language` 和 `previewable`。聊天工具卡识别这组结构化字段后展示为产物卡片，点击“查看”会切换到产物 tab 并打开对应文件。

## API

所有接口都需要当前用户拥有对应会话：

- `GET /api/conversations/:id/workspace/files`：列出当前会话 workspace 文件，返回路径、文件名、大小、类型、预览能力、更新时间、下载地址和版本数量。
- `GET /api/conversations/:id/workspace/files/content?path=...`：读取文件预览内容，使用 `WorkspaceManager.readFile()` 的大小和行数限制，过长内容会返回 `truncated: true`。
- `GET /api/conversations/:id/workspace/files/versions?path=...`：读取指定文件的版本记录，按更新时间倒序返回。
- `GET /api/conversations/:id/workspace/files/versions/content?path=...&versionId=...`：读取指定版本快照内容，过长内容会返回 `truncated: true`。
- `GET /api/conversations/:id/workspace/files/download?path=...`：下载指定文件。
- `POST /api/conversations/:id/workspace/files/download-zip`：请求体 `{ paths: string[] }`，把多个产物打包为 zip 下载。
- `POST /api/conversations/:id/workspace/files/import-document`：请求体 `{ path: string }`，读取产物文本内容并写入文档知识库，来源标记为 `workspace_artifact`。
- `PATCH /api/conversations/:id/workspace/files/final`：请求体 `{ path: string, final: boolean }`，标记或取消最终结果。标记信息保存在 workspace 内部 metadata 文件中，不暴露为普通产物。
- `DELETE /api/conversations/:id/workspace/files?path=...`：删除指定产物，并同步清理最终结果标记。

## 安全边界

所有文件路径都通过 `WorkspaceManager.checkPath()` 校验，禁止逃逸当前会话 workspace 根目录。下载、删除、导入文档等接口在操作前会确认目标是普通文件。会话删除时，`AgentSwarm.deleteConversation()` 仍负责清理 workspace 目录和关联容器。
