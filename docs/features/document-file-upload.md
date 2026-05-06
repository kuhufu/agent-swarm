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

## 限制

- 单文件大小上限：10MB。
- 空文本会被拒绝。
- 文档按当前登录用户隔离。
