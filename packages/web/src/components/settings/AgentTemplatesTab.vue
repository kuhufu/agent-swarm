<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { MessagePlugin } from "tdesign-vue-next";
import { useAgentStore } from "../../stores/agents.js";
import type { PresetAgent, SavedModel } from "../../types/index.js";
import { showError } from "../../utils/ui-feedback.js";

interface TemplateFormState {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  category: string;
  tagsText: string;
  modelProvider: string;
  modelId: string;
}

const props = defineProps<{
  savedModels: SavedModel[];
}>();

const agentStore = useAgentStore();
const selectedTemplateId = ref<string | null>(null);
const submitting = ref(false);
const openActionMenuId = ref<string | null>(null);
const actionMenuPosition = ref<{ left: number; top: number } | null>(null);

const form = reactive<TemplateFormState>({
  id: "",
  name: "",
  description: "",
  systemPrompt: "",
  category: "",
  tagsText: "",
  modelProvider: "",
  modelId: "",
});

const selectedTemplate = computed<PresetAgent | null>(() => {
  if (!selectedTemplateId.value) return null;
  return agentStore.sortedTemplates.find((item) => item.id === selectedTemplateId.value) ?? null;
});
const openActionTemplate = computed(() =>
  openActionMenuId.value
    ? agentStore.sortedTemplates.find((item) => item.id === openActionMenuId.value) ?? null
    : null,
);
const isEditing = computed(() => Boolean(selectedTemplate.value));
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
const hasTemplateChanges = computed(() => {
  const template = selectedTemplate.value;
  if (!template) return true;
  const payload = formPayload.value;
  return payload.name !== template.name
    || payload.description !== template.description
    || payload.systemPrompt !== template.systemPrompt
    || payload.category !== template.category
    || payload.model.provider !== template.model.provider
    || payload.model.modelId !== template.model.modelId
    || payload.tags.join("\u0000") !== template.tags.join("\u0000");
});
const canSubmit = computed(() => {
  if (submitting.value || !form.name.trim()) return false;
  if (!isEditing.value) return Boolean(form.id.trim());
  return hasTemplateChanges.value;
});

function normalizeTemplateId(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseTags(input: string): string[] {
  if (!input.trim()) return [];
  return Array.from(new Set(
    input
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  ));
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

function fillFormFromTemplate(template: PresetAgent) {
  form.id = template.id;
  form.name = template.name;
  form.description = template.description;
  form.systemPrompt = template.systemPrompt;
  form.category = template.category;
  form.tagsText = template.tags.join(", ");
  form.modelProvider = template.model.provider;
  form.modelId = template.model.modelId;
}

function startCreateTemplate() {
  selectedTemplateId.value = null;
  closeActionMenu();
  resetForm();
}

function copyTemplate(template: PresetAgent) {
  selectedTemplateId.value = null;
  closeActionMenu();
  fillFormFromTemplate(template);
  form.id = "";
}

function selectSavedModel(model: SavedModel) {
  form.modelProvider = model.provider;
  form.modelId = model.modelId;
}

async function submitForm() {
  if (submitting.value) return;
  if (!form.name.trim()) {
    showError("模板名称不能为空");
    return;
  }

  if (isEditing.value && !hasTemplateChanges.value) return;

  const payload = formPayload.value;

  submitting.value = true;
  try {
    if (isEditing.value && selectedTemplate.value) {
      const updated = await agentStore.updateTemplate(selectedTemplate.value.id, payload);
      selectedTemplateId.value = updated.id;
      fillFormFromTemplate(updated);
      MessagePlugin.success("系统模板已保存");
      return;
    }

    const normalizedId = normalizeTemplateId(form.id);
    if (!normalizedId) {
      showError("请填写合法 ID（字母/数字/-/_）");
      return;
    }

    const created = await agentStore.createTemplate({
      id: normalizedId,
      ...payload,
    });
    selectedTemplateId.value = created.id;
    fillFormFromTemplate(created);
    MessagePlugin.success("系统模板已创建");
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存失败";
    showError(message);
  } finally {
    submitting.value = false;
  }
}

async function handleDeleteTemplate(template: PresetAgent) {
  if (submitting.value) return;
  closeActionMenu();
  submitting.value = true;
  try {
    const deletedId = template.id;
    await agentStore.deleteTemplate(deletedId);
    if (selectedTemplateId.value === deletedId) {
      const next = agentStore.sortedTemplates.find((item) => item.id !== deletedId) ?? null;
      if (!next) {
        startCreateTemplate();
      } else {
        selectedTemplateId.value = next.id;
        fillFormFromTemplate(next);
      }
    }
    MessagePlugin.success("系统模板已删除");
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除失败";
    showError(message);
  } finally {
    submitting.value = false;
  }
}

function closeActionMenu() {
  openActionMenuId.value = null;
  actionMenuPosition.value = null;
}

function computeActionMenuPosition(anchor: Element): { left: number; top: number } {
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

function toggleActionMenu(event: MouseEvent, templateId: string) {
  const target = event.currentTarget;
  if (!(target instanceof Element)) return;
  if (openActionMenuId.value === templateId) {
    closeActionMenu();
    return;
  }
  openActionMenuId.value = templateId;
  actionMenuPosition.value = computeActionMenuPosition(target);
}

function handleGlobalClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Element)) {
    closeActionMenu();
    return;
  }
  if (target.closest(".template-action-trigger") || target.closest(".template-action-menu-floating")) {
    return;
  }
  closeActionMenu();
}

function handleWindowChange() {
  if (openActionMenuId.value) closeActionMenu();
}

watch(selectedTemplate, (template) => {
  if (!template) {
    if (selectedTemplateId.value) startCreateTemplate();
    return;
  }
  fillFormFromTemplate(template);
}, { immediate: true });

onMounted(async () => {
  window.addEventListener("click", handleGlobalClick);
  window.addEventListener("resize", handleWindowChange);
  window.addEventListener("scroll", handleWindowChange, true);
  await agentStore.fetchAgents();
  if (!selectedTemplateId.value && agentStore.sortedTemplates.length > 0) {
    selectedTemplateId.value = agentStore.sortedTemplates[0].id;
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("click", handleGlobalClick);
  window.removeEventListener("resize", handleWindowChange);
  window.removeEventListener("scroll", handleWindowChange, true);
});
</script>

<template>
  <div class="templates-manager">
    <aside class="templates-list card">
      <div class="templates-list-header">
        <div>
          <h4>系统模板</h4>
          <p>{{ agentStore.sortedTemplates.length }} 个共享模板</p>
        </div>
        <button class="btn-primary compact-btn" @click="startCreateTemplate">
          新建模板
        </button>
      </div>

      <div class="template-items">
        <div
          v-for="template in agentStore.sortedTemplates"
          :key="template.id"
          class="template-item-row"
          :class="{
            active: selectedTemplateId === template.id,
            'menu-open': openActionMenuId === template.id,
          }"
        >
          <button
            class="template-item"
            @click="selectedTemplateId = template.id; openActionMenuId = null"
          >
            <span class="template-name">{{ template.name }}</span>
            <span class="template-meta">{{ template.category || "未分类" }} · {{ template.id }}</span>
          </button>
          <div class="template-actions">
            <button
              class="template-action-trigger"
              aria-label="打开模板操作"
              @click.stop="toggleActionMenu($event, template.id)"
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="19" cy="12" r="1.8" />
              </svg>
            </button>
          </div>
        </div>
        <div v-if="!agentStore.sortedTemplates.length" class="empty-state">
          暂无系统模板，创建后用户可在 Agent 预设页从模板导入。
        </div>
      </div>
    </aside>

    <section class="template-editor card">
      <div class="editor-header">
        <div>
          <h4>{{ isEditing ? "编辑系统模板" : "创建系统模板" }}</h4>
          <p>系统模板是跨用户共享的 Agent 模版，供用户导入为自己的预设。</p>
        </div>
        <div class="editor-actions">
          <button
            class="btn-primary"
            :disabled="!canSubmit"
            @click="submitForm"
          >
            {{ isEditing ? "保存模板" : "创建模板" }}
          </button>
        </div>
      </div>

      <div class="form-grid">
        <div class="form-row">
          <label>ID</label>
          <input
            v-model="form.id"
            class="input-field"
            placeholder="system-code-reviewer"
            :disabled="isEditing"
          />
        </div>
        <div class="form-row">
          <label>名称</label>
          <input v-model="form.name" class="input-field" placeholder="代码审查 Agent" />
        </div>
        <div class="form-row">
          <label>分类</label>
          <input v-model="form.category" class="input-field" placeholder="开发 / 数据 / 安全" />
        </div>
        <div class="form-row">
          <label>标签（逗号分隔）</label>
          <input v-model="form.tagsText" class="input-field" placeholder="代码审查, 质量" />
        </div>
      </div>

      <div class="form-row">
        <label>描述</label>
        <input v-model="form.description" class="input-field" placeholder="这个模板适合做什么" />
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

      <div v-if="props.savedModels.length > 0" class="form-row">
        <label>快速选择模型</label>
        <div class="model-chips">
          <button
            v-for="model in props.savedModels"
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
          <input v-model="form.modelProvider" class="input-field" placeholder="openai" />
        </div>
        <div class="form-row">
          <label>Model ID</label>
          <input v-model="form.modelId" class="input-field" placeholder="gpt-4o-mini" />
        </div>
      </div>
    </section>

    <teleport to="body">
      <div
        v-if="openActionTemplate && actionMenuPosition"
        class="template-action-menu-floating"
        :style="{ left: `${actionMenuPosition.left}px`, top: `${actionMenuPosition.top}px` }"
        @click.stop
      >
        <button
          class="template-action-item"
          @click="copyTemplate(openActionTemplate)"
        >
          复制模版
        </button>
        <button
          class="template-action-danger"
          :disabled="submitting"
          @click="handleDeleteTemplate(openActionTemplate)"
        >
          删除
        </button>
      </div>
    </teleport>
  </div>
</template>

<style scoped>
.templates-manager {
  display: grid;
  grid-template-columns: minmax(240px, 300px) minmax(0, 1fr);
  gap: 16px;
  min-height: 0;
}

/* ── Panel shells ── */
.templates-list,
.template-editor {
  border: 1px solid var(--color-border-subtle);
  border-radius: 16px;
  background: var(--glass-bg);
  backdrop-filter: blur(20px) saturate(1.3);
}

.templates-list {
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ── Headers ── */
.templates-list-header,
.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--color-border-subtle);
  background: rgba(255, 255, 255, 0.015);
}

.templates-list-header h4,
.editor-header h4 {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.3px;
}

.templates-list-header p,
.editor-header p {
  margin: 4px 0 0;
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

/* ── List ── */
.template-items {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px;
  overflow-y: auto;
}

.template-item-row {
  position: relative;
  width: 100%;
  border: 1px solid var(--color-border-subtle);
  border-left: 3px solid rgba(99, 102, 241, 0.25);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text-secondary);
  transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
  display: grid;
  grid-template-columns: minmax(0, 1fr) 30px;
  align-items: center;
  gap: 4px;
}

.template-item {
  min-width: 0;
  border: none;
  padding: 10px 8px 10px 12px;
  text-align: left;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.template-item-row:hover {
  border-color: var(--color-border-hover);
  border-left-color: rgba(99, 102, 241, 0.5);
  background: rgba(255, 255, 255, 0.05);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.14);
}

.template-item-row.active {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.3);
  border-left-color: var(--color-accent);
  color: var(--color-accent-light);
  box-shadow: 0 2px 12px rgba(99, 102, 241, 0.15);
}

.template-name {
  font-size: 13px;
  font-weight: 600;
}

.template-meta {
  color: var(--color-text-muted);
  font-size: 11px;
}

/* ── Row action trigger ── */
.template-actions {
  position: relative;
  padding-right: 6px;
  display: flex;
  justify-content: center;
}

.template-action-trigger {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  pointer-events: none;
  transition: all 0.15s;
}

.template-item-row:hover .template-action-trigger,
.template-item-row.active .template-action-trigger,
.template-item-row.menu-open .template-action-trigger {
  opacity: 1;
  pointer-events: auto;
}

.template-action-trigger:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-primary);
}

.template-action-trigger svg {
  width: 15px;
  height: 15px;
}

/* ── Floating action menu ── */
.template-action-menu-floating {
  position: fixed;
  z-index: 3000;
  min-width: 136px;
  padding: 4px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 12px;
  background: var(--color-surface-2);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35), 0 2px 8px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(16px) saturate(1.3);
}

.template-action-item,
.template-action-danger {
  width: 100%;
  border: none;
  border-radius: 7px;
  padding: 8px 12px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
  transition: background 0.15s;
}

.template-action-item {
  color: var(--color-text-secondary);
}

.template-action-item:hover {
  background: rgba(255, 255, 255, 0.07);
  color: var(--color-text-primary);
}

.template-action-danger {
  color: var(--color-danger);
}

.template-action-danger:hover {
  background: rgba(239, 68, 68, 0.1);
}

.template-action-danger:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

/* ── Empty state ── */
.empty-state {
  padding: 32px 16px;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.7;
}

/* ── Editor panel ── */
.template-editor {
  min-width: 0;
  padding-bottom: 16px;
  overflow-y: auto;
}

.editor-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

/* ── Form ── */
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 0 18px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 14px 18px;
}

.form-grid .form-row {
  margin: 14px 0 0;
}

.form-row label {
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.form-row :deep(.input-field:disabled),
.input-field:disabled {
  border-color: var(--color-border-subtle);
  border-style: dashed;
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text-muted);
  cursor: not-allowed;
  box-shadow: none;
  opacity: 0.7;
}

.form-row :deep(.input-field:disabled)::placeholder,
.input-field:disabled::placeholder {
  color: var(--color-text-muted);
  opacity: 0.6;
}

.form-row:has(.input-field:disabled) label {
  color: var(--color-text-muted);
}

/* ── Model chips ── */
.model-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.model-chip {
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.18s;
}

.model-chip:hover {
  border-color: var(--color-border-hover);
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-primary);
}

.model-chip.active {
  border-color: rgba(99, 102, 241, 0.4);
  background: rgba(99, 102, 241, 0.12);
  color: var(--color-accent-light);
}

.compact-btn {
  padding: 6px 14px;
  font-size: 13px;
}

@media (max-width: 900px) {
  .templates-manager {
    grid-template-columns: 1fr;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }

  .editor-header {
    flex-direction: column;
  }
}
</style>
