<script setup lang="ts">
// History view — will list past conversations
</script>

<template>
  <div class="history-view">
    <div class="history-header">
      <h2>历史对话</h2>
      <t-input placeholder="搜索对话..." />
    </div>
    <div class="history-list">
      <p class="empty-state">暂无历史对话</p>
    </div>
  </div>
</template>

<style scoped>
.history-view {
  padding: 24px;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.history-header h2 {
  color: #e0e0e0;
  margin: 0;
}

.empty-state {
  text-align: center;
  padding: 64px 0;
  color: #888;
}
</style>
