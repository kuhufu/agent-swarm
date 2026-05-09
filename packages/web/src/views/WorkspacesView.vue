<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import WorkspaceArtifactsPanel from "../components/chat/WorkspaceArtifactsPanel.vue";
import SvgIcon from "../components/common/SvgIcon.vue";
import { archiveWorkspace, createWorkspace, deleteWorkspace, listWorkspaces, updateWorkspace } from "../api/workspaces.js";
import type { WorkspaceInfo } from "../types/index.js";
import { formatTimeLong } from "../utils/format.js";
import { confirmDialog, showError, showSuccess } from "../utils/ui-feedback.js";

const workspaces = ref<WorkspaceInfo[]>([]);
const selectedWorkspaceId = ref<string | null>(null);
const loading = ref(false);
const includeArchived = ref(false);
const draftName = ref("");
const draftDescription = ref("");
const saving = ref(false);
const editingId = ref<string | null>(null);
const editName = ref("");
const editDescription = ref("");

const visibleWorkspaces = computed(() =>
  workspaces.value.filter((workspace) => includeArchived.value || !workspace.archivedAt),
);
const selectedWorkspace = computed(() =>
  selectedWorkspaceId.value
    ? workspaces.value.find((workspace) => workspace.id === selectedWorkspaceId.value) ?? null
    : null,
);

onMounted(() => {
  void loadWorkspaces();
});

async function loadWorkspaces() {
  loading.value = true;
  try {
    const response = await listWorkspaces(includeArchived.value);
    workspaces.value = response.data ?? [];
    if (selectedWorkspaceId.value && !workspaces.value.some((workspace) => workspace.id === selectedWorkspaceId.value)) {
      selectedWorkspaceId.value = null;
    }
    if (!selectedWorkspaceId.value && visibleWorkspaces.value.length > 0) {
      selectedWorkspaceId.value = visibleWorkspaces.value[0]?.id ?? null;
    }
  } catch (error) {
    showError(error instanceof Error ? error.message : "加载工作区失败");
  } finally {
    loading.value = false;
  }
}

async function handleCreateWorkspace() {
  const name = draftName.value.trim();
  if (!name || saving.value) return;
  saving.value = true;
  try {
    const response = await createWorkspace({
      name,
      description: draftDescription.value.trim() || undefined,
    });
    workspaces.value = [response.data, ...workspaces.value];
    selectedWorkspaceId.value = response.data.id;
    draftName.value = "";
    draftDescription.value = "";
    showSuccess("工作区已创建");
  } catch (error) {
    showError(error instanceof Error ? error.message : "创建工作区失败");
  } finally {
    saving.value = false;
  }
}

function startEdit(workspace: WorkspaceInfo) {
  editingId.value = workspace.id;
  editName.value = workspace.name;
  editDescription.value = workspace.description ?? "";
}

function cancelEdit() {
  editingId.value = null;
  editName.value = "";
  editDescription.value = "";
}

async function saveEdit(workspace: WorkspaceInfo) {
  const name = editName.value.trim();
  if (!name) return;
  try {
    const response = await updateWorkspace(workspace.id, {
      name,
      description: editDescription.value.trim() || undefined,
    });
    workspaces.value = workspaces.value.map((item) => item.id === workspace.id ? response.data : item);
    cancelEdit();
    showSuccess("工作区已更新");
  } catch (error) {
    showError(error instanceof Error ? error.message : "更新工作区失败");
  }
}

async function handleArchive(workspace: WorkspaceInfo) {
  const confirmed = await confirmDialog({
    header: "归档工作区",
    body: `归档“${workspace.name}”？已归档工作区不会出现在默认列表中。`,
    confirmText: "归档",
  });
  if (!confirmed) return;
  try {
    const response = await archiveWorkspace(workspace.id);
    workspaces.value = workspaces.value.map((item) => item.id === workspace.id ? response.data : item);
    if (!includeArchived.value && selectedWorkspaceId.value === workspace.id) {
      selectedWorkspaceId.value = visibleWorkspaces.value.find((item) => item.id !== workspace.id)?.id ?? null;
    }
    showSuccess("工作区已归档");
  } catch (error) {
    showError(error instanceof Error ? error.message : "归档工作区失败");
  }
}

async function handleDelete(workspace: WorkspaceInfo) {
  const confirmed = await confirmDialog({
    header: "删除工作区",
    body: `永久删除“${workspace.name}”？这会清理工作区文件和容器，并解除关联会话挂载。`,
    confirmText: "删除",
    theme: "danger",
  });
  if (!confirmed) return;
  try {
    await deleteWorkspace(workspace.id);
    workspaces.value = workspaces.value.filter((item) => item.id !== workspace.id);
    if (selectedWorkspaceId.value === workspace.id) {
      selectedWorkspaceId.value = visibleWorkspaces.value[0]?.id ?? null;
    }
    showSuccess("工作区已删除");
  } catch (error) {
    showError(error instanceof Error ? error.message : "删除工作区失败");
  }
}
</script>

<template>
  <div class="workspaces-view">
    <section class="workspace-list-pane">
      <header class="view-header">
        <div class="view-header-text">
          <h1>工作区</h1>
          <p>管理 Agent 可写入、运行和产出文件的独立空间</p>
        </div>
        <button class="icon-btn" type="button" title="刷新" :disabled="loading" @click="loadWorkspaces">
          <SvgIcon name="refresh" :size="15" />
        </button>
      </header>

      <form class="create-form" @submit.prevent="handleCreateWorkspace">
        <div class="create-form-row">
          <input v-model="draftName" type="text" maxlength="60" placeholder="工作区名称">
          <button type="submit" class="create-btn" :disabled="saving || !draftName.trim()">
            <SvgIcon name="plus" :size="14" />
            创建
          </button>
        </div>
        <input v-model="draftDescription" type="text" maxlength="160" placeholder="描述（可选）">
      </form>

      <label class="archive-toggle">
        <input v-model="includeArchived" type="checkbox" @change="loadWorkspaces">
        <span>显示已归档</span>
      </label>

      <div class="workspace-list">
        <button
          v-for="workspace in visibleWorkspaces"
          :key="workspace.id"
          class="workspace-card"
          :class="{ active: selectedWorkspaceId === workspace.id, archived: Boolean(workspace.archivedAt) }"
          type="button"
          @click="selectedWorkspaceId = workspace.id"
        >
          <div class="workspace-card-icon">
            <SvgIcon name="folder" :size="16" />
          </div>
          <div class="workspace-card-body">
            <span class="workspace-card-name">{{ workspace.name }}</span>
            <span class="workspace-card-desc">{{ workspace.description || workspace.id }}</span>
            <span class="workspace-card-meta">
              {{ workspace.archivedAt ? "已归档" : "更新于 " + formatTimeLong(workspace.updatedAt) }}
            </span>
          </div>
        </button>
        <div v-if="!loading && visibleWorkspaces.length === 0" class="empty-state">
          <SvgIcon name="folder" :size="28" />
          <p>暂无工作区</p>
        </div>
        <div v-if="loading" class="empty-state">
          <SvgIcon name="refresh" :size="28" />
          <p>加载中...</p>
        </div>
      </div>
    </section>

    <section class="workspace-detail-pane">
      <template v-if="selectedWorkspace">
        <header class="detail-header">
          <div v-if="editingId !== selectedWorkspace.id" class="detail-title">
            <h2>{{ selectedWorkspace.name }}</h2>
            <p>{{ selectedWorkspace.description || selectedWorkspace.id }}</p>
          </div>
          <form v-else class="edit-form" @submit.prevent="saveEdit(selectedWorkspace)">
            <input v-model="editName" type="text" maxlength="60">
            <input v-model="editDescription" type="text" maxlength="160" placeholder="描述（可选）">
          </form>
          <div class="detail-actions">
            <template v-if="editingId === selectedWorkspace.id">
              <button class="secondary-btn" type="button" @click="cancelEdit">取消</button>
              <button class="primary-btn" type="button" :disabled="!editName.trim()" @click="saveEdit(selectedWorkspace)">保存</button>
            </template>
            <template v-else>
              <button class="secondary-btn" type="button" @click="startEdit(selectedWorkspace)">编辑</button>
              <button v-if="!selectedWorkspace.archivedAt" class="secondary-btn" type="button" @click="handleArchive(selectedWorkspace)">归档</button>
              <button class="danger-btn" type="button" @click="handleDelete(selectedWorkspace)">删除</button>
            </template>
          </div>
        </header>
        <div class="artifacts-wrap">
          <WorkspaceArtifactsPanel :workspace-id="selectedWorkspace.id" />
        </div>
      </template>
      <div v-else class="detail-empty">
        <div class="detail-empty-icon">
          <SvgIcon name="folder" :size="34" />
        </div>
        <p class="detail-empty-title">选择或创建一个工作区</p>
        <p class="detail-empty-hint">从左侧选择一个工作区，或创建新的工作区开始使用</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.workspaces-view {
  display: grid;
  grid-template-columns: minmax(320px, 380px) minmax(0, 1fr);
  gap: 18px;
  height: 100%;
  min-height: 0;
  padding: 24px;
  background: rgba(255, 255, 255, 0.01);
  box-sizing: border-box;
}

.workspace-list-pane,
.workspace-detail-pane {
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border-subtle);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(12px);
}

.workspace-list-pane {
  padding: 20px;
  gap: 16px;
}

.workspace-detail-pane {
  padding: 20px;
  gap: 16px;
}

.view-header,
.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.view-header h1,
.detail-title h2 {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.view-header p,
.detail-title p {
  margin: 6px 0 0;
  color: var(--color-text-muted);
  font-size: 13px;
  line-height: 1.4;
}

/* Buttons */
.icon-btn,
.secondary-btn,
.primary-btn,
.danger-btn {
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.icon-btn {
  width: 34px;
  border: 1px solid var(--color-border-subtle);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary);
}

.icon-btn:hover:not(:disabled) {
  border-color: rgba(99, 102, 241, 0.35);
  background: rgba(99, 102, 241, 0.1);
  color: var(--color-text-primary);
}

.secondary-btn {
  border: 1px solid var(--color-border-subtle);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary);
  padding: 0 12px;
}

.secondary-btn:hover:not(:disabled) {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.07);
  color: var(--color-text-primary);
}

.primary-btn {
  border: 1px solid rgba(99, 102, 241, 0.35);
  background: rgba(99, 102, 241, 0.18);
  color: var(--color-accent-light);
  padding: 0 14px;
}

.primary-btn:hover:not(:disabled) {
  background: rgba(99, 102, 241, 0.28);
  border-color: rgba(99, 102, 241, 0.5);
  box-shadow: 0 0 12px rgba(99, 102, 241, 0.15);
}

.danger-btn {
  border: 1px solid rgba(248, 113, 113, 0.35);
  background: rgba(248, 113, 113, 0.12);
  color: #f87171;
  padding: 0 12px;
}

.danger-btn:hover:not(:disabled) {
  background: rgba(248, 113, 113, 0.2);
  border-color: rgba(248, 113, 113, 0.5);
}

button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Create form */
.create-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
}

.create-form-row {
  display: flex;
  gap: 8px;
}

.create-form input,
.edit-form input {
  min-width: 0;
  height: 36px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  padding: 0 11px;
  background: rgba(0, 0, 0, 0.22);
  color: var(--color-text-primary);
  outline: none;
  font: inherit;
  font-size: 13px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  box-sizing: border-box;
}

.create-form input:focus,
.edit-form input:focus {
  border-color: rgba(99, 102, 241, 0.45);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.create-btn {
  flex-shrink: 0;
  height: 36px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 14px;
  border: 1px solid rgba(99, 102, 241, 0.35);
  border-radius: 8px;
  background: rgba(99, 102, 241, 0.18);
  color: var(--color-accent-light);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.create-btn:hover:not(:disabled) {
  background: rgba(99, 102, 241, 0.28);
  border-color: rgba(99, 102, 241, 0.5);
  box-shadow: 0 0 12px rgba(99, 102, 241, 0.15);
}

.create-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Archive toggle */
.archive-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-muted);
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}

.archive-toggle input[type="checkbox"] {
  accent-color: var(--color-accent);
}

/* Workspace list */
.workspace-list {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 2px;
}

.workspace-card {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.025);
  color: var(--color-text-secondary);
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
}

.workspace-card:hover {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
}

.workspace-card.active {
  border-color: rgba(99, 102, 241, 0.4);
  background: rgba(99, 102, 241, 0.1);
  box-shadow: 0 0 16px rgba(99, 102, 241, 0.08);
}

.workspace-card.archived {
  opacity: 0.6;
}

.workspace-card-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: rgba(99, 102, 241, 0.12);
  color: var(--color-accent-light);
  margin-top: 1px;
}

.workspace-card.active .workspace-card-icon {
  background: rgba(99, 102, 241, 0.2);
}

.workspace-card-body {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.workspace-card-name {
  color: var(--color-text-primary);
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-card-desc {
  min-width: 0;
  color: var(--color-text-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-card-meta {
  color: var(--color-text-muted);
  font-size: 11px;
}

/* Detail pane */
.detail-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.edit-form {
  flex: 1;
  max-width: 520px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.artifacts-wrap {
  min-height: 0;
  flex: 1;
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
  overflow: hidden;
}

.artifacts-wrap :deep(.workspace-artifacts) {
  height: 100%;
  padding: 16px;
}

/* Empty states */
.empty-state,
.detail-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--color-text-muted);
}

.empty-state {
  min-height: 180px;
}

.empty-state :deep(svg) {
  opacity: 0.3;
}

.detail-empty {
  height: 100%;
  gap: 14px;
}

.detail-empty-icon {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  background: rgba(99, 102, 241, 0.08);
  color: var(--color-accent-light);
}

.detail-empty-title {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 16px;
  font-weight: 600;
}

.detail-empty-hint {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 13px;
}

@media (max-width: 1024px) {
  .workspaces-view {
    grid-template-columns: 1fr;
  }

  .workspace-list-pane {
    border-right: 0;
    max-height: 45vh;
  }
}
</style>
