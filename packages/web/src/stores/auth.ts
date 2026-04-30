import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { clearAllCaches } from "../utils/cache-keys.js";
import { useAgentStore } from "./agents.js";
import { useConversationStore } from "./conversation.js";
import { useSettingsStore } from "./settings.js";
import { useSwarmStore } from "./swarm.js";

async function apiRequest(method: string, path: string, body?: unknown) {
  const token = localStorage.getItem("token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const resp = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error ?? "请求失败");
  return data.data;
}

export const useAuthStore = defineStore("auth", () => {
  const token = ref<string | null>(localStorage.getItem("token"));
  const user = ref<{ id: string; username: string; role: "admin" | "user" } | null>(
    restoreFromCache<{ id: string; username: string; role: "admin" | "user" }>("cached-user"),
  );

  const isAuthenticated = computed(() => !!token.value);

  function saveUserCache(userData: typeof user.value) {
    if (userData) {
      localStorage.setItem("cached-user", JSON.stringify(userData));
    } else {
      localStorage.removeItem("cached-user");
    }
  }

  function restoreFromCache<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      localStorage.removeItem(key);
      return null;
    }
  }

  function resetClientStores() {
    useConversationStore().reset();
    useSwarmStore().reset();
    useAgentStore().reset();
    useSettingsStore().reset();
  }

  async function clearAuthState() {
    token.value = null;
    user.value = null;
    localStorage.removeItem("token");
    localStorage.removeItem("cached-user");
    await clearAllCaches();
    resetClientStores();
  }

  async function login(username: string, password: string) {
    const result = await apiRequest("POST", "/api/auth/login", { username, password });
    await clearAllCaches();
    resetClientStores();
    token.value = result.token;
    user.value = result.user;
    localStorage.setItem("token", result.token);
    saveUserCache(result.user);
  }

  async function register(username: string, password: string) {
    const result = await apiRequest("POST", "/api/auth/register", { username, password });
    await clearAllCaches();
    resetClientStores();
    token.value = result.token;
    user.value = result.user;
    localStorage.setItem("token", result.token);
    saveUserCache(result.user);
  }

  async function logout() {
    try {
      if (token.value) {
        await apiRequest("POST", "/api/auth/logout");
      }
    } catch {
      // ignore logout request failure and clear local session anyway
    } finally {
      await clearAuthState();
    }
  }

  async function fetchMe() {
    if (!token.value) return;
    try {
      const result = await apiRequest("GET", "/api/auth/me");
      user.value = result;
      saveUserCache(result);
    } catch {
      await clearAuthState();
    }
  }

  return { token, user, isAuthenticated, login, register, logout, fetchMe };
});
