# LLM Wiki 与来源资料

知识库主体验已替换为 LLM Wiki。用户默认管理的是 Wiki 页面、支撑要点和关联页面；原始上传文件保留为来源资料，用于引用、回溯和旧检索 fallback。

## 写入方式

- 粘贴资料：前端以 JSON `{ filename, content }` 调用 `POST /api/wiki/ingest-document`。
- 上传文件：前端以 `multipart/form-data` 调用同一接口，文件字段名为 `file`。
- 手动维护页面：通过 `POST /api/wiki/pages` 和 `PUT /api/wiki/pages/:id` 创建或编辑 Wiki 页面。
- 重新生成页面：通过 `POST /api/wiki/pages/:id/regenerate` 按页面关联的来源资料重新生成并合并页面内容。

支持解析 `.txt`、`.md`、`.markdown`、`.json`、`.html`、`.htm`、`.pdf`、`.docx`。PDF 通过 `pdf-parse` 提取文本，docx 通过 `mammoth` 提取 raw text。

## 入库流程

`/api/wiki/ingest-document` 会先把原始资料写入旧的 `SQLiteVectorStore`，作为来源资料保留；随后调用 LLM 把资料整理为 1-5 个 Wiki 页面。页面包含：

- `title` / `summary` / `content`
- `aliases` / `tags`
- `claims`：来自原文的支撑要点
- `links`：相关页面建议

LLM 生成使用设置里保存的第一个模型。如果未配置模型或调用失败，系统会退化为基础模式：用原文标题和段落创建一个可编辑 Wiki 页面。

入库时会按页面标题和别名匹配已有 Wiki 页面。命中已有页面时，系统会合并摘要、正文补充、标签、别名、来源资料、支撑要点和关联页面，避免重复导入相近资料时生成大量同名页面。

页面详情提供“重新生成”操作。该操作会读取当前页面的 `sourceDocumentIds`，从来源资料中取回原文，再复用同一套 LLM Wiki 生成和合并逻辑刷新页面。如果页面没有可用来源资料，接口会拒绝重新生成。

## 检索与工具

聊天工具优先使用 `search_wiki`。该工具检索 `wiki_pages` 的标题、摘要、正文、别名和标签，并返回命中的页面与支撑要点。聊天工具卡会展示 Wiki 引用，并可跳转到 `/documents?wiki=<pageId>` 查看页面。

旧的 `retrieve_knowledge` 仍保留为“旧知识库”工具，用于直接检索原始 chunk。新会话默认启用 `search_wiki`，不默认启用 `retrieve_knowledge`。

## API

- `GET /api/wiki/pages`
- `GET /api/wiki/pages/:id`
- `POST /api/wiki/pages`
- `PUT /api/wiki/pages/:id`
- `DELETE /api/wiki/pages/:id`
- `POST /api/wiki/pages/:id/regenerate`
- `POST /api/wiki/search`
- `POST /api/wiki/ingest-document`

旧来源资料接口仍可用：

- `GET /api/documents`
- `GET /api/documents/:id`
- `GET /api/documents/:id/chunks`
- `POST /api/documents/upload`
- `PUT /api/documents/:id`
- `POST /api/documents/search`
- `DELETE /api/documents/:id`

## 限制

- 单文件大小上限：10MB。
- 空文本会被拒绝。
- Wiki 页面、来源资料和检索均按当前登录用户隔离。
- 自动合并只按标题和别名判断，不做深度语义去重；标题不同但语义相同的页面仍可能需要用户手动整理。
