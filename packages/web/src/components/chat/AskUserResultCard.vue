<script lang="ts">
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeChoices(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeText(item))
    .filter((item) => item.length > 0);
}

function normalizeArrayField(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeText(item)).filter(Boolean);
}

export interface AskUserResultView {
  question: string;
  answer: string;
  context: string;
  choices: string[];
  selectedChoices: string[];
  freeText: string;
  skipped: boolean;
  pending: boolean;
}

export function extractAskUserResult(details: unknown, args: unknown): AskUserResultView | null {
  const detailsRecord = asRecord(details);
  const argsRecord = asRecord(args);
  if (!detailsRecord && !argsRecord) return null;

  const question = normalizeText(detailsRecord?.question) || normalizeText(argsRecord?.question);
  const answer = normalizeText(detailsRecord?.answer);
  const context = normalizeText(argsRecord?.context);
  const choices = normalizeChoices(argsRecord?.choices);
  const selectedChoices = normalizeArrayField(detailsRecord?.selectedChoices);
  const freeText = normalizeText(detailsRecord?.freeText);
  const skipped = detailsRecord?.skipped === true;
  const pending = Boolean(question) && !detailsRecord;

  if (!question && !answer && !skipped) return null;
  return {
    question: question || "Agent 提问",
    answer,
    context,
    choices,
    selectedChoices,
    freeText,
    skipped,
    pending,
  };
}
</script>

<script setup lang="ts">
import { computed, ref } from "vue";
import SectionLabel from "./SectionLabel.vue";
import SvgIcon from "../common/SvgIcon.vue";

const COLLAPSED_CHOICE_COUNT = 24;

const props = defineProps<{
  result: AskUserResultView;
}>();

const choicesExpanded = ref(false);
const answerLabel = computed(() => {
  if (props.result.pending) return "等待回答";
  return props.result.skipped ? "用户跳过" : "用户回答";
});
const answerText = computed(() => {
  if (props.result.pending) return "Agent 正在等待用户在输入框上方的回答面板中提交回复。";
  if (props.result.skipped) return "用户没有提供回答，Agent 将基于当前上下文继续。";
  return props.result.answer || "用户提交了空回答。";
});
const visibleChoices = computed(() => {
  if (choicesExpanded.value) return props.result.choices;
  return props.result.choices.slice(0, COLLAPSED_CHOICE_COUNT);
});
const hiddenChoiceCount = computed(() => Math.max(props.result.choices.length - visibleChoices.value.length, 0));
</script>

<template>
  <div class="tool-section">
    <SectionLabel icon="user" label="用户确认" />
    <div class="ask-result-card" :class="{ skipped: result.skipped, pending: result.pending }">
      <div class="ask-result-header">
        <div class="ask-result-icon">
          <SvgIcon name="user" :size="15" />
        </div>
        <div class="ask-result-main">
          <span class="ask-result-kicker">Agent 提问</span>
          <strong>{{ result.question }}</strong>
        </div>
        <span class="ask-status" :class="{ skipped: result.skipped, pending: result.pending }">
          {{ result.pending ? "等待中" : (result.skipped ? "已跳过" : "已回答") }}
        </span>
      </div>

      <p v-if="result.context" class="ask-context">{{ result.context }}</p>

      <div v-if="result.choices.length > 0" class="ask-choice-list">
        <span
          v-for="choice in visibleChoices"
          :key="choice"
          class="ask-choice"
          :class="{ selected: !result.skipped && (result.selectedChoices.length > 0 ? result.selectedChoices.includes(choice) : choice === result.answer) }"
        >
          <span v-if="result.selectedChoices.length > 0" class="choice-indicator" :class="{ checked: result.selectedChoices.includes(choice) }">
            <SvgIcon v-if="result.selectedChoices.includes(choice)" name="check" :size="11" />
          </span>
          {{ choice }}
        </span>
        <button
          v-if="hiddenChoiceCount > 0 || choicesExpanded"
          type="button"
          class="choice-toggle"
          @click="choicesExpanded = !choicesExpanded"
        >
          <SvgIcon :name="choicesExpanded ? 'chevronDown' : 'chevronRight'" :size="12" />
          {{ choicesExpanded ? "收起选项" : `展开 ${hiddenChoiceCount} 项` }}
        </button>
      </div>

      <section class="ask-answer-block" :class="{ pending: result.pending }">
        <div class="ask-answer-title">
          <SvgIcon :name="result.pending ? 'clock' : (result.skipped ? 'close' : 'check')" :size="13" />
          <span>{{ answerLabel }}</span>
        </div>
        <p v-if="result.selectedChoices.length > 0 && result.freeText">{{ result.freeText }}</p>
        <p v-else>{{ answerText }}</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.ask-result-card {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-card);
}

.ask-result-card.skipped {
  border-color: var(--border-warning);
  background: var(--bg-warning);
}

.ask-result-card.pending {
  border-color: var(--border-default);
  background: var(--bg-card);
}

.ask-result-header {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: start;
  gap: 10px;
}

.ask-result-icon {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-accent-bg);
  color: var(--text-primary);
}

.ask-result-main {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.ask-result-kicker,
.ask-answer-title,
.ask-status {
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
}

.ask-result-kicker {
  color: var(--text-muted);
}

.ask-result-main strong {
  color: var(--text-primary);
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.ask-status {
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  border-radius: 999px;
  color: var(--color-success);
  background: var(--bg-success);
  white-space: nowrap;
}

.ask-status.skipped {
  color: var(--color-warning);
  background: var(--bg-warning);
}

.ask-status.pending {
  color: var(--text-secondary);
  background: var(--bg-hover);
}

.ask-context {
  margin: 0;
  padding: 9px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.ask-choice-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 188px;
  overflow: auto;
  padding-right: 2px;
}

.ask-choice,
.choice-toggle {
  min-height: 26px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
}

.choice-toggle {
  cursor: pointer;
}

.ask-choice.selected {
  border-color: var(--color-accent);
  background: var(--color-accent-bg);
  color: var(--text-primary);
}

.choice-toggle:hover {
  border-color: var(--border-default);
  background: var(--bg-hover);
  color: var(--text-primary);
}

.choice-indicator {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid var(--border-default);
  border-radius: 3px;
  background: var(--bg-surface);
  color: transparent;
}

.choice-indicator.checked {
  border-color: var(--color-accent);
  background: var(--color-accent-bg);
  color: var(--text-primary);
}

.ask-answer-block {
  display: grid;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
}

.ask-answer-block.pending {
  border-style: dashed;
}

.ask-answer-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
}

.ask-answer-block p {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--text-sm);
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

@media (max-width: 640px) {
  .ask-result-header {
    grid-template-columns: 32px minmax(0, 1fr);
  }

  .ask-status {
    grid-column: 2;
    width: fit-content;
  }
}
</style>
