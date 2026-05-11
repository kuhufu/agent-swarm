# UI 设计规范

## 概览

- **设计语言**：扁平实色，放弃玻璃拟态
- **配色原则**：黑白灰 + 橄榄绿主题色，大面积中性色突出关键交互
- **深色模式**：底色不用纯黑（`#1a1a18`），用暖深灰
- **浅色模式**：底色不用纯白（`#f5f4f0`），用苹果暖灰
- **未来扩展**：支持用户自定义主题色（通过 CSS 变量动态注入）

---

## 配色方案

### 深色模式

| Token | 值 | 用途 |
|-------|-----|------|
| `--bg-root` | `#1a1a18` | 页面根背景 |
| `--bg-surface` | `#222220` | 面板/侧边栏背景 |
| `--bg-card` | `#2a2a28` | 卡片/弹窗背景 |
| `--bg-hover` | `#323230` | hover 态背景 |
| `--border-subtle` | `#333330` | 最弱分割线 |
| `--border-default` | `#444440` | 默认边框 |
| `--text-primary` | `#e8e6e3` | 主要文字 |
| `--text-secondary` | `#a09e99` | 次要文字 |
| `--text-muted` | `#6b6966` | 禁用/提示文字 |

### 浅色模式

| Token | 值 | 用途 |
|-------|-----|------|
| `--bg-root` | `#fafafa` | 页面根背景 |
| `--bg-surface` | `#ffffff` | 面板/侧边栏背景 |
| `--bg-card` | `#fcfcfc` | 卡片/弹窗背景 |
| `--bg-hover` | `#f2f2f2` | hover 态背景 |
| `--border-subtle` | `#e8e8e8` | 最弱分割线 |
| `--border-default` | `#d4d4d4` | 默认边框 |
| `--text-primary` | `#1a1a1a` | 主要文字 |
| `--text-secondary` | `#666666` | 次要文字 |
| `--text-muted` | `#999999` | 禁用/提示文字 |

### 主题色（橄榄绿）

| Token | 深色模式 | 浅色模式 | 用途 |
|-------|---------|---------|------|
| `--color-accent` | `#9aaa64` | `#5f7038` | 主色：按钮、tab 高亮、链接、brand |
| `--color-accent-light` | `#b5c47a` | `#7d8f50` | 亮色变体：hover 文本、badge |
| `--color-accent-bg` | `rgba(154,170,100,0.08)` | `rgba(95,112,56,0.06)` | hover 背景：列表项、tab hover、卡片 hover |
| `--color-accent-glow` | `rgba(154,170,100,0.2)` | `rgba(95,112,56,0.15)` | 阴影/发光：按钮 hover、focus ring |

### 主题色使用规则

主题色只出现在以下交互元素上，非功能性元素（背景、普通文字、边框）一律不用：

| 允许 | 禁止 |
|------|------|
| 主按钮（`.btn-primary`）背景 | 卡片背景、面板背景 |
| tab 高亮（active 态文字 + bottom line） | 分割线、边框 |
| 链接文字 | 普通正文 |
| Brand logo / 品牌图标 | 图标默认色 |
| 输入框 focus ring | checkbox、radio 等表单控件底色 |
| hover 背景（`.hover-bg`）使用 `--color-accent-bg` | 禁用状态文字 |

### 语义色

| Token | 深色模式 | 浅色模式 | 用途 |
|-------|---------|---------|------|
| `--color-success` | `#22c55e` | `#16a34a` | 成功/完成 |
| `--color-warning` | `#f59e0b` | `#d97706` | 警告/待处理 |
| `--color-danger` | `#ef4444` | `#dc2626` | 错误/删除/危险操作 |

---

## 圆角体系

统一使用 token，禁止硬编码 px 值。

| Token | 值 | 用途 |
|-------|-----|------|
| `--radius-sm` | `6px` | 标签、badge、小按钮、代码内联块 |
| `--radius-md` | `8px` | 输入框、按钮、菜单项、tab、工具卡片 |
| `--radius-lg` | `12px` | 卡片、面板、侧边栏列表项、弹窗 |
| `--radius-xl` | `16px` | 大弹窗、modal、对话框 |
| `9999px` | 圆角 pill | badge、状态标签（仅此场景） |

---

## 阴影体系

单层阴影，不叠加多层、不使用内阴影或发光效果。阴影只出现在「浮起」的元素上。

| Token | 深色模式 | 浅色模式 | 用途 |
|-------|---------|---------|------|
| `--shadow-sm` | `0 1px 3px rgba(0,0,0,0.4)` | `0 1px 3px rgba(0,0,0,0.08)` | 按钮 hover、输入框 focus、tooltip |
| `--shadow-md` | `0 2px 8px rgba(0,0,0,0.5)` | `0 2px 8px rgba(0,0,0,0.08)` | 卡片、面板、下拉菜单 |
| `--shadow-lg` | `0 8px 32px rgba(0,0,0,0.6)` | `0 8px 32px rgba(0,0,0,0.1)` | 弹窗、modal、对话框 |

---

## 排版

### 字体

| Token | 值 |
|-------|-----|
| `--font-sans` | `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` |
| `--font-mono` | `'JetBrains Mono', ui-monospace, monospace` |

- body：`letter-spacing: -0.01em`，`font-feature-settings: cv02 cv03 cv04 cv11`
- 正文：行高 `1.6 — 1.7`（markdown 内容）

### 字号 Token

使用 token 定义字号，禁止硬编码 `px` 值。

| Token | 值 | 默认字重 | 用途 |
|-------|-----|---------|------|
| `--text-xs` | `10px` | 400 | 辅助标签、badge 内数字 |
| `--text-sm` | `12px` | 400 | 元信息、时间戳、placeholder |
| `--text-base` | `14px` | 400 | **正文**、输入框、列表项 |
| `--text-lg` | `16px` | 600 | 标题、弹窗标题 |
| `--text-xl` | `20px` | 600 | 页面标题 |

### 字重 Token

| Token | 值 | 用途 |
|-------|-----|------|
| `--weight-normal` | `400` | 正文、placeholder |
| `--weight-medium` | `500` | 按钮文字、次要标题 |
| `--weight-bold` | `600` | 主按钮、主标题、强调文字 |

---

## 组件规范

### 按钮

| 类型 | 高度 | 内边距 | 圆角 | 字体 |
|------|------|--------|------|------|
| 主按钮 | `36px` | `8px 18px` | `--radius-md` | `--text-base / --weight-bold`，`var(--color-accent)` 背景 |
| 次按钮 | `36px` | `8px 18px` | `--radius-md` | `--text-base / --weight-medium`，`var(--bg-card)` 背景 + 边框 |
| 危险按钮 | `36px` | `8px 16px` | `--radius-md` | `--text-sm / --weight-bold`，`var(--color-danger)` 文字 |

### 输入框

| 属性 | 值 |
|------|-----|
| 高度 | `36px` |
| 内边距 | `10px 14px` |
| 圆角 | `--radius-md` |
| 背景 | `--bg-surface` |
| 边框 | `1px solid var(--border-default)` |
| Focus | `border-color: var(--color-accent)` + `box-shadow: 0 0 0 3px var(--color-accent-glow)` |

### 卡片

| 属性 | 值 |
|------|-----|
| 背景 | `--bg-card` |
| 边框 | `1px solid var(--border-subtle)` |
| 圆角 | `--radius-lg` |
| hover | `background: var(--bg-hover)`，`border-color: var(--border-default)` |

### 侧边栏

| 属性 | 值 |
|------|-----|
| 宽度 | `350px` |
| 背景 | `--bg-surface` |
| 分割线 | `1px solid var(--border-subtle)` |
| 列表项 hover | `background: var(--color-accent-bg)` |
| 列表项 active | `background: var(--color-accent-bg)` + `border-left: 2px solid var(--color-accent)` |

### 弹窗

| 属性 | 值 |
|------|-----|
| 背景 | `--bg-card` |
| 圆角 | `--radius-xl` |
| 阴影 | `--shadow-lg` |
| overlay 背景 | `rgba(0,0,0,0.5)`（深色）/ `rgba(0,0,0,0.15)`（浅色），无 blur |

---

## 主题色切换架构（未来实现）

采用 **Option A**：CSS 变量动态注入。

```
用户选择主题色
      ↓
写入 localStorage
      ↓
document.documentElement.style.setProperty('--color-accent', ...)
      ↓
所有 var(--color-accent) 自动响应
      ↓
切换时连带更新 --color-accent-light / --color-accent-bg / --color-accent-glow
```

无需修改组件代码，无需重新编译。主题色设置 UI 放在「个人设置」弹窗的主题 tab 中。
