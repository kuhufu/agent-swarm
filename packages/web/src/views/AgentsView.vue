<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useAgentStore } from "../stores/agents.js";
import { useSettingsStore } from "../stores/settings.js";
import type { PresetAgent, SavedModel } from "../types/index.js";
import { confirmDialog, showError } from "../utils/ui-feedback.js";

interface AgentFormState {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  category: string;
  tagsText: string;
  modelProvider: string;
  modelId: string;
}

const agentStore = useAgentStore();
const settingsStore = useSettingsStore();

const selectedPresetId = ref<string | null>(null);
const submitting = ref(false);

const form = reactive<AgentFormState>({
  id: "",
  name: "",
  description: "",
  systemPrompt: "",
  category: "",
  tagsText: "",
  modelProvider: "",
  modelId: "",
});

const savedModels = computed<SavedModel[]>(() => settingsStore.config?.models ?? []);
const selectedPreset = computed<PresetAgent | null>(() =>
  selectedPresetId.value
    ? agentStore.sortedPresets.find((item) => item.id === selectedPresetId.value) ?? null
    : null
);
const isEditing = computed(() => Boolean(selectedPreset.value));
const canDelete = computed(() => isEditing.value && selectedPreset.value?.builtIn !== true);

function resetForm() {
  form.id = "";
  form.name = "";
  form.description = "";
  form.systemPrompt = "";
  form.category = "";
  form.tagsText = "";
  form.modelProvider = "";
  form.modelId = "";
}

function fillFormFromPreset(preset: PresetAgent) {
  form.id = preset.id;
  form.name = preset.name;
  form.description = preset.description;
  form.systemPrompt = preset.systemPrompt;
  form.category = preset.category;
  form.tagsText = preset.tags.join(", ");
  form.modelProvider = preset.model.provider;
  form.modelId = preset.model.modelId;
}

function normalizePresetId(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized;
}

function parseTags(input: string): string[] {
  if (!input.trim()) {
    return [];
  }
  const tags = input
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return Array.from(new Set(tags));
}

function selectSavedModel(model: SavedModel) {
  form.modelProvider = model.provider;
  form.modelId = model.modelId;
}

function startCreatePreset() {
  selectedPresetId.value = null;
  resetForm();
}

async function submitForm() {
  if (submitting.value) {
    return;
  }
  if (!form.name.trim()) {
    showError("名称不能为空");
    return;
  }

  const tags = parseTags(form.tagsText);
  const payload = {
    name: form.name.trim(),
    description: form.description.trim(),
    systemPrompt: form.systemPrompt.trim(),
    model: {
      provider: form.modelProvider.trim(),
      modelId: form.modelId.trim(),
    },
    category: form.category.trim(),
    tags,
  };

  submitting.value = true;
  try {
    if (selectedPreset.value) {
      const updated = await agentStore.updateAgent(selectedPreset.value.id, payload);
      selectedPresetId.value = updated.id;
      fillFormFromPreset(updated);
      return;
    }

    const normalizedId = normalizePresetId(form.id);
    if (!normalizedId) {
      showError("请填写合法 ID（字母/数字/-/_）");
      return;
    }

    const created = await agentStore.createAgent({
      id: normalizedId,
      ...payload,
    });
    selectedPresetId.value = created.id;
    fillFormFromPreset(created);
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存失败";
    showError(message);
  } finally {
    submitting.value = false;
  }
}

async function handleDeletePreset() {
  if (!selectedPreset.value || selectedPreset.value.builtIn) {
    return;
  }
  const confirmed = await confirmDialog({
    header: "删除 Agent 预设",
    body: `确认删除预设 "${selectedPreset.value.name}" 吗？`,
    confirmText: "删除",
    cancelText: "取消",
    theme: "danger",
  });
  if (!confirmed) {
    return;
  }

  try {
    const deletedId = selectedPreset.value.id;
    await agentStore.deleteAgent(deletedId);
    const next = agentStore.sortedPresets.find((item) => item.id !== deletedId) ?? null;
    if (next) {
      selectedPresetId.value = next.id;
      fillFormFromPreset(next);
    } else {
      startCreatePreset();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除失败";
    showError(message);
  }
}

watch(selectedPreset, (preset) => {
  if (!preset) {
    if (selectedPresetId.value) {
      startCreatePreset();
    }
    return;
  }
  fillFormFromPreset(preset);
}, { immediate: true });

onMounted(async () => {
  await Promise.all([
    agentStore.fetchAgents(),
    settingsStore.fetchConfig().catch(() => {}),
  ]);
  if (!selectedPresetId.value && agentStore.sortedPresets.length > 0) {
    selectedPresetId.value = agentStore.sortedPresets[0].id;
  }
});
</script>

<template>
  <div class="agents-view">
    <div class="agents-layout">
      <aside class="agents-sidebar">
        <div class="sidebar-header">
          <h2>Agent 预设</h2>
          <p>管理可复用的 Agent 模板</p>
        </div>

        <button class="btn-primary create-btn" @click="startCreatePreset">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          新建预设
        </button>

        <div class="preset-section">
          <div class="preset-section-title">内置预设</div>
          <button
            v-for="preset in agentStore.builtInPresets"
            :key="preset.id"
            class="preset-item"
            :class="{ active: selectedPresetId === preset.id }"
            @click="selectedPresetId = preset.id"
          >
            <span class="preset-name">{{ preset.name }}</span>
            <span class="preset-meta">{{ preset.category || "未分类" }}</span>
          </button>
          <div v-if="!agentStore.builtInPresets.length" class="preset-empty">暂无内置预设</div>
        </div>

        <div class="preset-section">
          <div class="preset-section-title">自定义预设</div>
          <button
            v-for="preset in agentStore.customPresets"
            :key="preset.id"
            class="preset-item"
            :class="{ active: selectedPresetId === preset.id }"
            @click="selectedPresetId = preset.id"
          >
            <span class="preset-name">{{ preset.name }}</span>
            <span class="preset-meta">{{ preset.category || "未分类" }}</span>
          </button>
          <div v-if="!agentStore.customPresets.length" class="preset-empty">暂无自定义预设</div>
        </div>
      </aside>

      <main class="agents-content">
        <div class="detail-card">
          <div class="detail-header">
            <div>
              <h3>{{ isEditing ? "编辑 Agent 预设" : "创建 Agent 预设" }}</h3>
              <p v-if="isEditing" class="detail-hint">已创建预设的 ID 固定不可修改。</p>
            </div>
            <div class="header-actions">
              <button
                v-if="canDelete"
                class="btn-danger"
                :disabled="submitting"
                @click="handleDeletePreset"
              >
                删除
              </button>
              <button
                class="btn-primary"
                :disabled="submitting || !form.name.trim() || (!isEditing && !form.id.trim())"
                @click="submitForm"
              >
                {{ isEditing ? "保存修改" : "创建预设" }}
              </button>
            </div>
          </div>

          <div class="form-grid">
            <div class="form-row">
              <label>ID</label>
              <input
                v-model="form.id"
                class="input-field"
                placeholder="example-agent"
                :disabled="isEditing"
              />
            </div>
            <div class="form-row">
              <label>名称</label>
              <input
                v-model="form.name"
                class="input-field"
                placeholder="示例 Agent"
              />
            </div>
            <div class="form-row">
              <label>分类</label>
              <input
                v-model="form.category"
                class="input-field"
                placeholder="开发 / 数据 / 安全"
              />
            </div>
            <div class="form-row">
              <label>标签（逗号分隔）</label>
              <input
                v-model="form.tagsText"
                class="input-field"
                placeholder="代码审查, 质量, 最佳实践"
              />
            </div>
          </div>

          <div class="form-row">
            <label>描述</label>
            <input
              v-model="form.description"
              class="input-field"
              placeholder="这个预设适合做什么"
            />
          </div>

          <div class="form-row">
            <label>System Prompt</label>
            <textarea
              v-model="form.systemPrompt"
              class="input-field"
              rows="8"
              placeholder="你是一位..."
            />
          </div>

          <div v-if="savedModels.length > 0" class="form-row">
            <label>快速选择模型</label>
            <div class="model-chips">
              <button
                v-for="model in savedModels"
                :key="model.id"
                class="model-chip"
                :class="{ active: form.modelProvider === model.provider && form.modelId === model.modelId }"
                @click="selectSavedModel(model)"
              >
                {{ model.name }}
              </button>
            </div>
          </div>

          <div class="form-grid">
            <div class="form-row">
              <label>Model Provider</label>
              <input
                v-model="form.modelProvider"
                class="input-field"
                placeholder="openai"
              />
            </div>
            <div class="form-row">
              <label>Model ID</label>
              <input
                v-model="form.modelId"
                class="input-field"
                placeholder="gpt-4o-mini"
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.agents-view {
  height: 100%;
}

.agents-layout {
  display: flex;
  height: 100%;
}

.agents-sidebar {
  width: 280px;
  border-right: 1px solid var(--color-border-subtle);
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(16px);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px 14px;
  overflow-y: auto;
  flex-shrink: 0;
}

.sidebar-header h2 {
  margin: 0 0 4px;
  color: var(--color-text-primary);
  font-size: 18px;
  font-weight: 700;
}

.sidebar-header p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 12px;
}

.create-btn {
  width: 100%;
}

.preset-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.preset-section-title {
  margin-top: 6px;
  padding: 0 4px;
  color: var(--color-text-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}

.preset-item {
  width: 100%;
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  padding: 10px 12px;
  text-align: left;
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.preset-item:hover {
  border-color: var(--color-border-hover);
  background: rgba(255, 255, 255, 0.05);
}

.preset-item.active {
  background: rgba(99, 102, 241, 0.12);
  border-color: rgba(99, 102, 241, 0.3);
  color: var(--color-accent-light);
}

.preset-name {
  font-size: 13px;
  font-weight: 600;
}

.preset-meta {
  font-size: 11px;
  color: var(--color-text-muted);
}

.preset-item.active .preset-meta {
  color: rgba(129, 140, 248, 0.8);
}

.preset-empty {
  padding: 10px 12px;
  color: var(--color-text-muted);
  font-size: 12px;
}

.agents-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 24px 28px;
}

.detail-card {
  max-width: 960px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(12px);
  padding: 20px;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
  margin-bottom: 16px;
}

.detail-header h3 {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 18px;
  font-weight: 700;
}

.detail-hint {
  margin: 6px 0 0;
  color: #fbbf24;
  font-size: 12px;
}

.header-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.form-row label {
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.model-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.model-chip {
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.model-chip:hover {
  border-color: var(--color-border-hover);
  background: rgba(255, 255, 255, 0.06);
}

.model-chip.active {
  border-color: rgba(99, 102, 241, 0.3);
  background: rgba(99, 102, 241, 0.14);
  color: var(--color-accent-light);
}

.model-chip:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

@media (max-width: 1024px) {
  .agents-layout {
    flex-direction: column;
  }

  .agents-sidebar {
    width: 100%;
    max-height: 280px;
    border-right: none;
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .agents-content {
    padding: 16px;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
