<script setup lang="ts">
import { useIntervention } from "../../composables/useIntervention.js";

const { hasPending, currentIntervention, approve, reject, edit } = useIntervention();
</script>

<template>
  <div v-if="hasPending && currentIntervention" class="intervention-panel">
    <div class="intervention-header">
      <span class="intervention-badge">需要介入</span>
      <span class="intervention-point">{{ currentIntervention.point }}</span>
    </div>
    <div class="intervention-body">
      <p class="intervention-context">
        {{ JSON.stringify(currentIntervention.context, null, 2) }}
      </p>
    </div>
    <div class="intervention-actions">
      <t-button size="small" theme="success" @click="approve(currentIntervention.requestId)">
        批准
      </t-button>
      <t-button size="small" theme="danger" @click="reject(currentIntervention.requestId)">
        拒绝
      </t-button>
      <t-button size="small" theme="warning" @click="edit(currentIntervention.requestId, '')">
        编辑
      </t-button>
    </div>
  </div>
</template>

<style scoped>
.intervention-panel {
  padding: 12px 16px;
  background: rgba(245, 158, 11, 0.08);
  border-top: 1px solid rgba(245, 158, 11, 0.2);
  border-bottom: 1px solid rgba(245, 158, 11, 0.2);
}

.intervention-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.intervention-badge {
  padding: 2px 10px;
  background: rgba(245, 158, 11, 0.2);
  border-radius: 10px;
  font-size: 12px;
  color: #f59e0b;
  font-weight: 600;
}

.intervention-point {
  font-size: 13px;
  color: #d0d0d0;
  font-family: monospace;
}

.intervention-body {
  margin-bottom: 12px;
}

.intervention-context {
  font-size: 13px;
  color: #c0c0c0;
  white-space: pre-wrap;
  font-family: monospace;
  background: rgba(0, 0, 0, 0.2);
  padding: 8px;
  border-radius: 6px;
  margin: 0;
}

.intervention-actions {
  display: flex;
  gap: 8px;
}
</style>
