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
</script>

<template>
  <div class="message-item" :class="[roleClass(message.role)]">
    <div class="msg-header">
      <span v-if="message.agentName" class="agent-name">{{ message.agentName }}</span>
      <span class="msg-role">{{ message.role }}</span>
      <span v-if="streaming" class="streaming-indicator">●</span>
    </div>
    <div class="msg-content">
      <p>{{ message.content }}</p>
    </div>
    <div v-if="message.thinking" class="msg-thinking">
      <details>
        <summary>思考过程</summary>
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
</template>

<style scoped>
.message-item {
  padding: 12px 16px;
  margin-bottom: 8px;
  border-radius: 12px;
  max-width: 85%;
}

.msg-user {
  margin-left: auto;
  background: rgba(99, 102, 241, 0.15);
  border: 1px solid rgba(99, 102, 241, 0.2);
}

.msg-assistant {
  margin-right: auto;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px);
}

.msg-tool {
  margin-right: auto;
  background: rgba(34, 197, 94, 0.08);
  border: 1px solid rgba(34, 197, 94, 0.15);
}

.msg-system, .msg-notification {
  margin: 0 auto;
  text-align: center;
  background: rgba(255, 255, 255, 0.02);
  color: #888;
  font-size: 13px;
}

.msg-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.agent-name {
  font-weight: 600;
  color: #a5b4fc;
  font-size: 13px;
}

.msg-role {
  font-size: 11px;
  color: #666;
  text-transform: uppercase;
}

.streaming-indicator {
  color: #6366f1;
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.msg-content p {
  margin: 0;
  color: #d0d0d0;
  line-height: 1.6;
  white-space: pre-wrap;
}

.msg-thinking {
  margin-top: 8px;
  padding: 8px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 6px;
  font-size: 13px;
  color: #888;
}

.msg-tool-calls {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
