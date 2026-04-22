<script setup lang="ts">
import { computed } from "vue";
import type { ChatMessage } from "../../types/index.js";
import ToolCallCard from "./ToolCallCard.vue";

const props = defineProps<{
  message: ChatMessage;
  streaming?: boolean;
}>();

const hasRenderableContent = computed(() => props.message.content.trim().length > 0);

function roleClass(role: string): string {
  switch (role) {
    case "user": return "msg-user";
    case "assistant": return "msg-assistant";
    case "tool_result": return "msg-tool";
    case "system": return "msg-system";
    default: return "msg-notification";
  }
}

function agentColor(name?: string): string {
  if (!name) return "var(--color-accent)";
  if (name.includes("正")) return "#3b82f6";
  if (name.includes("反")) return "#a855f7";
  if (name.includes("裁判") || name.includes("判")) return "#f59e0b";
  return "var(--color-accent)";
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}
</script>

<template>
  <div class="message-item" :class="[roleClass(message.role)]">
    <div class="msg-body">
      <!-- Header row: agent name + dot for assistant; user label + avatar for user -->
      <div class="msg-header">
        <template v-if="message.role === 'assistant'">
          <span class="agent-name-with-dot">
            <span class="status-dot" :style="{ background: agentColor(message.agentName) }" />
            {{ message.agentName || message.agentId || "Assistant" }}
          </span>
        </template>
        <template v-else-if="message.role === 'user'">
          <span class="msg-role">你</span>
          <div class="avatar user-avatar-small">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
        </template>
        <template v-else>
          <span class="msg-role">{{ message.role === 'system' ? '系统' : '通知' }}</span>
        </template>
      </div>

      <div v-if="message.thinking" class="msg-thinking">
        <details>
          <summary>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            思考过程
          </summary>
          <p>{{ message.thinking }}</p>
        </details>
      </div>

      <div v-if="hasRenderableContent" class="msg-content">
        <p>{{ message.content }}</p>
      </div>

      <div v-if="message.toolCalls?.length" class="msg-tool-calls">
        <ToolCallCard
          v-for="tc in message.toolCalls"
          :key="tc.id"
          :tool-call="tc"
        />
      </div>

      <div class="msg-footer">
        <span v-if="streaming" class="streaming-indicator">
          <span class="dot" />
          <span class="dot" />
          <span class="dot" />
        </span>
        <span v-else class="timestamp">{{ formatTime(message.timestamp) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.message-item {
  display: flex;
  gap: 12px;
  padding: 12px 0;
  max-width: 100%;
  animation: fadeIn 0.2s ease-out;
}

/* ── Assistant (left-aligned) ── */
.msg-assistant {
  align-items: flex-start;
}

.msg-assistant .msg-body {
  align-items: flex-start;
  max-width: 100%;
}

.msg-assistant .msg-content {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border-subtle);
  border-radius: 12px;
}

/* ── User (right-aligned) ── */
.msg-user {
  flex-direction: row-reverse;
  align-items: flex-start;
}

.msg-user .msg-body {
  align-items: flex-end;
  max-width: 80%;
}

.msg-user .msg-header {
  justify-content: flex-end;
}

.msg-user .msg-content {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(139, 92, 246, 0.15));
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 16px 16px 4px 16px;
}

/* ── Tool / System ── */
.msg-tool .msg-content {
  background: rgba(34, 197, 94, 0.08);
  border: 1px solid rgba(34, 197, 94, 0.15);
  border-radius: 12px;
}

.msg-system,
.msg-notification {
  justify-content: center;
}

.msg-system .msg-content,
.msg-notification .msg-content {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border-subtle);
  border-radius: 12px;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 13px;
}

/* ── Avatar ── */
.msg-avatar {
  flex-shrink: 0;
  padding-top: 2px;
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar svg {
  width: 16px;
  height: 16px;
}

.bot-avatar {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-accent-light);
  border: 1px solid var(--color-border-subtle);
}

.user-avatar-small {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-accent), var(--color-accent-dark));
  color: white;
}

.user-avatar-small svg {
  width: 12px;
  height: 12px;
}

/* ── Body ── */
.msg-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

/* ── Header ── */
.msg-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
}

.agent-name-with-dot {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: var(--color-text-primary);
  font-size: 13px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.msg-role {
  font-size: 13px;
  color: var(--color-text-secondary);
  font-weight: 500;
}

/* ── Content ── */
.msg-content {
  padding: 12px 16px;
  line-height: 1.7;
  word-break: break-word;
}

.msg-content p {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 14px;
  white-space: pre-wrap;
}

/* ── Footer / Timestamp ── */
.msg-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px;
  height: 16px;
}

.timestamp {
  font-size: 11px;
  color: var(--color-text-muted);
}

.streaming-indicator {
  display: flex;
  gap: 3px;
  align-items: center;
}

.dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-accent);
  animation: bounce 1.4s ease-in-out infinite both;
}

.dot:nth-child(1) { animation-delay: -0.32s; }
.dot:nth-child(2) { animation-delay: -0.16s; }

@keyframes bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
  40% { transform: scale(1); opacity: 1; }
}

/* ── Thinking ── */
.msg-thinking {
  margin-top: 4px;
  width: 100%;
}

.msg-thinking details {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 13px;
}

.msg-thinking summary {
  color: var(--color-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  list-style: none;
}

.msg-thinking summary::-webkit-details-marker {
  display: none;
}

.msg-thinking p {
  margin: 10px 0 0;
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
}

/* ── Tool calls ── */
.msg-tool-calls {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
