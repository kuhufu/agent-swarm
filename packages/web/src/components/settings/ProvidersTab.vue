<script setup lang="ts">
import { reactive, computed } from "vue";
import CustomSelect from "../common/CustomSelect.vue";
import SvgIcon from "../common/SvgIcon.vue";
import type { ApiProtocol, ProviderConfig } from "../../types/index.js";

const props = defineProps<{
  providers: Record<string, {
    apiKey: string;
    baseUrl: string;
    apiProtocol: ApiProtocol | "";
    thinkingFormat: string;
  }>;
}>();

const emit = defineEmits<{
  (e: "remove", id: string): void;
  (e: "update", id: string, field: string, value: unknown): void;
}>();

const API_PROTOCOLS: { value: ApiProtocol; label: string }[] = [
  { value: "openai-completions", label: "OpenAI Completions" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
  { value: "google-generative-ai", label: "Google Generative AI" },
  { value: "mistral-conversations", label: "Mistral Conversations" },
  { value: "azure-openai-responses", label: "Azure OpenAI Responses" },
];

const providerList = computed(() =>
  Object.keys(props.providers).map((id) => ({
    id,
    label: id,
    defaultProtocol: "openai-completions" as ApiProtocol,
    custom: true,
  })),
);

function getEffectiveProtocol(id: string): ApiProtocol {
  const entry = props.providers[id];
  if (entry?.apiProtocol) return entry.apiProtocol;
  return "openai-completions";
}
</script>

<template>
  <div>
    <div class="content-header">
      <h3>LLM 提供商</h3>
      <p>配置 API Key、Base URL 和协议</p>
    </div>

    <div class="provider-list">
      <div v-for="p in providerList" :key="p.id" class="provider-card card">
        <div class="provider-header">
          <div class="provider-title">
            <div class="provider-avatar">{{ p.id.charAt(0).toUpperCase() }}</div>
            <span class="provider-name">{{ p.id }}</span>
          </div>
          <button class="remove-btn" @click="emit('remove', p.id)">
            <SvgIcon name="close" :size="14" />
          </button>
        </div>

        <div class="provider-fields">
          <div class="field-row">
            <label>API Key</label>
            <input
              :value="providers[p.id].apiKey"
              class="input-field"
              placeholder="sk-..."
              type="password"
              @input="emit('update', p.id, 'apiKey', ($event.target as HTMLInputElement).value)"
            />
          </div>
          <div class="field-row">
            <label>Base URL</label>
            <input
              :value="providers[p.id].baseUrl"
              class="input-field"
              placeholder="https://api.example.com/v1"
              @input="emit('update', p.id, 'baseUrl', ($event.target as HTMLInputElement).value)"
            />
          </div>
          <div class="field-row">
            <label>API 协议</label>
            <CustomSelect
              :model-value="providers[p.id].apiProtocol"
              :options="[{ value: '', label: `默认 (${getEffectiveProtocol(p.id)})` }, ...API_PROTOCOLS]"
              @update:model-value="emit('update', p.id, 'apiProtocol', $event)"
            />
          </div>
          <div class="field-row">
            <label>思考格式</label>
            <CustomSelect
              :model-value="providers[p.id].thinkingFormat"
              :options="[{ value: '', label: '自动检测' }, { value: 'openai', label: 'OpenAI (reasoning_effort)' }, { value: 'deepseek', label: 'DeepSeek (thinking: { type })' }, { value: 'openrouter', label: 'OpenRouter (reasoning: { effort })' }, { value: 'zai', label: 'ZAI (enable_thinking)' }, { value: 'qwen', label: 'Qwen (enable_thinking)' }, { value: 'qwen-chat-template', label: 'Qwen Chat Template' }]"
              @update:model-value="emit('update', p.id, 'thinkingFormat', $event)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.content-header {
  margin-bottom: 24px;
}
.content-header h3 {
  font-size: var(--text-xl);
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 4px;
}
.content-header p {
  font-size: var(--text-base);
  color: var(--text-muted);
  margin: 0;
}
.provider-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.provider-card {
  padding: 20px;
}
.provider-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.provider-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.provider-avatar {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(139, 92, 246, 0.15));
  border-radius: 8px;
  font-size: var(--text-base);
  font-weight: 700;
  color: var(--text-secondary);
}
.provider-name {
  color: var(--text-primary);
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
}
.provider-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.field-row {
  display: flex;
  align-items: center;
  gap: 14px;
}
.field-row label {
  color: var(--text-muted);
  min-width: 70px;
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  flex-shrink: 0;
}
.field-row input {
  flex: 1;
}
.checkbox-inline {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
.checkbox-inline input[type="checkbox"] {
  width: 14px;
  height: 14px;
  accent-color: var(--color-accent);
}
</style>
