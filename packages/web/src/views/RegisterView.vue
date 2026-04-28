<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { MessagePlugin } from "tdesign-vue-next";
import { useAuthStore } from "../stores/auth.js";

const authStore = useAuthStore();
const router = useRouter();
const username = ref("");
const password = ref("");
const confirmPassword = ref("");
const loading = ref(false);

async function handleRegister() {
  if (!username.value.trim() || !password.value) {
    await MessagePlugin.warning("请输入用户名和密码");
    return;
  }
  if (password.value !== confirmPassword.value) {
    await MessagePlugin.warning("两次密码不一致");
    return;
  }
  if (password.value.length < 6) {
    await MessagePlugin.warning("密码至少 6 个字符");
    return;
  }
  loading.value = true;
  try {
    await authStore.register(username.value.trim(), password.value);
    await MessagePlugin.success("注册成功");
    router.push("/chat");
  } catch (err: any) {
    await MessagePlugin.error(err.message ?? "注册失败");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card">
      <div class="auth-header">
        <div class="auth-logo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <h1 class="auth-title">Agent Swarm</h1>
        <p class="auth-subtitle">创建账户</p>
      </div>

      <form class="auth-form" @submit.prevent="handleRegister">
        <div class="form-field">
          <label>用户名</label>
          <input
            v-model="username"
            class="input-field"
            placeholder="至少 2 个字符"
            autocomplete="username"
            :disabled="loading"
          />
        </div>
        <div class="form-field">
          <label>密码</label>
          <input
            v-model="password"
            class="input-field"
            type="password"
            placeholder="至少 6 个字符"
            autocomplete="new-password"
            :disabled="loading"
          />
        </div>
        <div class="form-field">
          <label>确认密码</label>
          <input
            v-model="confirmPassword"
            class="input-field"
            type="password"
            placeholder="再次输入密码"
            autocomplete="new-password"
            :disabled="loading"
          />
        </div>
        <button class="btn-primary auth-btn" type="submit" :disabled="loading">
          {{ loading ? "注册中..." : "注册" }}
        </button>
      </form>

      <div class="auth-footer">
        已有账户？
        <router-link to="/login" class="auth-link">登录</router-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-gradient);
}

.auth-card {
  width: 360px;
  padding: 40px 32px 32px;
  background: var(--glass-bg);
  backdrop-filter: blur(16px);
  border: 1px solid var(--color-border-subtle);
  border-radius: 16px;
}

.auth-header {
  text-align: center;
  margin-bottom: 32px;
}

.auth-logo {
  width: 48px;
  height: 48px;
  margin: 0 auto 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-accent);
  border-radius: 12px;
  color: #fff;
}

.auth-logo svg {
  width: 28px;
  height: 28px;
}

.auth-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0 0 4px;
}

.auth-subtitle {
  font-size: 14px;
  color: var(--color-text-muted);
  margin: 0;
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-field label {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.form-field .input-field {
  width: 100%;
  box-sizing: border-box;
}

.auth-btn {
  width: 100%;
  padding: 10px;
  font-size: 15px;
  margin-top: 8px;
}

.auth-footer {
  text-align: center;
  margin-top: 24px;
  font-size: 13px;
  color: var(--color-text-muted);
}

.auth-link {
  color: var(--color-accent);
  text-decoration: none;
  font-weight: 500;
}

.auth-link:hover {
  text-decoration: underline;
}
</style>
