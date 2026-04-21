<script setup lang="ts">
import type { ChatMessage } from "../../types/index.js";
import ToolCallCard from "./ToolCallCard.vue";

defineProps<{
  message: ChatMessage;
  streaming?: boolean;
}>();

function roleClass(role: string): string {
  switch (role) {
    case "user": return "msg-user";
    case "assistant": return "msg-assistant";
    case "tool_result": return "msg-tool";
    case "system": return "msg-system";
    default: return "msg-notification";
  }
}

function roleLabel(role: string): string {
  switch (role) {
    case "user": return "你";
    case "assistant": return "Assistant";
    case "tool_result": return "工具";
    case "system": return "系统";
    default: return role;
  }
}

function roleIcon(role: string): string {
  switch (role) {
    case "user": return "UserIcon";
    case "assistant": return "BotIcon";
    case "tool_result": return "ToolIcon";
    case "system": return "SystemIcon";
    default: return "BotIcon";
  }
}
</script>

<template>
  <div class="message-item" :class="[roleClass(message.role)]">
    <div class="msg-avatar">
      <div v-if="roleIcon(message.role) === 'UserIcon'" class="avatar user-avatar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </div>
      <div v-else-if="roleIcon(message.role) === 'BotIcon'" class="avatar bot-avatar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="10" rx="2" />
          <circle cx="12" cy="5" r="2" />
          <path d="M12 7v4" />
          <line x1="8" y1="16" x2="8" y2="16" />
          <line x1="16" y1="16" x2="16" y2="16" />
        </svg>
      </div>
      <div v-else-if="roleIcon(message.role) === 'ToolIcon'" class="avatar tool-avatar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      </div>
      <div v-else class="avatar system-avatar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      </div>
    </div>

    <div class="msg-body">
      <div class="msg-header">
        <span v-if="message.agentName" class="agent-name">{{ message.agentName }}</span>
        <span v-else class="msg-role">{{ roleLabel(message.role) }}</span>
        <span v-if="streaming" class="streaming-indicator">
          <span class="dot" />
          <span class="dot" />
          <span class="dot" />
        </span>
      </div>
      <div class="msg-content">
        <p>{{ message.content }}</p>
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
      <div v-if="message.toolCalls?.length" class="msg-tool-calls">
        <ToolCallCard
          v-for="tc in message.toolCalls"
          :key="tc.id"
          :tool-call="tc"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.message-item {
  display: flex;
  gap: 14px;
  padding: 16px 0;
  max-width: 100%;
  animation: fadeIn 0.2s ease-out;
}

.msg-user {
  flex-direction: row-reverse;
}

.msg-user .msg-body {
  align-items: flex-end;
}

.msg-user .msg-header {
  justify-content: flex-end;
}

.msg-user .msg-content {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(139, 92, 246, 0.15));
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 16px 16px 4px 16px;
}

.msg-assistant .msg-content {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border-subtle);
  border-radius: 16px 16px 16px 4px;
}

.msg-tool .msg-content {
  background: rgba(34, 197, 94, 0.08);
  border: 1px solid rgba(34, 197, 94, 0.15);
  border-radius: 16px 16px 16px 4px;
}

.msg-system, .msg-notification {
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

.user-avatar {
  background: linear-gradient(135deg, var(--color-accent), var(--color-accent-dark));
  color: white;
}

.bot-avatar {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-accent-light);
  border: 1px solid var(--color-border-subtle);
}

.tool-avatar {
  background: rgba(34, 197, 94, 0.15);
  color: var(--color-success);
}

.system-avatar {
  background: rgba(245, 158, 11, 0.15);
  color: var(--color-warning);
}

.msg-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  max-width: calc(100% - 46px);
}

.msg-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
}

.agent-name {
  font-weight: 600;
  color: var(--color-accent-light);
  font-size: 13px;
}

.msg-role {
  font-size: 12px;
  color: var(--color-text-muted);
  font-weight: 500;
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

.msg-thinking {
  margin-top: 4px;
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

.msg-tool-calls {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
