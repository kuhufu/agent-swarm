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
    <div class="auth-bg">
      <div class="orb orb-1" />
      <div class="orb orb-2" />
      <div class="orb orb-3" />
    </div>
    <div class="auth-card">
      <div class="auth-card-inner">
        <div class="auth-header">
          <div class="auth-logo">
            <div class="logo-glow" />
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
            <span v-if="loading" class="btn-loading-spinner" />
            {{ loading ? "注册中..." : "注册" }}
          </button>
        </form>

        <div class="auth-footer">
          已有账户？
          <router-link to="/login" class="auth-link">登录</router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  position: relative;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-gradient);
  overflow: hidden;
}

/* ── Animated background orbs ── */
.auth-bg {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.4;
}

.orb-1 {
  width: 400px;
  height: 400px;
  background: radial-gradient(circle, #6366f1, #8b5cf6, transparent);
  top: -10%;
  right: -5%;
  animation: float 8s ease-in-out infinite;
}

.orb-2 {
  width: 350px;
  height: 350px;
  background: radial-gradient(circle, #a78bfa, #818cf8, transparent);
  bottom: -10%;
  left: -5%;
  animation: float-delayed 10s ease-in-out infinite;
}

.orb-3 {
  width: 250px;
  height: 250px;
  background: radial-gradient(circle, #6366f1, transparent);
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  animation: float 12s ease-in-out infinite;
  opacity: 0.25;
}

/* ── Card ── */
.auth-card {
  position: relative;
  width: 380px;
  border-radius: 24px;
  background: var(--glass-bg);
  backdrop-filter: blur(20px) saturate(1.3);
  -webkit-backdrop-filter: blur(20px) saturate(1.3);
  border: 1px solid var(--color-border-default);
  box-shadow: var(--shadow-dialog),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  animation: scaleIn 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.auth-card::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: 25px;
  background: linear-gradient(
    135deg,
    rgba(99, 102, 241, 0.2),
    transparent 30%,
    transparent 70%,
    rgba(139, 92, 246, 0.15)
  );
  z-index: -1;
  pointer-events: none;
}

.auth-card-inner {
  padding: 40px 32px 32px;
}

.auth-header {
  text-align: center;
  margin-bottom: 32px;
}

.auth-logo {
  position: relative;
  width: 52px;
  height: 52px;
  margin: 0 auto 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--color-accent), #8b5cf6);
  border-radius: 14px;
  color: #fff;
}

.logo-glow {
  position: absolute;
  inset: -4px;
  border-radius: 18px;
  background: var(--color-accent-glow);
  filter: blur(8px);
  opacity: 0.5;
  animation: pulseSoft 2s ease-in-out infinite;
}

.auth-logo svg {
  width: 28px;
  height: 28px;
  position: relative;
  z-index: 1;
}

.auth-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0 0 4px;
  letter-spacing: -0.3px;
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
  padding: 11px;
  font-size: 15px;
  margin-top: 8px;
  gap: 8px;
}

.btn-loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin-slow 0.6s linear infinite;
}

.auth-footer {
  text-align: center;
  margin-top: 28px;
  font-size: 13px;
  color: var(--color-text-muted);
}

.auth-link {
  color: var(--color-accent);
  text-decoration: none;
  font-weight: 500;
  transition: color 0.2s;
}

.auth-link:hover {
  color: var(--color-accent-light);
  text-decoration: underline;
}
</style>
