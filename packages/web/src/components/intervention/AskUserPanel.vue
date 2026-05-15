<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useAskUserStore } from "../../stores/ask-user.js";
import SvgIcon from "../common/SvgIcon.vue";

const askUserStore = useAskUserStore();
const answer = ref("");
const selectedChoices = ref<string[]>([]);
const choiceFilter = ref("");

const isMultiple = computed(() => askUserStore.nextRequest?.multiple ?? false);
const choices = computed(() => askUserStore.nextRequest?.choices ?? []);
const selectedCount = computed(() => selectedChoices.value.length);
const shouldShowChoiceFilter = computed(() => choices.value.length > 12);
const filteredChoices = computed(() => {
  const keyword = choiceFilter.value.trim().toLowerCase();
  if (!keyword) return choices.value;
  return choices.value.filter((choice) => choice.toLowerCase().includes(keyword));
});

watch(
  () => askUserStore.nextRequest?.requestId,
  () => {
    const request = askUserStore.nextRequest;
    answer.value = request && !request.multiple ? request.defaultAnswer ?? "" : "";
    choiceFilter.value = "";
    selectedChoices.value = request?.multiple
      ? choicesFromDefaultAnswer(request.defaultAnswer, request.choices)
      : [];
  },
  { immediate: true },
);

function chooseAnswer(choice: string) {
  if (isMultiple.value) {
    if (selectedChoices.value.includes(choice)) {
      selectedChoices.value = selectedChoices.value.filter((item) => item !== choice);
    } else {
      selectedChoices.value = [...selectedChoices.value, choice];
    }
  } else {
    answer.value = choice;
  }
}

function isChoiceSelected(choice: string): boolean {
  return isMultiple.value
    ? selectedChoices.value.includes(choice)
    : answer.value.trim() === choice;
}

function clearSelection() {
  selectedChoices.value = [];
}

function submit() {
  const request = askUserStore.nextRequest;
  if (!request) return;
  if (isMultiple.value) {
    askUserStore.submitStructuredAnswer(request.requestId, {
      selectedChoices: selectedChoices.value,
      freeText: answer.value,
    });
    return;
  }
  askUserStore.submitAnswer(request.requestId, answer.value);
}

function skip() {
  const request = askUserStore.nextRequest;
  if (!request) return;
  askUserStore.skip(request.requestId);
}

function choicesFromDefaultAnswer(defaultAnswer: string | undefined, availableChoices: string[]): string[] {
  if (!defaultAnswer) return [];
  const lines = defaultAnswer.split("\n").map((item) => item.trim()).filter(Boolean);
  return availableChoices.filter((choice) => lines.includes(choice));
}
</script>

<template>
  <div v-if="askUserStore.hasPending && askUserStore.nextRequest" class="ask-user-inline">
    <section class="ask-user-panel" role="region" aria-label="Agent 提问">
      <header class="ask-user-header">
        <div class="ask-user-icon">
          <SvgIcon name="user" :size="17" />
        </div>
        <div class="ask-user-header-content">
          <div class="ask-user-header-top">
            <span>Agent 需要你确认</span>
            <div v-if="askUserStore.pendingCount > 1" class="ask-user-queue-nav">
              <button
                type="button"
                :disabled="!askUserStore.hasOlder"
                @mousedown.stop
                @click.prevent.stop="askUserStore.goNext"
              >
                <SvgIcon name="chevronLeft" :size="14" />
              </button>
              <span class="ask-user-queue-count">{{ askUserStore.currentIndex + 1 }} / {{ askUserStore.pendingCount }}</span>
              <button
                type="button"
                :disabled="!askUserStore.hasNewer"
                @mousedown.stop
                @click.prevent.stop="askUserStore.goPrev"
              >
                <SvgIcon name="chevronRight" :size="14" />
              </button>
            </div>
          </div>
          <strong>{{ askUserStore.nextRequest.question }}</strong>
        </div>
      </header>

      <p v-if="askUserStore.nextRequest.context" class="ask-user-context">
        {{ askUserStore.nextRequest.context }}
      </p>

      <div v-if="isMultiple && choices.length > 0" class="ask-user-choice-toolbar">
        <span>{{ selectedCount }} / {{ choices.length }} 已选择</span>
        <button
          v-if="selectedCount > 0"
          type="button"
          @mousedown.stop
          @click.prevent.stop="clearSelection"
        >
          清空选择
        </button>
      </div>

      <label v-if="shouldShowChoiceFilter" class="ask-user-choice-filter">
        <SvgIcon name="search" :size="14" />
        <input
          v-model="choiceFilter"
          type="search"
          placeholder="筛选选项..."
          @mousedown.stop
          @click.stop
        />
      </label>

      <div v-if="choices.length > 0" class="ask-user-choices">
        <button
          v-for="choice in filteredChoices"
          :key="choice"
          type="button"
          :aria-pressed="isChoiceSelected(choice)"
          :class="{ active: isChoiceSelected(choice), checkbox: isMultiple }"
          @mousedown.stop
          @click.prevent.stop="chooseAnswer(choice)"
        >
          <span v-if="isMultiple" class="choice-checkbox" :class="{ checked: isChoiceSelected(choice) }">
            <SvgIcon v-if="isChoiceSelected(choice)" name="check" :size="12" />
          </span>
          {{ choice }}
        </button>
        <p v-if="filteredChoices.length === 0" class="ask-user-empty-choice">
          没有匹配的选项
        </p>
      </div>

      <div v-if="isMultiple && choices.length > 0" class="ask-divider" />

      <textarea
        v-model="answer"
        rows="4"
        :placeholder="isMultiple ? '补充说明（可选，不会影响已勾选选项）...' : '输入你的回答...'"
        @keydown.ctrl.enter.prevent="submit"
        @keydown.meta.enter.prevent="submit"
      />

      <footer class="ask-user-actions">
        <button class="secondary" type="button" @mousedown.stop @click.prevent.stop="skip">
          <SvgIcon name="close" :size="14" />
          跳过
        </button>
        <button class="primary" type="button" @mousedown.stop @click.prevent.stop="submit">
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

.ask-user-header-content {
  min-width: 0;
  display: grid;
  gap: 5px;
  flex: 1;
}

.ask-user-header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
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

.ask-user-queue-nav {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ask-user-queue-nav button {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-secondary);
  cursor: pointer;
}

.ask-user-queue-nav button:hover:not(:disabled) {
  border-color: var(--border-default);
  background: var(--bg-hover);
  color: var(--text-primary);
}

.ask-user-queue-nav button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ask-user-queue-count {
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  min-width: 44px;
  text-align: center;
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
  max-height: min(232px, 34dvh);
  overflow: auto;
  padding-right: 2px;
}

.ask-user-choice-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
}

.ask-user-choice-toolbar button {
  min-height: 28px;
  padding: 0 9px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  cursor: pointer;
}

.ask-user-choice-toolbar button:hover {
  border-color: var(--border-default);
  background: var(--bg-hover);
  color: var(--text-primary);
}

.ask-user-choice-filter {
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-muted);
}

.ask-user-choice-filter:focus-within {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-accent-bg);
}

.ask-user-choice-filter input {
  width: 100%;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-sm);
  outline: none;
}

.ask-user-choice-filter input::placeholder {
  color: var(--text-muted);
}

.ask-user-empty-choice {
  width: 100%;
  margin: 0;
  padding: 10px 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
  text-align: center;
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

.ask-user-choices button.checkbox {
  gap: 8px;
}

.choice-checkbox {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid var(--border-default);
  border-radius: 3px;
  background: var(--bg-surface);
  color: transparent;
  transition: all 0.15s ease;
}

.choice-checkbox.checked {
  border-color: var(--color-accent);
  background: var(--color-accent-bg);
  color: var(--text-primary);
}

.ask-divider {
  height: 1px;
  background: var(--border-subtle);
  margin: 0;
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
