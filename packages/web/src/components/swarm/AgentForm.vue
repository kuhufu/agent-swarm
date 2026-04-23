<script setup lang="ts">
import { reactive, ref, computed } from "vue";
import { useSettingsStore } from "../../stores/settings.js";
import type { SwarmAgentConfig, SavedModel } from "../../types/index.js";

const props = defineProps<{
  editingAgent?: SwarmAgentConfig | null;
}>();

const emit = defineEmits<{
  (e: "submit", agent: SwarmAgentConfig): void;
  (e: "cancel"): void;
}>();

const settingsStore = useSettingsStore();
const savedModels = computed<SavedModel[]>(() => settingsStore.config?.models ?? []);
const showCustomModel = ref(false);

const agentForm = reactive<SwarmAgentConfig>({
  id: props.editingAgent?.id ?? "",
  name: props.editingAgent?.name ?? "",
  description: props.editingAgent?.description ?? "",
  systemPrompt: props.editingAgent?.systemPrompt ?? "",
  model: props.editingAgent?.model
    ? { ...props.editingAgent.model }
    : { provider: "", modelId: "" },
});

if (props.editingAgent?.model) {
  showCustomModel.value = savedModels.value.every(
    (sm) => !(sm.provider === props.editingAgent!.model.provider && sm.modelId === props.editingAgent!.model.modelId),
  );
}

function selectModelForAgent(model: SavedModel) {
  agentForm.model.provider = model.provider;
  agentForm.model.modelId = model.modelId;
  showCustomModel.value = false;
}

function clearModelSelection() {
  agentForm.model.provider = "";
  agentForm.model.modelId = "";
  showCustomModel.value = true;
}

function handleSubmit() {
  if (!agentForm.id || !agentForm.name) return;
  emit("submit", { ...agentForm, model: { ...agentForm.model } });
}
</script>

<template>
  <div class="agent-form card">
    <div class="form-row">
      <label>ID</label>
      <input v-model="agentForm.id" class="input-field" placeholder="agent-1" :disabled="!!editingAgent" />
    </div>
    <div class="form-row">
      <label>名称</label>
      <input v-model="agentForm.name" class="input-field" placeholder="Agent 1" />
    </div>
    <div class="form-row">
      <label>描述</label>
      <input v-model="agentForm.description" class="input-field" placeholder="负责..." />
    </div>
    <div class="form-row">
      <label>System Prompt</label>
      <textarea v-model="agentForm.systemPrompt" class="input-field" placeholder="你是一个..." rows="3" />
    </div>

    <div v-if="savedModels.length > 0" class="model-selection">
      <label class="form-label" style="margin-bottom: 8px;">选择模型</label>
      <div class="model-chips">
        <button
          v-for="sm in savedModels"
          :key="sm.id"
          class="model-chip"
          :class="{ active: agentForm.model.provider === sm.provider && agentForm.model.modelId === sm.modelId }"
          @click="selectModelForAgent(sm)"
        >
          {{ sm.name }}
        </button>
        <button
          class="model-chip"
          :class="{ active: showCustomModel }"
          @click="clearModelSelection"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 12px; height: 12px;">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          自定义
        </button>
      </div>
    </div>

    <div v-if="showCustomModel || savedModels.length === 0" class="custom-model-fields">
      <div class="form-row">
        <label>Provider</label>
        <input v-model="agentForm.model.provider" class="input-field" placeholder="anthropic" />
      </div>
      <div class="form-row">
        <label>模型</label>
        <input v-model="agentForm.model.modelId" class="input-field" placeholder="claude-sonnet-4-20250514" />
      </div>
    </div>
    <div class="agent-form-actions">
      <button class="btn-secondary" @click="emit('cancel')">取消</button>
      <button class="btn-primary" :disabled="!agentForm.id || !agentForm.name" @click="handleSubmit">
        {{ editingAgent ? '保存修改' : '确认添加' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.agent-form {
  padding: 16px;
  margin-bottom: 12px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.form-row label {
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 500;
}

.form-label {
  display: block;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.model-selection {
  margin-bottom: 12px;
}

.model-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.model-chip {
  padding: 5px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid var(--color-border-subtle);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.model-chip:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--color-border-hover);
}

.model-chip.active {
  background: rgba(99, 102, 241, 0.15);
  border-color: rgba(99, 102, 241, 0.3);
  color: var(--color-accent-light);
}

.agent-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
</style>
