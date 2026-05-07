# 文档文件上传

知识库支持两种写入方式：

- 手动新建/编辑文档，前端以 JSON `{ filename, content }` 调用 `POST /api/documents/upload`。
- 选择本地文件上传，前端以 `multipart/form-data` 调用同一接口，文件字段名为 `file`。

## 支持格式

当前内置解析支持：

- `.txt`
- `.md` / `.markdown`
- `.json`
- `.html` / `.htm`
- `.pdf`
- `.docx`

上传后服务端会解析为文本，按现有 chunk 规则写入 SQLite FTS 知识库。`retrieve_knowledge` 工具可立即检索新文档。

PDF 通过 `pdf-parse` 提取文本，docx 通过 `mammoth` 提取 raw text。若文件没有可提取文本，接口会拒绝写入。

## 聊天引用回显

Agent 调用 `retrieve_knowledge` 后，工具返回的 `details` 会保留命中文档、片段序号、内容和相关度。聊天消息里的工具卡会把这些结果渲染为“知识库引用”，用于直接查看回答参考了哪些文档片段。

实时 WebSocket 事件与历史消息恢复共用同一个工具卡展示逻辑；未命中时显示空引用状态，不再展开原始 JSON。

引用标题会链接到 `/documents?doc=<documentId>&chunk=<chunkIndex>`，打开知识库页并自动展开对应文档详情，同时在正文上方显示命中的引用片段。知识库页选中文档时也会同步 `doc` 查询参数，刷新页面后可恢复当前文档。

前端通过 `GET /api/documents/:id/chunks` 读取文档片段，服务端会先校验文档属于当前用户再返回 chunks。

## 限制

- 单文件大小上限：10MB。
- 空文本会被拒绝。
- 文档按当前登录用户隔离。
