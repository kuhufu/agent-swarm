# Provider 兼容参数：`enable_thinking`

本文说明如何在 Agent Swarm 中启用 `enable_thinking` 兼容模式。

## 背景

部分 OpenAI 兼容模型（常见于部分 Qwen 接口）不使用 `reasoning_effort` 控制思考开关，而是使用顶层参数：

- `enable_thinking: true | false`

如果未按该字段传参，可能出现：

- 关闭 Think 开关后模型仍持续思考；
- 开启 Think 开关时请求 400（不支持 `reasoning_effort`）。

## 当前实现

已新增 provider 兼容参数：

- `providers.<providerId>.enable_thinking: boolean`

行为如下：

1. 启用后，模型请求兼容策略会切换为 `qwen` thinking 格式（发送 `enable_thinking`）。
2. Think 开关打开时发送 `enable_thinking: true`。
3. Think 开关关闭时发送 `enable_thinking: false`。
4. 该策略会同步用于“模型连接测试”接口（`/api/config/test-model` 的 `override.enable_thinking`）。

## 配置方式

### 1) 设置页（推荐）

在「设置 -> 提供商配置」中勾选：

- `使用 enable_thinking 参数控制思考`

保存后会写入对应 provider 配置。

### 2) 配置文件/接口

```ts
llm: {
  apiKeys: {
    siliconflow: "xxx",
  },
  providers: {
    siliconflow: {
      baseUrl: "https://api.siliconflow.cn/v1",
      apiProtocol: "openai-completions",
      enable_thinking: true,
    },
  },
}
```

## 可选：模型级覆盖

若在 swarm agent 的 `model.options` 中显式传入：

- `enable_thinking`
- `reasoning`
- `compat`

会覆盖/补充 provider 级默认行为。

## 相关代码

- `packages/core/src/llm/provider.ts`
- `packages/core/src/core/types.ts`
- `packages/core/src/core/swarm.ts`
- `packages/server/src/routes/config.ts`
- `packages/web/src/views/SettingsView.vue`
