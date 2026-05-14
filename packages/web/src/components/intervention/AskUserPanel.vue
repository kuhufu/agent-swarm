<script setup lang="ts">
import { ref, watch } from "vue";
import { useAskUserStore } from "../../stores/ask-user.js";
import SvgIcon from "../common/SvgIcon.vue";

const askUserStore = useAskUserStore();
const answer = ref("");

watch(
  () => askUserStore.nextRequest?.requestId,
  () => {
    answer.value = askUserStore.nextRequest?.defaultAnswer ?? "";
  },
  { immediate: true },
);

function chooseAnswer(choice: string) {
  answer.value = choice;
}

function submit() {
  const request = askUserStore.nextRequest;
  if (!request) return;
  askUserStore.submitAnswer(request.requestId, answer.value);
}

function skip() {
  const request = askUserStore.nextRequest;
  if (!request) return;
  askUserStore.skip(request.requestId);
}
</script>

<template>
  <div v-if="askUserStore.hasPending && askUserStore.nextRequest" class="ask-user-inline">
    <section class="ask-user-panel" role="region" aria-label="Agent 提问">
      <header class="ask-user-header">
        <div class="ask-user-icon">
          <SvgIcon name="user" :size="17" />
        </div>
        <div>
          <span>Agent 需要你确认</span>
          <strong>{{ askUserStore.nextRequest.question }}</strong>
        </div>
      </header>

      <p v-if="askUserStore.nextRequest.context" class="ask-user-context">
        {{ askUserStore.nextRequest.context }}
      </p>

      <div v-if="askUserStore.nextRequest.choices.length > 0" class="ask-user-choices">
        <button
          v-for="choice in askUserStore.nextRequest.choices"
          :key="choice"
          type="button"
          :class="{ active: answer === choice }"
          @click="chooseAnswer(choice)"
        >
          {{ choice }}
        </button>
      </div>

      <textarea
        v-model="answer"
        rows="4"
        placeholder="输入你的回答..."
        @keydown.ctrl.enter.prevent="submit"
        @keydown.meta.enter.prevent="submit"
      />

      <footer class="ask-user-actions">
        <button class="secondary" type="button" @click="skip">
          <SvgIcon name="close" :size="14" />
          跳过
        </button>
        <button class="primary" type="button" @click="submit">
          <SvgIcon name="send" :size="14" />
          提交回答
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.ask-user-inline {
  width: min(820px, calc(100% - 32px));
  margin: 0 auto 10px;
  position: relative;
  z-index: 4;
}

.ask-user-panel {
  width: 100%;
  display: grid;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  box-shadow: var(--shadow-md);
}

.ask-user-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.ask-user-icon {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-accent-bg);
  color: var(--text-primary);
}

.ask-user-header div:last-child {
  min-width: 0;
  display: grid;
  gap: 5px;
}

.ask-user-header span {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.ask-user-header strong {
  color: var(--text-primary);
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
  line-height: 1.45;
}

.ask-user-context {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: 1.6;
}

.ask-user-choices {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ask-user-choices button,
.ask-user-actions button {
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  cursor: pointer;
}

.ask-user-choices button {
  padding: 0 10px;
}

.ask-user-choices button:hover,
.ask-user-choices button.active,
.ask-user-actions button:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-default);
}

.ask-user-panel textarea {
  width: 100%;
  min-height: 82px;
  resize: vertical;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: var(--text-base);
  line-height: 1.55;
  outline: none;
}

.ask-user-panel textarea:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-accent-bg);
}

.ask-user-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.ask-user-actions .secondary {
  padding: 0 12px;
}

.ask-user-actions .primary {
  padding: 0 14px;
  border-color: var(--color-accent);
  background: var(--color-accent-bg);
  color: var(--text-primary);
}

@media (max-width: 640px) {
  .ask-user-inline {
    width: min(100% - 24px, 820px);
    margin-bottom: 8px;
  }

  .ask-user-actions {
    flex-direction: column-reverse;
  }

  .ask-user-actions button {
    width: 100%;
  }
}
</style>
