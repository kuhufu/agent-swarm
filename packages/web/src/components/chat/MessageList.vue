<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type { ChatMessage, SwarmConfig } from "../../types/index.js";
import { useSwarmStore } from "../../stores/swarm.js";
import MessageItem from "./MessageItem.vue";

const props = defineProps<{
  messages: ChatMessage[];
  streamingMessages: ChatMessage[];
  isDirectMode?: boolean;
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

function selectSwarm(swarm: SwarmConfig) {
  swarmStore.selectSwarm(swarm);
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

const renderEntries = computed<RenderEntry[]>(() => {
  const byId = new Map<string, RenderEntry>();

  for (const msg of visibleMessages.value) {
    byId.set(msg.id, { message: msg, streaming: false });
  }

  for (const msg of props.streamingMessages) {
    byId.set(msg.id, { message: msg, streaming: true });
  }

  return Array.from(byId.values()).sort((a, b) => {
    if (a.message.timestamp !== b.message.timestamp) {
      return a.message.timestamp - b.message.timestamp;
    }
    return a.message.id.localeCompare(b.message.id);
  });
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
    <div v-if="renderEntries.length === 0" class="empty-state">
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
          :class="{ active: swarmStore.currentSwarm?.id === swarm.id }"
          @click="selectSwarm(swarm)"
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
            <span class="swarm-card-meta">{{ swarm.agents.length }} 个 Agent · {{ modeLabels[swarm.mode] ?? swarm.mode }}</span>
          </div>
        </button>
      </div>
    </div>
    <div v-else class="messages-container">
      <MessageItem
        v-for="entry in renderEntries"
        :key="entry.message.id"
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
  padding: 24px 32px;
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
