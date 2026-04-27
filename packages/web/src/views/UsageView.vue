<script setup lang="ts">
import { onMounted, ref, computed } from "vue";

interface UsageRow {
  conversationId: string;
  provider: string;
  modelId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
}

interface DailyUsageRow {
  date: string;
  provider: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
}

const dailyUsage = ref<DailyUsageRow[]>([]);
const selectedDays = ref(7);
const loading = ref(false);

const totalTokens = computed(() => dailyUsage.value.reduce((s, r) => s + r.totalTokens, 0));
const totalCost = computed(() => dailyUsage.value.reduce((s, r) => s + r.cost, 0));

onMounted(async () => {
  await loadDailyUsage();
});

async function loadDailyUsage() {
  loading.value = true;
  try {
    const resp = await fetch(`/api/usage/daily?days=${selectedDays.value}`);
    const json = await resp.json() as { data: DailyUsageRow[] };
    dailyUsage.value = json.data;
  } catch {
    dailyUsage.value = [];
  } finally {
    loading.value = false;
  }
}

function formatCost(cost: number): string {
  if (cost === 0) return "-";
  return `$${cost.toFixed(4)}`;
}

function formatTokens(n: number): string {
  if (n === 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
</script>

<template>
  <div class="page">
    <div class="header">
      <h1 class="title">用量统计</h1>
      <p class="subtitle">Token 消耗与成本概览</p>
    </div>

    <div class="summary-cards">
      <div class="card summary-card">
        <div class="card-label">时间范围</div>
        <div class="card-value">
          <select v-model="selectedDays" @change="loadDailyUsage" class="days-select">
            <option :value="7">最近 7 天</option>
            <option :value="30">最近 30 天</option>
            <option :value="90">最近 90 天</option>
          </select>
        </div>
      </div>
      <div class="card summary-card">
        <div class="card-label">总 Token</div>
        <div class="card-value">{{ formatTokens(totalTokens) }}</div>
      </div>
      <div class="card summary-card">
        <div class="card-label">总费用</div>
        <div class="card-value cost">{{ formatCost(totalCost) }}</div>
      </div>
    </div>

    <div class="card table-card">
      <div class="table-header">
        <h2>每日用量明细</h2>
      </div>
      <div v-if="loading" class="empty-state">加载中...</div>
      <div v-else-if="!dailyUsage.length" class="empty-state">暂无用量数据</div>
      <table v-else class="usage-table">
        <thead>
          <tr>
            <th>日期</th>
            <th>提供商</th>
            <th>模型</th>
            <th class="num">输入 Token</th>
            <th class="num">输出 Token</th>
            <th class="num">总计</th>
            <th class="num">费用</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in dailyUsage" :key="`${row.date}-${row.provider}-${row.modelId}`">
            <td class="date">{{ row.date }}</td>
            <td>{{ row.provider }}</td>
            <td class="model">{{ row.modelId }}</td>
            <td class="num">{{ formatTokens(row.inputTokens) }}</td>
            <td class="num">{{ formatTokens(row.outputTokens) }}</td>
            <td class="num">{{ formatTokens(row.totalTokens) }}</td>
            <td class="num cost">{{ formatCost(row.cost) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 1000px;
  margin: 0 auto;
  padding: 32px 24px;
}

.header {
  margin-bottom: 28px;
}

.title {
  font-size: 22px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0 0 6px;
}

.subtitle {
  font-size: 14px;
  color: var(--color-text-muted);
  margin: 0;
}

.summary-cards {
  display: flex;
  gap: 16px;
  margin-bottom: 24px;
}

.summary-card {
  flex: 1;
  padding: 20px;
  border-radius: 12px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border-subtle);
}

.card-label {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.card-value {
  font-size: 24px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.card-value.cost {
  color: var(--color-accent);
}

.days-select {
  background: var(--color-surface-3);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 14px;
  cursor: pointer;
  outline: none;
}

.days-select:focus {
  border-color: var(--color-accent);
}

.table-card {
  padding: 0;
  border-radius: 12px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border-subtle);
  overflow: hidden;
}

.table-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border-subtle);
}

.table-header h2 {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.usage-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.usage-table th {
  text-align: left;
  padding: 10px 16px;
  color: var(--color-text-muted);
  font-weight: 500;
  border-bottom: 1px solid var(--color-border-subtle);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.usage-table td {
  padding: 10px 16px;
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--color-border-subtle);
}

.usage-table tr:last-child td {
  border-bottom: none;
}

.usage-table td.date {
  color: var(--color-text-primary);
  font-weight: 500;
}

.usage-table td.model {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.usage-table td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.usage-table td.cost {
  color: var(--color-accent);
  font-weight: 500;
}

.usage-table th.num {
  text-align: right;
}

.empty-state {
  text-align: center;
  padding: 48px 20px;
  color: var(--color-text-muted);
  font-size: 14px;
}
</style>
