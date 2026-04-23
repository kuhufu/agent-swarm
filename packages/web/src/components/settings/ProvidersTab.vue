<script setup lang="ts">
import { reactive, computed } from "vue";
import CustomSelect from "../common/CustomSelect.vue";
import type { ApiProtocol, ProviderConfig } from "../../types/index.js";

const props = defineProps<{
  providers: Record<string, {
    apiKey: string;
    baseUrl: string;
    apiProtocol: ApiProtocol | "";
    enableThinkingCompat: boolean;
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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
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
            <label>思考兼容</label>
            <label class="checkbox-inline">
              <input
                :checked="providers[p.id].enableThinkingCompat"
                type="checkbox"
                @change="emit('update', p.id, 'enableThinkingCompat', ($event.target as HTMLInputElement).checked)"
              />
              <span>使用 `enable_thinking` 参数控制思考</span>
            </label>
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
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0 0 4px;
}
.content-header p {
  font-size: 14px;
  color: var(--color-text-muted);
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
  font-size: 14px;
  font-weight: 700;
  color: var(--color-accent-light);
}
.provider-name {
  color: var(--color-text-primary);
  font-size: 15px;
  font-weight: 600;
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
  color: var(--color-text-muted);
  min-width: 70px;
  font-size: 13px;
  font-weight: 500;
  flex-shrink: 0;
}
.field-row input {
  flex: 1;
}
.checkbox-inline {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-secondary);
  font-size: 12px;
}
.checkbox-inline input[type="checkbox"] {
  width: 14px;
  height: 14px;
  accent-color: #6366f1;
}
</style>
