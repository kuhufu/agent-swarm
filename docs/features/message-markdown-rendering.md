# 消息 Markdown 渲染

本文说明前端消息列表如何用第三方库渲染 Markdown，并保证基础安全。

## 实现位置

- `packages/web/src/components/chat/MessageItem.vue`

## 依赖

- `marked`：将 Markdown 转换为 HTML。
- `marked-highlight`：把 `marked` 与语法高亮流程连接起来。
- `highlight.js`：生成代码语法高亮 token（颜色由主题 CSS 提供）。
- `dompurify`：对转换后的 HTML 做净化，避免危险标签和属性注入。

## 渲染策略

1. 消息内容 `message.content` 使用 `Marked` 实例解析，启用 `gfm + breaks`。
2. `message.thinking` 也走同一套解析逻辑，保证展示一致。
3. 代码块通过 `marked-highlight + highlight.js` 生成高亮后的 HTML。
4. 解析结果统一经过 `DOMPurify.sanitize(...)` 后再通过 `v-html` 注入。
5. 组件内为 `p / ul / ol / code / pre / blockquote / a` 提供样式，兼容代码块与列表显示。

## 行为说明

- 保留原有气泡布局与角色样式。
- 流式输出阶段会持续重渲染 Markdown 内容。
- 代码块高亮主题使用 `highlight.js/styles/github-dark.css`。
- 对空内容不渲染 Markdown 容器，避免多余节点。
