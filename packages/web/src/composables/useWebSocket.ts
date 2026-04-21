import { ref, onUnmounted } from "vue";
import type { WSMessage } from "../types/index.js";

export function useWebSocket() {
  const ws = ref<WebSocket | null>(null);
  const connected = ref(false);
  const reconnectAttempts = ref(0);
  const maxReconnectAttempts = 10;

  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws`;

    ws.value = new WebSocket(url);

    ws.value.onopen = () => {
      connected.value = true;
      reconnectAttempts.value = 0;
    };

    ws.value.onclose = () => {
      connected.value = false;
      scheduleReconnect();
    };

    ws.value.onerror = () => {
      connected.value = false;
    };

    ws.value.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data);
        handleMessage(msg);
      } catch {
        console.error("Failed to parse WS message");
      }
    };
  }

  function scheduleReconnect() {
    if (reconnectAttempts.value >= maxReconnectAttempts) return;

    const delay = Math.min(1000 * 2 ** reconnectAttempts.value, 30000);
    reconnectAttempts.value++;

    reconnectTimer = setTimeout(() => {
      connect();
    }, delay);
  }

  function send(msg: WSMessage) {
    if (ws.value?.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify(msg));
    }
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    ws.value?.close();
  }

  // TODO: wire up message handlers to stores
  function handleMessage(_msg: WSMessage) {
    // Will be implemented to dispatch to stores
  }

  onUnmounted(() => {
    disconnect();
  });

  return { ws, connected, connect, disconnect, send };
}
