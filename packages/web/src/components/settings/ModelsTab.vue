<script setup lang="ts">
import { reactive, ref, computed } from "vue";
import { MessagePlugin } from "tdesign-vue-next";
import CustomSelect from "../common/CustomSelect.vue";
import type { SavedModel, ModelInfo, ApiProtocol, ProviderConfig } from "../../types/index.js";
import * as configApi from "../../api/config.js";

const props = defineProps<{
  models: SavedModel[];
  providerIds: string[];
}>();

const emit = defineEmits<{
  (e: "add", model: SavedModel): void;
  (e: "remove", index: number): void;
}>();

const showModelForm = ref(false);
const modelForm = reactive<SavedModel>({ id: "", name: "", provider: "", modelId: "" });
const modelProviderOptions = computed(() => props.providerIds);
const availableModels = ref<ModelInfo[]>([]);
const loadingModels = ref(false);
const testingMap = reactive<Record<string, boolean>>({});
const testResultMap = reactive<Record<string, { ok: boolean; message: string }>>({});

async function loadModelsForProvider(providerId: string) {
  if (!providerId) {
    availableModels.value = [];
    return;
  }
  loadingModels.value = true;
  try {
    const res = await configApi.listModels(providerId);
    availableModels.value = res.data ?? [];
  } catch {
    availableModels.value = [];
  } finally {
    loadingModels.value = false;
  }
}

function onModelFormProviderChange() {
  modelForm.modelId = "";
  loadModelsForProvider(modelForm.provider);
}

function onModelSelect(m: ModelInfo) {
  modelForm.modelId = m.id;
  if (!modelForm.name) modelForm.name = m.name;
  if (!modelForm.id) modelForm.id = m.id;
}

function addModel() {
  if (!modelForm.id || !modelForm.name || !modelForm.provider || !modelForm.modelId) return;
  emit("add", { ...modelForm });
  modelForm.id = "";
  modelForm.name = "";
  modelForm.provider = "";
  modelForm.modelId = "";
  availableModels.value = [];
  showModelForm.value = false;
}

function getProviderOverride(providerId: string) {
  // This is a simplified version — the parent SettingsView manages provider state
  return undefined;
}

function modelTestKey(provider: string, modelId: string): string {
  return `${provider}::${modelId}`;
}

async function testModel(provider: string, modelId: string) {
  const p = provider.trim();
  const m = modelId.trim();
  if (!p || !m) {
    MessagePlugin.warning("请先填写 provider 和 modelId");
    return;
  }

  const key = modelTestKey(p, m);
  testingMap[key] = true;
  delete testResultMap[key];

  try {
    const res = await configApi.testModelConnection({
      provider: p,
      modelId: m,
      prompt: "请只回复：OK",
      timeoutMs: 20000,
    });

    const result = res.data;
    const message = result.ok
      ? `成功（${result.durationMs}ms）${result.text ? `：${result.text}` : ""}`
      : `失败（${result.durationMs}ms）：${result.error ?? "未知错误"}`;
    testResultMap[key] = { ok: result.ok, message };

    if (result.ok) {
      MessagePlugin.success(`${p}/${m} 测试成功`);
    } else {
      MessagePlugin.error(`${p}/${m} 测试失败：${result.error ?? "未知错误"}`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误";
    testResultMap[key] = { ok: false, message: `失败：${msg}` };
    MessagePlugin.error(`测试失败：${msg}`);
  } finally {
    testingMap[key] = false;
  }
}
</script>

<template>
  <div>
    <div class="content-header">
      <h3>模型管理</h3>
      <p>添加自定义模型，方便在配置 Swarm 时快速选择</p>
    </div>

    <div class="models-toolbar">
      <button class="btn-primary" @click="showModelForm = !showModelForm">
        <svg v-if="!showModelForm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
        {{ showModelForm ? '取消' : '添加模型' }}
      </button>
    </div>

    <div v-if="showModelForm" class="model-form card">
      <div class="form-row">
        <label>ID</label>
        <input v-model="modelForm.id" class="input-field" placeholder="my-model" />
      </div>
      <div class="form-row">
        <label>显示名称</label>
        <input v-model="modelForm.name" class="input-field" placeholder="My Model" />
      </div>
      <div class="form-row">
        <label>提供商</label>
        <CustomSelect
          :model-value="modelForm.provider"
          :options="[{ value: '', label: '选择提供商' }, ...modelProviderOptions.map(p => ({ value: p, label: p }))]"
          placeholder="选择提供商"
          @update:model-value="modelForm.provider = $event; onModelFormProviderChange()"
        />
      </div>
      <div class="form-row">
        <label>模型 ID</label>
        <input v-model="modelForm.modelId" class="input-field" placeholder="输入模型 ID 或从下方列表选择" />
      </div>
      <div v-if="loadingModels" class="model-list-hint">加载模型列表中...</div>
      <div v-else-if="modelForm.provider && availableModels.length" class="model-picker">
        <div class="model-picker-label">从 {{ modelForm.provider }} 选择模型：</div>
        <div class="model-picker-list">
          <button
            v-for="m in availableModels"
            :key="m.id"
            class="model-pick-item"
            :class="{ active: modelForm.modelId === m.id }"
            @click="onModelSelect(m)"
          >
            <span class="model-pick-id">{{ m.id }}</span>
            <span class="model-pick-meta">{{ m.contextWindow / 1000 }}k ctx</span>
          </button>
        </div>
      </div>
      <div v-else-if="modelForm.provider && !loadingModels && availableModels.length === 0" class="model-list-hint">
        该提供商暂无内置模型列表，请手动输入模型 ID
      </div>
      <button class="btn-primary" :disabled="!modelForm.id || !modelForm.name || !modelForm.provider || !modelForm.modelId" @click="addModel">
        确认添加
      </button>
    </div>

    <div v-if="models.length" class="models-list">
      <div v-for="(model, i) in models" :key="model.id" class="model-item card">
        <div class="model-main">
          <div class="model-avatar">{{ model.name.charAt(0).toUpperCase() }}</div>
          <div class="model-info">
            <span class="model-name">{{ model.name }}</span>
            <span class="model-meta">{{ model.provider }} / {{ model.modelId }}</span>
            <span
              v-if="testResultMap[modelTestKey(model.provider, model.modelId)]"
              class="test-result-text"
              :class="{ ok: testResultMap[modelTestKey(model.provider, model.modelId)].ok, fail: !testResultMap[modelTestKey(model.provider, model.modelId)].ok }"
            >
              {{ testResultMap[modelTestKey(model.provider, model.modelId)].message }}
            </span>
          </div>
        </div>
        <div class="model-actions">
          <button
            class="btn-secondary model-test-btn"
            :disabled="testingMap[modelTestKey(model.provider, model.modelId)]"
            @click="testModel(model.provider, model.modelId)"
          >
            {{ testingMap[modelTestKey(model.provider, model.modelId)] ? "测试中..." : "测试" }}
          </button>
          <button class="remove-btn" @click="emit('remove', i)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      <div class="empty-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
      </div>
      <p class="empty-title">暂无自定义模型</p>
      <p class="empty-desc">添加模型后在配置 Swarm 时可快速选择</p>
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
.models-toolbar {
  margin-bottom: 16px;
}
.model-form {
  padding: 20px;
  margin-bottom: 16px;
}
.model-form .form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}
.model-form .form-row label {
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 500;
}
.models-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.model-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
}
.model-main {
  display: flex;
  align-items: center;
  gap: 12px;
}
.model-avatar {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(139, 92, 246, 0.15));
  border-radius: 10px;
  font-size: 14px;
  font-weight: 700;
  color: var(--color-accent-light);
}
.model-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.model-name {
  color: var(--color-text-primary);
  font-size: 14px;
  font-weight: 600;
}
.model-meta {
  color: var(--color-text-muted);
  font-size: 12px;
  font-family: var(--font-mono);
}
.model-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.model-test-btn {
  padding: 6px 10px;
  font-size: 12px;
}
.model-list-hint {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-bottom: 12px;
}
.model-picker {
  margin-bottom: 12px;
}
.model-picker-label {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-bottom: 6px;
}
.model-picker-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 200px;
  overflow-y: auto;
  padding: 4px 0;
}
.model-pick-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid var(--color-border-subtle);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.model-pick-item:hover {
  background: rgba(99, 102, 241, 0.08);
  border-color: var(--color-border-hover);
}
.model-pick-item.active {
  background: rgba(99, 102, 241, 0.15);
  border-color: rgba(99, 102, 241, 0.4);
  color: var(--color-accent-light);
}
.model-pick-id {
  font-family: var(--font-mono);
  font-size: 11px;
}
.model-pick-meta {
  font-size: 10px;
  color: var(--color-text-muted);
}
.test-result-text {
  font-size: 12px;
  line-height: 1.4;
}
.test-result-text.ok {
  color: #22c55e;
}
.test-result-text.fail {
  color: #f87171;
}
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 60px 0;
  color: var(--color-text-muted);
}
.empty-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 14px;
  border: 1px solid var(--color-border-subtle);
  margin-bottom: 14px;
}
.empty-icon svg {
  width: 24px;
  height: 24px;
}
.empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin: 0 0 4px;
}
.empty-desc {
  font-size: 13px;
  margin: 0;
}
</style>
