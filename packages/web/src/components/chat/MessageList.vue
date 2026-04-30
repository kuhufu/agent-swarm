<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type { ChatMessage, ToolCallInfo } from "../../types/index.js";
import { useSwarmStore } from "../../stores/swarm.js";
import { MODE_LABEL_ZH } from "../../constants/swarm-modes.js";
import MessageItem from "./MessageItem.vue";

const props = defineProps<{
  messages: ChatMessage[];
  streamingMessages: ChatMessage[];
  isDirectMode?: boolean;
  conversationId?: string | null;
  swarmId?: string | null;
}>();
const emit = defineEmits<{
  selectSwarm: [swarmId: string];
}>();

const swarmStore = useSwarmStore();

const swarms = computed(() => swarmStore.swarms);
const messageListRef = ref<HTMLElement | null>(null);
const shouldAutoScroll = ref(true);
const BOTTOM_THRESHOLD_PX = 24;

const modeLabels: Record<string, string> = {
  router: "路由",
  sequential: "顺序",
  parallel: "并行",
  swarm: "协作",
  debate: "辩论",
};

function selectSwarm(swarmId: string) {
  emit("selectSwarm", swarmId);
}

const visibleMessages = computed(() =>
  props.messages.filter((msg) => {
    if (msg.role !== "assistant") {
      return true;
    }
    const hasText = msg.content.trim().length > 0;
    const hasThinking = typeof msg.thinking === "string" && msg.thinking.trim().length > 0;
    const hasToolCalls = Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0;
    return hasText || hasThinking || hasToolCalls;
  }),
);

interface RenderEntry {
  message: ChatMessage;
  streaming: boolean;
}

function messageRenderKey(entry: RenderEntry): string {
  if (entry.streaming && entry.message.role === "assistant") {
    return `streaming:${entry.message.agentId ?? entry.message.id}`;
  }
  return entry.message.id;
}

function resolveSwarmAgentName(agentId?: string): string | undefined {
  if (!agentId) {
    return undefined;
  }
  const swarm = swarmStore.getSwarmById(props.swarmId);
  if (!swarm) {
    return undefined;
  }
  const agent = swarm.agents.find((item) => item.id === agentId)
    ?? (swarm.orchestrator?.id === agentId ? swarm.orchestrator : undefined);
  return agent?.name;
}

function withResolvedAgentName(message: ChatMessage): ChatMessage {
  if (props.isDirectMode || message.role !== "assistant" || !message.agentId) {
    return message;
  }
  if (message.agentName && message.agentName !== message.agentId) {
    return message;
  }
  const agentName = resolveSwarmAgentName(message.agentId);
  if (!agentName || agentName === message.agentName) {
    return message;
  }
  return {
    ...message,
    agentName,
  };
}

function hasRenderableMessageBody(message: ChatMessage): boolean {
  const hasText = message.content.trim().length > 0;
  const hasThinking = typeof message.thinking === "string" && message.thinking.trim().length > 0;
  const hasToolCalls = Array.isArray(message.toolCalls) && message.toolCalls.length > 0;
  return hasText || hasThinking || hasToolCalls;
}

function mergeTextParts(...parts: Array<string | undefined>): string {
  return parts
    .map((part) => part?.trim() ?? "")
    .filter((part) => part.length > 0)
    .join("\n\n");
}

function mergeToolCalls(
  existing: ToolCallInfo[] | undefined,
  incoming: ToolCallInfo[] | undefined,
): ToolCallInfo[] | undefined {
  if (!existing?.length && !incoming?.length) {
    return undefined;
  }

  const merged: ToolCallInfo[] = [];
  const indexById = new Map<string, number>();

  for (const toolCall of [...(existing ?? []), ...(incoming ?? [])]) {
    const index = indexById.get(toolCall.id);
    if (index === undefined) {
      indexById.set(toolCall.id, merged.length);
      merged.push(toolCall);
      continue;
    }
    merged[index] = {
      ...merged[index],
      ...toolCall,
      arguments: toolCall.arguments !== undefined ? toolCall.arguments : merged[index].arguments,
      result: toolCall.result !== undefined ? toolCall.result : merged[index].result,
      isError: typeof toolCall.isError === "boolean" ? toolCall.isError : merged[index].isError,
    };
  }

  return merged;
}

function canMergeAssistantEntries(previous: RenderEntry, next: RenderEntry): boolean {
  return previous.message.role === "assistant"
    && next.message.role === "assistant"
    && (previous.message.agentId ?? "") === (next.message.agentId ?? "");
}

function mergeAssistantEntries(previous: RenderEntry, next: RenderEntry): RenderEntry {
  return {
    streaming: previous.streaming || next.streaming,
    message: {
      ...previous.message,
      id: `${previous.message.id}+${next.message.id}`,
      content: mergeTextParts(previous.message.content, next.message.content),
      thinking: mergeTextParts(previous.message.thinking, next.message.thinking) || undefined,
      toolCalls: mergeToolCalls(previous.message.toolCalls, next.message.toolCalls),
      agentName: previous.message.agentName ?? next.message.agentName,
      timestamp: Math.min(previous.message.timestamp, next.message.timestamp),
      createdAt: previous.message.createdAt ?? next.message.createdAt,
    },
  };
}

function mergeAdjacentAssistantEntries(entries: RenderEntry[]): RenderEntry[] {
  const merged: RenderEntry[] = [];

  for (const entry of entries) {
    const previous = merged[merged.length - 1];
    if (previous && canMergeAssistantEntries(previous, entry)) {
      merged[merged.length - 1] = mergeAssistantEntries(previous, entry);
      continue;
    }
    merged.push(entry);
  }

  return merged;
}

const renderEntries = computed<RenderEntry[]>(() => {
  const byId = new Map<string, RenderEntry>();

  for (const msg of visibleMessages.value) {
    byId.set(msg.id, { message: withResolvedAgentName(msg), streaming: false });
  }

  for (const msg of props.streamingMessages) {
    if (msg.role === "assistant" && !hasRenderableMessageBody(msg)) {
      continue;
    }
    byId.set(msg.id, { message: withResolvedAgentName(msg), streaming: true });
  }

  const sortedEntries = Array.from(byId.values()).sort((a, b) => {
    if (a.message.timestamp !== b.message.timestamp) {
      return a.message.timestamp - b.message.timestamp;
    }
    return a.message.id.localeCompare(b.message.id);
  });

  return mergeAdjacentAssistantEntries(sortedEntries);
});

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - BOTTOM_THRESHOLD_PX;
}

function updateAutoScrollState() {
  const el = messageListRef.value;
  if (!el) {
    return;
  }
  shouldAutoScroll.value = isNearBottom(el);
}

function scrollToBottom() {
  const el = messageListRef.value;
  if (!el) {
    return;
  }
  el.scrollTop = el.scrollHeight;
}

watch(() => props.messages, async (next, prev) => {
  if (next === prev) {
    return;
  }
  shouldAutoScroll.value = true;
  await nextTick();
  scrollToBottom();
}, { flush: "post" });

watch(renderEntries, async () => {
  await nextTick();
  if (!shouldAutoScroll.value) {
    return;
  }
  scrollToBottom();
}, { deep: true, flush: "post" });

onMounted(async () => {
  await nextTick();
  scrollToBottom();
});
</script>

<template>
  <div
    ref="messageListRef"
    class="message-list"
    @scroll="updateAutoScrollState"
  >
    <div v-if="!conversationId" class="empty-state">
      <div class="empty-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <p class="empty-title">{{ isDirectMode ? '选择模型开始对话' : '开始新的对话' }}</p>
      <p class="empty-desc">{{ isDirectMode ? '在下方选择提供商和模型，然后发送消息' : '选择一个 Swarm 并发送消息开始协作' }}</p>
      <div v-if="!isDirectMode && swarms.length > 0" class="swarm-grid">
        <button
          v-for="swarm in swarms"
          :key="swarm.id"
          class="swarm-card"
          :class="{ active: props.swarmId === swarm.id }"
          @click="selectSwarm(swarm.id)"
        >
          <div class="swarm-card-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <div class="swarm-card-info">
            <span class="swarm-card-name">{{ swarm.name }}</span>
            <span class="swarm-card-meta">{{ swarm.agents.length }} 个 Agent · {{ MODE_LABEL_ZH[swarm.mode] ?? swarm.mode }}</span>
          </div>
        </button>
      </div>
    </div>
    <div v-else class="messages-container">
      <MessageItem
        v-for="entry in renderEntries"
        :key="messageRenderKey(entry)"
        :message="entry.message"
        :streaming="entry.streaming"
        :is-direct-mode="isDirectMode"
      />
    </div>
  </div>
</template>

<style scoped>
.message-list {
  flex: 1;
  overflow-y: auto;
  scrollbar-gutter: stable both-edges;
  padding: 16px 32px;
}

@supports not (scrollbar-gutter: stable) {
  .message-list {
    overflow-y: scroll;
  }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
  color: var(--color-text-muted);
}

.empty-icon {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 16px;
  border: 1px solid var(--color-border-subtle);
}

.empty-icon svg {
  width: 28px;
  height: 28px;
  color: var(--color-text-muted);
}

.empty-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin: 0;
}

.empty-desc {
  font-size: 14px;
  color: var(--color-text-muted);
  margin: 0;
}

.swarm-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
  max-width: 680px;
  margin-top: 4px;
}

.swarm-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-subtle);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
  backdrop-filter: blur(8px);
}

.swarm-card:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--color-border-hover);
}

.swarm-card.active {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.3);
}

.swarm-card-icon {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(139, 92, 246, 0.15));
  border-radius: 8px;
  flex-shrink: 0;
}

.swarm-card.active .swarm-card-icon {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(139, 92, 246, 0.25));
}

.swarm-card-icon svg {
  width: 18px;
  height: 18px;
  color: var(--color-accent-light);
}

.swarm-card-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.swarm-card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.swarm-card.active .swarm-card-name {
  color: var(--color-accent-light);
}

.swarm-card-meta {
  font-size: 11px;
  color: var(--color-text-muted);
}

.messages-container {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 900px;
  margin: 0 auto;
}
</style>
