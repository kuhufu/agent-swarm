# 文档与 LLM Wiki

文档和 Wiki 分为两个前端入口：文档 tab 管理来源文件、切片和知识库检索；Wiki tab 管理由文档生成的页面、支撑要点和关联页面。聊天默认同时启用 Wiki 检索和文档知识库检索，既能使用整理后的 Wiki，也能回到原始证据。

## 写入方式

- 写入文档：文档 tab 侧边栏的“导入文件”按钮会打开浏览器文件选择器，并以 JSON `{ filename, content }` 或 `multipart/form-data` 调用 `POST /api/documents/upload`，文件字段名为 `file`。
- 从文档生成 Wiki：文档详情通过 `POST /api/wiki/ingest-document/:documentId` 读取已有文档并生成 Wiki 页面，不重复保存来源文件。
- 直接导入 Wiki：`POST /api/wiki/ingest-document` 仍支持 JSON `{ filename, content }` 和 multipart `file`，会先保存来源文档再生成 Wiki 页面。
- 手动维护页面：通过 `POST /api/wiki/pages` 和 `PUT /api/wiki/pages/:id` 创建或编辑 Wiki 页面。
- 重新生成页面：通过 `POST /api/wiki/pages/:id/regenerate` 按页面关联的来源资料重新生成并合并页面内容。

支持解析 `.txt`、`.md`、`.markdown`、`.json`、`.html`、`.htm`、`.pdf`、`.docx`。PDF 通过 `pdf-parse` 提取文本，docx 通过 `mammoth` 提取 raw text。

## 入库流程

文档保存到 `SQLiteVectorStore`，继续作为知识库检索和 Wiki 来源资料。`/api/wiki/ingest-document/:documentId` 会读取已有文档内容，随后调用 LLM 把资料整理为 1-5 个 Wiki 页面。`/api/wiki/ingest-document` 适用于直接导入 Wiki，会先创建来源文档再执行同一套生成逻辑。页面包含：

- `title` / `summary` / `content`
- `aliases` / `tags`
- `claims`：来自原文的支撑要点
- `links`：相关页面建议

LLM 生成使用设置里保存的第一个模型。如果未配置模型或调用失败，系统会退化为基础模式：用原文标题和段落创建一个可编辑 Wiki 页面。

入库时会按页面标题和别名匹配已有 Wiki 页面。命中已有页面时，系统会合并摘要、正文补充、标签、别名、来源资料、支撑要点和关联页面，避免重复导入相近资料时生成大量同名页面。

页面详情提供“重新生成”操作。该操作会读取当前页面的 `sourceDocumentIds`，从来源资料中取回原文，再复用同一套 LLM Wiki 生成和合并逻辑刷新页面。如果页面没有可用来源资料，接口会拒绝重新生成。

## 检索与工具

聊天工具优先使用 `search_wiki`。该工具检索 `wiki_pages` 的标题、摘要、正文、别名和标签，并返回命中的页面与支撑要点。聊天工具卡会展示 Wiki 引用，并可跳转到 `/wiki?wiki=<pageId>` 查看页面。

`retrieve_knowledge` 保留为“知识库”工具，用于直接检索文档 chunk。新会话默认同时启用 `search_wiki` 和 `retrieve_knowledge`，让 Agent 可以同时使用 Wiki 组织知识和原始文档证据。

## 来源回溯

Wiki 页面详情会按 `sourceDocumentIds` 加载来源资料，展示标题、来源类型、原文预览，并支持展开查看完整原文。支撑要点如果带有 `sourceDocumentId`，会显示对应来源标题，便于从生成后的 Wiki 内容回到原始资料核对。

`/documents?doc=<documentId>` 可直接打开来源资料原文；`/wiki?wiki=<pageId>&doc=<documentId>` 会打开 Wiki 页面并自动展开对应来源。

## API

- `GET /api/wiki/pages`
- `GET /api/wiki/pages/:id`
- `POST /api/wiki/pages`
- `PUT /api/wiki/pages/:id`
- `DELETE /api/wiki/pages/:id`
- `POST /api/wiki/pages/:id/regenerate`
- `POST /api/wiki/search`
- `POST /api/wiki/ingest-document`
- `POST /api/wiki/ingest-document/:documentId`

文档接口：

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
