<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { MessagePlugin } from "tdesign-vue-next";
import { useAuthStore } from "../stores/auth.js";
import SvgIcon from "../components/common/SvgIcon.vue";

const authStore = useAuthStore();
const router = useRouter();
const username = ref("");
const password = ref("");
const loading = ref(false);

async function handleLogin() {
  if (!username.value.trim() || !password.value) {
    await MessagePlugin.warning("请输入用户名和密码");
    return;
  }
  loading.value = true;
  try {
    await authStore.login(username.value.trim(), password.value);
    await MessagePlugin.success("登录成功");
    router.push("/chat");
  } catch (err: any) {
    await MessagePlugin.error(err.message ?? "登录失败");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="auth-page">
    <!-- Ambient background -->
    <div class="auth-bg">
      <div class="orb orb-1" />
      <div class="orb orb-2" />
      <div class="orb orb-3" />
      <div class="grid-overlay" />
    </div>

    <!-- Card -->
    <div class="auth-card">
      <div class="auth-card-inner">
        <!-- Header -->
        <div class="auth-header">
          <div class="auth-logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1 class="auth-title">Agent Swarm</h1>
          <p class="auth-subtitle">多智能体协作平台</p>
        </div>

        <!-- Form -->
        <form class="auth-form" @submit.prevent="handleLogin">
          <div class="form-field">
            <label>用户名</label>
            <div class="input-wrap">
              <SvgIcon class="input-icon" name="user" :size="15" />
              <input
                v-model="username"
                class="input-field"
                placeholder="输入用户名"
                autocomplete="username"
                :disabled="loading"
              />
            </div>
          </div>
          <div class="form-field">
            <label>密码</label>
            <div class="input-wrap">
              <SvgIcon class="input-icon" name="lock" :size="15" />
              <input
                v-model="password"
                class="input-field"
                type="password"
                placeholder="输入密码"
                autocomplete="current-password"
                :disabled="loading"
              />
            </div>
          </div>
          <button class="auth-btn" type="submit" :disabled="loading">
            <span v-if="loading" class="btn-spinner" />
            <span>{{ loading ? "登录中..." : "登录" }}</span>
            <SvgIcon v-if="!loading" name="arrowRight" :size="16" />
          </button>
        </form>

        <div class="auth-footer">
          还没有账户？
          <router-link to="/register" class="auth-link">立即注册</router-link>
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
  background: var(--bg-root);
  overflow: hidden;
}

/* ── Background ── */
.auth-bg {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
}

  .orb-1 {
    width: 600px;
    height: 600px;
    background: radial-gradient(circle, rgba(154, 170, 100, 0.12), rgba(154, 170, 100, 0.06), transparent 70%);
    top: -15%;
    right: -10%;
    animation: float 10s ease-in-out infinite;
  }

  .orb-2 {
    width: 500px;
    height: 500px;
    background: radial-gradient(circle, rgba(154, 170, 100, 0.08), rgba(154, 170, 100, 0.04), transparent 70%);
    bottom: -15%;
    left: -10%;
    animation: float-delayed 13s ease-in-out infinite;
  }

  .orb-3 {
    width: 300px;
    height: 300px;
    background: radial-gradient(circle, rgba(154, 170, 100, 0.05), transparent 70%);
    top: 40%;
    left: 30%;
    animation: float 16s ease-in-out infinite;
  }

  .grid-overlay {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(154, 170, 100, 0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(154, 170, 100, 0.03) 1px, transparent 1px);
    background-size: 48px 48px;
    mask-image: radial-gradient(ellipse at center, black 30%, transparent 80%);
  }

/* ── Card ── */
.auth-card {
  position: relative;
  width: 400px;
  border-radius: var(--radius-xl);
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  box-shadow: var(--shadow-lg);
  animation: scaleIn 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.auth-card-inner {
  padding: 44px 36px 36px;
}

/* ── Header ── */
.auth-header {
  text-align: center;
  margin-bottom: 36px;
}

  .auth-logo {
    position: relative;
    width: 60px;
    height: 60px;
    margin: 0 auto 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-hover);
    border-radius: var(--radius-lg);
    color: var(--text-primary);
  }

.auth-logo svg {
  width: 28px;
  height: 28px;
  position: relative;
  z-index: 1;
}

.auth-title {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.5px;
  color: var(--text-primary);
  margin: 0 0 6px;
}

.auth-subtitle {
  font-size: var(--text-base);
  color: var(--text-muted);
  margin: 0;
  letter-spacing: 0.02em;
}

/* ── Form ── */
.auth-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.form-field label {
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.input-wrap {
  position: relative;
}

.input-icon {
  position: absolute;
  left: 13px;
  top: 50%;
  transform: translateY(-50%);
  width: 15px;
  height: 15px;
  color: var(--text-muted);
  pointer-events: none;
  transition: color 0.2s;
}

.input-wrap:focus-within .input-icon {
  color: var(--text-secondary);
}

.input-wrap .input-field {
  padding-left: 38px;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: 10px;
  height: 44px;
  font-size: var(--text-base);
  transition: all 0.2s;
}

  .input-wrap .input-field:focus {
    border-color: var(--border-default);
    background: var(--bg-hover);
  }

  .auth-btn {
    width: 100%;
    height: 46px;
    margin-top: 6px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--bg-hover);
    color: var(--text-primary);
    font-size: var(--text-lg);
    font-weight: var(--weight-bold);
    letter-spacing: -0.01em;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .auth-btn:hover:not(:disabled) {
    transform: translateY(-1px);
  }

.auth-btn:active:not(:disabled) {
  transform: translateY(0);
}

.auth-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.auth-btn svg {
  width: 16px;
  height: 16px;
  transition: transform 0.2s;
}

.auth-btn:hover:not(:disabled) svg {
  transform: translateX(2px);
}

.btn-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-subtle);
  border-top-color: var(--text-primary);
  border-radius: 50%;
  animation: spin-slow 0.6s linear infinite;
  flex-shrink: 0;
}

/* ── Footer ── */
.auth-footer {
  text-align: center;
  margin-top: 28px;
  font-size: var(--text-base);
  color: var(--text-muted);
}

.auth-link {
  color: var(--text-secondary);
  text-decoration: none;
  font-weight: var(--weight-bold);
  transition: color 0.2s;
}

.auth-link:hover {
  color: var(--text-secondary);
}
</style>
