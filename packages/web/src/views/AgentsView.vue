<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useAgentStore } from "../stores/agents.js";
import { useSettingsStore } from "../stores/settings.js";
import type { PresetAgent, SavedModel } from "../types/index.js";
import { showError } from "../utils/ui-feedback.js";

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

type SelectionKind = "preset" | "template";

interface SelectedAgentRef {
  kind: SelectionKind;
  id: string;
}

const selectedRef = ref<SelectedAgentRef | null>(null);
const submitting = ref(false);
const showSystemTemplates = ref(false);
const openPresetActionMenuId = ref<string | null>(null);
const presetActionMenuPosition = ref<{ left: number; top: number } | null>(null);

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

const showTemplateSelect = ref(false);
const savedModels = computed<SavedModel[]>(() => settingsStore.models);

const selectedItem = computed<PresetAgent | null>(() => {
  if (!selectedRef.value) return null;
  const source = selectedRef.value.kind === "preset"
    ? agentStore.sortedPresets
    : agentStore.sortedTemplates;
  return source.find((item) => item.id === selectedRef.value?.id) ?? null;
});
const openPresetActionItem = computed(() =>
  openPresetActionMenuId.value
    ? agentStore.sortedPresets.find((item) => item.id === openPresetActionMenuId.value) ?? null
    : null,
);
const isTemplate = computed(() => selectedRef.value?.kind === "template");
const isEditing = computed(() => Boolean(selectedItem.value) && !isTemplate.value);
const formPayload = computed(() => ({
  name: form.name.trim(),
  description: form.description.trim(),
  systemPrompt: form.systemPrompt.trim(),
  model: {
    provider: form.modelProvider.trim(),
    modelId: form.modelId.trim(),
  },
  category: form.category.trim(),
  tags: parseTags(form.tagsText),
}));
const hasPresetChanges = computed(() => {
  if (!selectedItem.value || isTemplate.value) return true;
  const payload = formPayload.value;
  const preset = selectedItem.value;
  return payload.name !== preset.name
    || payload.description !== preset.description
    || payload.systemPrompt !== preset.systemPrompt
    || payload.category !== preset.category
    || payload.model.provider !== preset.model.provider
    || payload.model.modelId !== preset.model.modelId
    || payload.tags.join("\u0000") !== preset.tags.join("\u0000");
});
const canSubmit = computed(() => {
  if (submitting.value || isTemplate.value || !form.name.trim()) return false;
  if (!isEditing.value) return Boolean(form.id.trim());
  return hasPresetChanges.value;
});

function fillFromTemplate(template: PresetAgent) {
  form.id = "";
  form.name = template.name;
  form.description = template.description;
  form.systemPrompt = template.systemPrompt;
  form.category = template.category;
  form.tagsText = template.tags.join(", ");
  form.modelProvider = template.model.provider;
  form.modelId = template.model.modelId;
  showTemplateSelect.value = false;
  closePresetActionMenu();
  selectedRef.value = null; // switch to create mode
}

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
  selectedRef.value = null;
  closePresetActionMenu();
  resetForm();
}

function copyPreset(preset: PresetAgent) {
  selectedRef.value = null;
  closePresetActionMenu();
  fillFormFromPreset(preset);
  form.id = "";
}

function selectPreset(id: string) {
  selectedRef.value = { kind: "preset", id };
  closePresetActionMenu();
}

function selectTemplate(id: string) {
  selectedRef.value = { kind: "template", id };
  closePresetActionMenu();
}

async function submitForm() {
  if (submitting.value) {
    return;
  }
  if (!form.name.trim()) {
    showError("名称不能为空");
    return;
  }

  if (isEditing.value && !hasPresetChanges.value) return;

  const payload = formPayload.value;

  submitting.value = true;
  try {
    if (isEditing.value && selectedItem.value) {
      const updated = await agentStore.updateAgent(selectedItem.value.id, payload);
      selectedRef.value = { kind: "preset", id: updated.id };
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
    selectedRef.value = { kind: "preset", id: created.id };
    fillFormFromPreset(created);
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存失败";
    showError(message);
  } finally {
    submitting.value = false;
  }
}

async function handleDeletePreset(preset: PresetAgent) {
  if (submitting.value) return;
  closePresetActionMenu();
  submitting.value = true;
  try {
    const deletedId = preset.id;
    await agentStore.deleteAgent(deletedId);
    if (selectedRef.value?.kind === "preset" && selectedRef.value.id === deletedId) {
      const next = agentStore.sortedPresets.find((item) => item.id !== deletedId) ?? null;
      if (next) {
        selectedRef.value = { kind: "preset", id: next.id };
        fillFormFromPreset(next);
      } else {
        startCreatePreset();
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除失败";
    showError(message);
  } finally {
    submitting.value = false;
  }
}

function closePresetActionMenu() {
  openPresetActionMenuId.value = null;
  presetActionMenuPosition.value = null;
}

function computePresetActionMenuPosition(anchor: Element): { left: number; top: number } {
  const rect = anchor.getBoundingClientRect();
  const menuWidth = 128;
  const menuHeight = 72;
  const gap = 6;
  const viewportPadding = 8;
  const left = Math.min(
    Math.max(rect.left, viewportPadding),
    window.innerWidth - menuWidth - viewportPadding,
  );
  let top = rect.bottom + gap;
  if (top + menuHeight > window.innerHeight - viewportPadding) {
    top = Math.max(viewportPadding, rect.top - menuHeight - gap);
  }
  return { left, top };
}

function togglePresetActionMenu(event: MouseEvent, presetId: string) {
  const target = event.currentTarget;
  if (!(target instanceof Element)) return;
  if (openPresetActionMenuId.value === presetId) {
    closePresetActionMenu();
    return;
  }
  openPresetActionMenuId.value = presetId;
  presetActionMenuPosition.value = computePresetActionMenuPosition(target);
}

function handleGlobalClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Element)) {
    closePresetActionMenu();
    return;
  }
  if (target.closest(".preset-action-trigger") || target.closest(".preset-action-menu-floating")) {
    return;
  }
  closePresetActionMenu();
}

function handleWindowChange() {
  if (openPresetActionMenuId.value) closePresetActionMenu();
}

async function handleImportTemplate() {
  if (!selectedItem.value || !isTemplate.value || submitting.value) return;
  submitting.value = true;
  try {
    const imported = await agentStore.importTemplate(selectedItem.value.id);
    selectedRef.value = { kind: "preset", id: imported.id };
    fillFormFromPreset(imported);
  } catch (error) {
    const message = error instanceof Error ? error.message : "导入模板失败";
    showError(message);
  } finally {
    submitting.value = false;
  }
}

watch(selectedItem, (item) => {
  if (!item) {
    if (selectedRef.value) startCreatePreset();
    return;
  }
  fillFormFromPreset(item);
}, { immediate: true });

onMounted(async () => {
  window.addEventListener("click", handleGlobalClick);
  window.addEventListener("resize", handleWindowChange);
  window.addEventListener("scroll", handleWindowChange, true);
  await Promise.all([
    agentStore.fetchAgents(),
    settingsStore.fetchConfig().catch(() => {}),
  ]);
  if (!selectedRef.value && agentStore.sortedPresets.length > 0) {
    selectedRef.value = { kind: "preset", id: agentStore.sortedPresets[0].id };
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("click", handleGlobalClick);
  window.removeEventListener("resize", handleWindowChange);
  window.removeEventListener("scroll", handleWindowChange, true);
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

        <div class="sidebar-scrollable">
          <div class="preset-section">
            <button
              class="preset-section-toggle"
              @click="showSystemTemplates = !showSystemTemplates"
            >
              <span class="preset-section-title">系统模板</span>
              <span class="preset-section-toggle-meta">
                {{ agentStore.sortedTemplates.length }} 个
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  :class="{ expanded: showSystemTemplates }"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </button>
            <template v-if="showSystemTemplates">
              <button
                v-for="template in agentStore.sortedTemplates"
                :key="template.id"
                class="preset-item template-item"
                :class="{ active: selectedRef?.kind === 'template' && selectedRef.id === template.id }"
                @click="selectTemplate(template.id)"
              >
                <span class="preset-name">{{ template.name }}</span>
                <span class="preset-meta">{{ template.category || "未分类" }}</span>
              </button>
              <div v-if="!agentStore.sortedTemplates.length" class="preset-empty">暂无系统模板</div>
            </template>
          </div>

          <div class="preset-section">
            <div class="preset-section-title">我的预设</div>
            <div
              v-for="preset in agentStore.sortedPresets"
              :key="preset.id"
              class="preset-item-row"
              :class="{
                active: selectedRef?.kind === 'preset' && selectedRef.id === preset.id,
                'menu-open': openPresetActionMenuId === preset.id,
              }"
            >
              <button class="preset-item" @click="selectPreset(preset.id)">
                <span class="preset-name">{{ preset.name }}</span>
                <span class="preset-meta">{{ preset.category || "未分类" }}</span>
              </button>
              <div class="preset-actions">
                <button
                  class="preset-action-trigger"
                  aria-label="打开预设操作"
                  @click.stop="togglePresetActionMenu($event, preset.id)"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="5" cy="12" r="1.8" />
                    <circle cx="12" cy="12" r="1.8" />
                    <circle cx="19" cy="12" r="1.8" />
                  </svg>
                </button>
              </div>
            </div>
            <div v-if="!agentStore.sortedPresets.length" class="preset-empty">暂无自定义预设</div>
          </div>
        </div>
      </aside>

      <main class="agents-content">
        <div class="detail-card">
          <div class="detail-header">
            <div>
              <h3 v-if="isTemplate">系统模板：{{ selectedItem?.name }}</h3>
              <h3 v-else>{{ isEditing ? "编辑 Agent 预设" : "创建 Agent 预设" }}</h3>
              <p class="detail-hint" :class="{ info: isTemplate, muted: !isTemplate && !isEditing }">
                <template v-if="isTemplate">系统模板为只读，请点击“导入为我的预设”后编辑。</template>
                <template v-else-if="isEditing">已创建预设的 ID 固定不可修改。</template>
                <template v-else>填写基本信息后创建可复用的个人 Agent 预设。</template>
              </p>
            </div>
            <div class="header-actions">
              <div v-if="!isEditing && agentStore.sortedTemplates.length" class="template-select-inline">
                <button
                  class="btn-secondary"
                  :disabled="submitting"
                  @click="showTemplateSelect = !showTemplateSelect"
                >
                  从模板填充
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                <div v-if="showTemplateSelect" class="template-dropdown">
                  <button
                    v-for="t in agentStore.sortedTemplates"
                    :key="t.id"
                    class="template-dropdown-item"
                    @click="fillFromTemplate(t)"
                  >
                    <span class="dropdown-t-name">{{ t.name }}</span>
                    <span class="dropdown-t-cat">{{ t.category }}</span>
                  </button>
                </div>
              </div>
              <template v-if="isTemplate">
                <button
                  class="btn-primary"
                  :disabled="submitting"
                  @click="handleImportTemplate"
                >
                  导入为我的预设
                </button>
              </template>
              <template v-else>
                <button
                  class="btn-primary"
                  :disabled="!canSubmit"
                  @click="submitForm"
                >
                  {{ isEditing ? "保存修改" : "创建预设" }}
                </button>
              </template>
            </div>
          </div>

          <div class="form-grid">
            <div class="form-row">
              <label>ID</label>
              <input
                v-model="form.id"
                class="input-field"
                placeholder="example-agent"
                :disabled="isEditing || isTemplate"
              />
            </div>
            <div class="form-row">
              <label>名称</label>
              <input
                v-model="form.name"
                class="input-field"
                placeholder="示例 Agent"
                :disabled="isTemplate"
              />
            </div>
            <div class="form-row">
              <label>分类</label>
              <input
                v-model="form.category"
                class="input-field"
                placeholder="开发 / 数据 / 安全"
                :disabled="isTemplate"
              />
            </div>
            <div class="form-row">
              <label>标签（逗号分隔）</label>
              <input
                v-model="form.tagsText"
                class="input-field"
                placeholder="代码审查, 质量, 最佳实践"
                :disabled="isTemplate"
              />
            </div>
          </div>

          <div class="form-row">
            <label>描述</label>
            <input
              v-model="form.description"
              class="input-field"
              placeholder="这个预设适合做什么"
              :disabled="isTemplate"
            />
          </div>

          <div class="form-row">
            <label>System Prompt</label>
            <textarea
              v-model="form.systemPrompt"
              class="input-field"
              rows="8"
              placeholder="你是一位..."
              :disabled="isTemplate"
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
                :disabled="isTemplate"
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
                :disabled="isTemplate"
              />
            </div>
            <div class="form-row">
              <label>Model ID</label>
              <input
                v-model="form.modelId"
                class="input-field"
                placeholder="gpt-4o-mini"
                :disabled="isTemplate"
              />
            </div>
          </div>
        </div>
      </main>
    </div>

    <teleport to="body">
      <div
        v-if="openPresetActionItem && presetActionMenuPosition"
        class="preset-action-menu-floating"
        :style="{ left: `${presetActionMenuPosition.left}px`, top: `${presetActionMenuPosition.top}px` }"
        @click.stop
      >
        <button
          class="preset-action-item"
          @click="copyPreset(openPresetActionItem)"
        >
          复制预设
        </button>
        <button
          class="preset-action-danger"
          :disabled="submitting"
          @click="handleDeletePreset(openPresetActionItem)"
        >
          删除
        </button>
      </div>
    </teleport>
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
  flex-shrink: 0;
  min-height: 0;
}

.sidebar-scrollable {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sidebar-scrollable::-webkit-scrollbar {
  display: none;
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

.preset-section-toggle {
  width: 100%;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.preset-section-toggle .preset-section-title {
  margin-top: 6px;
}

.preset-section-toggle-meta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--color-text-muted);
  font-size: 11px;
}

.preset-section-toggle-meta svg {
  width: 12px;
  height: 12px;
  transition: transform 0.2s;
}

.preset-section-toggle-meta svg.expanded {
  transform: rotate(180deg);
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

.preset-item-row {
  position: relative;
  width: 100%;
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text-secondary);
  transition: all 0.2s;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 30px;
  align-items: center;
  gap: 4px;
}

.preset-item-row .preset-item {
  min-width: 0;
  border: none;
  padding: 10px 8px 10px 12px;
  background: transparent;
  color: inherit;
}

.preset-item-row:hover {
  border-color: var(--color-border-hover);
  background: rgba(255, 255, 255, 0.05);
}

.preset-item-row.active {
  background: rgba(99, 102, 241, 0.12);
  border-color: rgba(99, 102, 241, 0.3);
  color: var(--color-accent-light);
}

.preset-actions {
  position: relative;
  padding-right: 6px;
  display: flex;
  justify-content: center;
}

.preset-action-trigger {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  pointer-events: none;
}

.preset-item-row:hover .preset-action-trigger,
.preset-item-row.active .preset-action-trigger,
.preset-item-row.menu-open .preset-action-trigger {
  opacity: 1;
  pointer-events: auto;
}

.preset-action-trigger:hover {
  background: var(--btn-secondary-bg);
  color: var(--color-text-primary);
}

.preset-action-trigger svg {
  width: 16px;
  height: 16px;
}

.preset-action-menu-floating {
  position: fixed;
  z-index: 3000;
  min-width: 128px;
  padding: 4px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  background: var(--color-surface-2);
  box-shadow: var(--shadow-menu);
  backdrop-filter: blur(12px);
}

.preset-action-danger {
  width: 100%;
  border: none;
  border-radius: 6px;
  padding: 7px 10px;
  background: transparent;
  color: var(--color-danger);
  cursor: pointer;
  text-align: left;
  font-size: 12px;
}

.preset-action-item {
  width: 100%;
  border: none;
  border-radius: 6px;
  padding: 7px 10px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  text-align: left;
  font-size: 12px;
}

.preset-action-item:hover {
  background: var(--dropdown-hover);
  color: var(--color-text-primary);
}

.preset-action-danger:hover {
  background: var(--btn-danger-bg);
}

.preset-action-danger:disabled {
  cursor: not-allowed;
  opacity: 0.5;
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

.preset-item-row.active .preset-meta {
  color: rgba(129, 140, 248, 0.8);
}

.template-item {
  border-left: 3px solid rgba(99, 102, 241, 0.3);
}

.preset-empty {
  padding: 10px 12px;
  color: var(--color-text-muted);
  font-size: 12px;
}

/* ── Template selector ── */
.template-select-inline {
  position: relative;
}

.template-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 200px;
  max-height: 240px;
  overflow-y: auto;
  z-index: 50;
  background: var(--dropdown-bg);
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  backdrop-filter: blur(16px);
  box-shadow: var(--shadow-dropdown);
  padding: 4px;
}

.template-dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  color: var(--color-text-secondary);
}

.template-dropdown-item:hover {
  background: var(--dropdown-hover);
}

.dropdown-t-name {
  font-weight: 500;
}

.dropdown-t-cat {
  font-size: 11px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.detail-hint.info {
  color: var(--color-info);
}

.detail-hint.muted {
  color: var(--color-text-muted);
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

.form-row :deep(.input-field:disabled),
.input-field:disabled {
  border-color: var(--color-border-subtle);
  border-style: dashed;
  background: var(--btn-secondary-bg);
  color: var(--color-text-muted);
  cursor: not-allowed;
  box-shadow: none;
  opacity: 0.78;
}

.form-row :deep(.input-field:disabled)::placeholder,
.input-field:disabled::placeholder {
  color: var(--color-text-muted);
  opacity: 0.7;
}

.form-row:has(.input-field:disabled) label {
  color: var(--color-text-muted);
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
  border-color: var(--color-border-subtle);
  border-style: dashed;
  background: var(--btn-secondary-bg);
  color: var(--color-text-muted);
  cursor: not-allowed;
  opacity: 0.78;
}

.model-chip:disabled.active {
  border-color: var(--color-accent);
  background: var(--badge-bg);
  color: var(--color-accent-light);
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
