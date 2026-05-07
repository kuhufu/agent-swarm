# 消息 Markdown 渲染

本文说明前端消息列表如何用第三方库渲染 Markdown，并保证基础安全。

## 实现位置

- `packages/web/src/composables/useMarkdown.ts`
- `packages/web/src/components/chat/MessageItem.vue`
- `packages/web/src/components/common/MarkdownRenderer.vue`

## 依赖

- `marked`：将 Markdown 转换为 HTML。
- `marked-highlight`：把 `marked` 与语法高亮流程连接起来。
- `highlight.js`：生成代码语法高亮 token（颜色由主题 CSS 提供）。
- `katex`：渲染 LaTeX 数学公式。
- `dompurify`：对转换后的 HTML 做净化，避免危险标签和属性注入。

## 渲染策略

1. 消息内容 `message.content` 使用 `Marked` 实例解析，启用 `gfm + breaks`。
2. `message.thinking` 也走同一套解析逻辑，保证展示一致。
3. Markdown 解析前会提取数学片段，避开 fenced code block 和 inline code。
4. 支持 `$...$`、`$$...$$`、`\(...\)`、`\[...\]` 四类数学公式分隔符，使用 KaTeX 渲染，包含 `\boxed{...}` 等常见 LaTeX 命令；不渲染未使用分隔符包裹的裸公式片段。
5. 代码块通过 `marked-highlight + highlight.js` 生成高亮后的 HTML。
6. 解析结果统一经过 `DOMPurify.sanitize(...)` 后再通过 `v-html` 注入。
7. 组件内为 `p / ul / ol / code / pre / blockquote / a / .katex / .katex-display` 提供样式，兼容代码块、列表和数学公式显示。

## 行为说明

- 保留原有气泡布局与角色样式。
- 流式输出阶段会持续重渲染 Markdown 内容。
- 代码块高亮主题使用 `highlight.js/styles/github-dark.css`。
- 数学公式样式使用 `katex/dist/katex.min.css`，块级公式横向溢出时可滚动。
- 对空内容不渲染 Markdown 容器，避免多余节点。
