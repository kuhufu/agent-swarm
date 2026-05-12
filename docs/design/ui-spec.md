# UI 设计规范

## 概览

- **设计语言**：扁平实色，放弃玻璃拟态
- **配色原则**：纯黑白灰，零主题色。大面积中性色通过层级（root → surface → card → hover）区分结构
- **深色模式**：底色不用纯黑（`#1a1a18`），用暖深灰
- **浅色模式**：底色不用纯白（`#f5f4f0`），用苹果暖灰
- **未来扩展**：主题色体系（`--color-accent` 系列）已在 CSS 变量中定义，但默认渲染不使用；留待后续用户自定义主题功能按需启用

---

## 配色方案

### 深色模式

| Token | 值 | 用途 |
|-------|-----|------|
| `--bg-root` | `#1a1a18` | 页面根背景 |
| `--bg-surface` | `#222220` | 面板/侧边栏背景 |
| `--bg-card` | `#2a2a28` | 卡片/弹窗背景 |
| `--bg-hover` | `#323230` | hover/选中背景 |
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
| `--bg-hover` | `#f2f2f2` | hover/选中背景 |
| `--bg-overlay` | `rgba(0,0,0,0.25)`（深色: `rgba(0,0,0,0.6)`） | 弹窗遮罩 |
| `--border-subtle` | `#e8e8e8` | 最弱分割线 |
| `--border-default` | `#d4d4d4` | 默认边框 |
| `--text-primary` | `#1a1a1a` | 主要文字 |
| `--text-secondary` | `#666666` | 次要文字 |
| `--text-muted` | `#999999` | 禁用/提示文字 |

### 自定义主题色（预留，默认未使用）

`--color-accent`、`--color-accent-light`、`--color-accent-bg`、`--color-accent-glow` 四个变量已在 CSS 中定义，供未来用户自定义主题功能使用。当前默认渲染中组件**不引用**这些变量——所有交互元素（按钮、tab、链接、brand 图标等）均使用中性色 token。

如果启用自定义主题色，遵循以下使用规则：

| Token | 用途 |
|-------|------|
| `--color-accent` | `#60a5fa` | `#3b82f6` | 主按钮背景、brand 图标背景、发送按钮背景、用户头像背景 |
| `--color-accent-light` | `#93c5fd` | `#60a5fa` | tab active 文字、链接文字、badge/标签文字 |
| `--color-accent-bg` | `rgba(96,165,250,0.08)` | `rgba(59,130,246,0.06)` | 侧边栏对话列表项 hover、tab 按钮 hover、卡片 hover |
| `--color-accent-glow` | `rgba(96,165,250,0.2)` | `rgba(59,130,246,0.15)` | 按钮 hover 阴影、输入框 focus ring |

### 语义色（始终使用）

| Token | 深色模式 | 浅色模式 | 用途 |
|-------|---------|---------|------|
| `--color-success` | `#22c55e` | `#16a34a` | 成功/完成 |
| `--color-warning` | `#f59e0b` | `#d97706` | 警告/待处理 |
| `--color-danger` | `#ef4444` | `#dc2626` | 错误/删除/危险操作 |

---

## 交互背景规则

hover/active 背景统一使用 `--bg-hover`，只有以下场景使用 `--bg-hover`（均为列表元素 hover）：

| 场景 | 适用位置 |
|------|---------|
| 对话列表项 hover | AppSidebar `.conversation-item:hover` |
| 侧边栏导航项 hover | SwarmsView/AgentsView/SettingsView 等 `.swarm-item:hover`、`.preset-item:hover` 等 |
| Tab 按钮 hover | `.tab-btn:hover` |
| 卡片 hover | `.swarm-card:hover`、`.workspace-card:hover` 等 |

非列表元素（下拉菜单项、chip/标签、设置项等）hover 使用 `--bg-hover`。

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
| `--shadow-md` | `0 2px 8px rgba(0,0,0,0.25)` | `0 2px 8px rgba(0,0,0,0.12)` | 卡片、面板、下拉菜单 |
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

| 类型 | 高度 | 背景 | 边框 | 圆角 | 字体 |
|------|------|------|------|------|------|
| 主按钮 | `36px` | `--bg-hover` | `1px solid var(--border-default)` | `--radius-md` | `--text-base / --weight-bold`，`--text-primary` |
| 次按钮 | `36px` | `--bg-card` | `1px solid var(--border-default)` | `--radius-md` | `--text-base / --weight-medium`，`--text-secondary` |
| 危险按钮 | `36px` | transparent | `1px solid var(--color-danger)` | `--radius-md` | `--text-sm / --weight-bold`，`--color-danger` |

### 输入框

| 属性 | 值 |
|------|-----|
| 高度 | `36px` |
| 内边距 | `10px 14px` |
| 圆角 | `--radius-md` |
| 背景 | `--bg-surface` |
| 边框 | `1px solid var(--border-default)` |
| Focus | `border-color: var(--border-default)` + `box-shadow: 0 0 0 2px var(--bg-hover)` |

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
| 列表项 hover | `background: var(--bg-hover)` |
| 列表项 active | `background: var(--bg-hover)` |

### 弹窗

| 属性 | 值 |
|------|-----|
| 背景 | `--bg-card` |
| 圆角 | `--radius-xl` |
| 阴影 | `--shadow-lg` |
| overlay 背景 | `var(--bg-overlay)`，无 blur |

---

## 主题色切换架构

**已实现**。采用 **CSS 变量动态注入**：

```
用户选择主题色（预设色块或自定义 hex）
      ↓
预设色：JS 设置精确 dark/light 两套派生值（--color-accent-light/bg/glow）
自定义 hex：CSS color-mix() 自动派生其余变量
      ↓
写入 localStorage
      ↓
所有 var(--color-accent-*) 自动响应
      ↓
主题模式切换时，预设色自动切换对应色值
```

### 预设色

| 名称 | 主色 | 深色 `-light` | 深色 `-bg` | 深色 `-glow` |
|------|------|--------------|-----------|------------|
| 天空蓝 (默认) | `#60a5fa` | `#93c5fd` | `rgba(96,165,250,0.08)` | `rgba(96,165,250,0.2)` |
| 靛蓝 | `#6366f1` | `#818cf8` | `rgba(99,102,241,0.08)` | `rgba(99,102,241,0.2)` |
| 翡翠绿 | `#34d399` | `#5eead4` | `rgba(52,211,153,0.08)` | `rgba(52,211,153,0.2)` |
| 琥珀 | `#f59e0b` | `#fbbf24` | `rgba(245,158,11,0.08)` | `rgba(245,158,11,0.2)` |
| 玫瑰红 | `#f43f5e` | `#fb7185` | `rgba(244,63,94,0.08)` | `rgba(244,63,94,0.2)` |
| 紫色 | `#a855f7` | `#c084fc` | `rgba(168,85,247,0.08)` | `rgba(168,85,247,0.2)` |

浅色模式 `-bg` 用 6% opacity，`-glow` 用 15%。

### 自定义色

选择预设色之外的颜色时，`<html>` 添加 `data-accent-custom` 属性，CSS `color-mix()` 自动派生：

```css
[data-accent-custom] {
  --color-accent-light: color-mix(in srgb, var(--color-accent), white 25%);
  --color-accent-bg: color-mix(in srgb, var(--color-accent) 8%, transparent);
  --color-accent-glow: color-mix(in srgb, var(--color-accent) 18%, transparent);
}
```

主题色设置 UI 位于「个人设置」弹窗的主题 tab 中。

### 组件引用

当前引用 `--color-accent-*` 的组件：
- `AppSidebar.vue` — sidebar tab active、brand 图标
- `StreamingText.vue` — 打字光标
- `WikiView.vue`、`HistoryView.vue` — 主按钮背景
- `index.css` — `.badge-accent`、`.remove-btn:hover`、`.text-gradient`、`::selection`
- `agent-color.ts` — Agent 头像颜色兜底
- `PersonalSettingsModal.vue` — 主题色选择器 UI
