<script setup lang="ts">
import { ref } from "vue";
import { useIntervention } from "../../composables/useIntervention.js";

const { hasPending, currentIntervention, approve, reject, edit } = useIntervention();
const editValue = ref("");
const showEdit = ref(false);

function handleEdit() {
  if (currentIntervention.value) {
    editValue.value = JSON.stringify(currentIntervention.value.context, null, 2);
    showEdit.value = true;
  }
}

function submitEdit() {
  if (currentIntervention.value) {
    edit(currentIntervention.value.requestId, editValue.value);
    showEdit.value = false;
  }
}
</script>

<template>
  <div v-if="hasPending && currentIntervention" class="intervention-panel animate-slide-up">
    <div class="intervention-header">
      <div class="intervention-title">
        <div class="intervention-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <div>
          <span class="intervention-badge">需要介入</span>
          <span class="intervention-point">{{ currentIntervention.point }}</span>
        </div>
      </div>
    </div>

    <div class="intervention-body">
      <div class="intervention-context">
        <pre>{{ JSON.stringify(currentIntervention.context, null, 2) }}</pre>
      </div>
      <div v-if="showEdit" class="intervention-edit">
        <textarea
          v-model="editValue"
          class="input-field"
          rows="4"
          placeholder="编辑内容..."
        />
      </div>
    </div>

    <div class="intervention-actions">
      <button class="btn-primary" @click="approve(currentIntervention.requestId)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        批准
      </button>
      <button class="btn-secondary" @click="reject(currentIntervention.requestId)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
        拒绝
      </button>
      <button v-if="!showEdit" class="btn-secondary" @click="handleEdit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
        编辑
      </button>
      <template v-else>
        <button class="btn-primary" @click="submitEdit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          确认编辑
        </button>
        <button class="btn-secondary" @click="showEdit = false">
          取消
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.intervention-panel {
  padding: 16px 24px;
  background: rgba(245, 158, 11, 0.06);
  border-top: 1px solid rgba(245, 158, 11, 0.15);
  backdrop-filter: blur(12px);
}

.intervention-header {
  margin-bottom: 12px;
}

.intervention-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.intervention-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(245, 158, 11, 0.15);
  border-radius: 10px;
  color: var(--color-warning);
}

.intervention-icon svg {
  width: 16px;
  height: 16px;
}

.intervention-badge {
  display: inline-block;
  padding: 2px 10px;
  background: rgba(245, 158, 11, 0.2);
  border-radius: 9999px;
  font-size: 12px;
  color: #fbbf24;
  font-weight: 600;
  margin-right: 8px;
}

.intervention-point {
  font-size: 13px;
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
}

.intervention-body {
  margin-bottom: 14px;
}

.intervention-context {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(245, 158, 11, 0.1);
  border-radius: 10px;
  padding: 12px 16px;
  overflow-x: auto;
}

.intervention-context pre {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.intervention-edit {
  margin-top: 12px;
}

.intervention-edit textarea {
  background: rgba(0, 0, 0, 0.2);
  color: var(--color-text-primary);
  font-family: var(--font-mono);
  font-size: 13px;
}

.intervention-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.animate-slide-up {
  animation: slideUp 0.25s ease-out;
}
</style>
