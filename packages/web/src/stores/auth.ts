import { defineStore } from "pinia";
import { ref, computed } from "vue";

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
  const user = ref<{ id: string; username: string } | null>(null);

  const isAuthenticated = computed(() => !!token.value);

  function clearAuthState() {
    token.value = null;
    user.value = null;
    localStorage.removeItem("token");
  }

  async function login(username: string, password: string) {
    const result = await apiRequest("POST", "/api/auth/login", { username, password });
    token.value = result.token;
    user.value = result.user;
    localStorage.setItem("token", result.token);
  }

  async function register(username: string, password: string) {
    const result = await apiRequest("POST", "/api/auth/register", { username, password });
    token.value = result.token;
    user.value = result.user;
    localStorage.setItem("token", result.token);
  }

  async function logout() {
    try {
      if (token.value) {
        await apiRequest("POST", "/api/auth/logout");
      }
    } catch {
      // ignore logout request failure and clear local session anyway
    } finally {
      clearAuthState();
    }
  }

  async function fetchMe() {
    if (!token.value) return;
    try {
      const result = await apiRequest("GET", "/api/auth/me");
      user.value = result;
    } catch {
      clearAuthState();
    }
  }

  return { token, user, isAuthenticated, login, register, logout, fetchMe };
});
