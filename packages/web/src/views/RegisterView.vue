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
      <div class="grid-overlay" />
    </div>
    <div class="auth-card">
      <div class="card-glow" />
      <div class="auth-card-inner">
        <div class="auth-header">
          <div class="auth-logo">
            <div class="logo-rings">
              <div class="ring ring-1" />
              <div class="ring ring-2" />
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1 class="auth-title">Agent Swarm</h1>
          <p class="auth-subtitle">创建新账户</p>
        </div>

        <form class="auth-form" @submit.prevent="handleRegister">
          <div class="form-field">
            <label>用户名</label>
            <div class="input-wrap">
              <SvgIcon class="input-icon" name="user" :size="15" />
              <input v-model="username" class="input-field" placeholder="至少 2 个字符" autocomplete="username" :disabled="loading" />
            </div>
          </div>
          <div class="form-field">
            <label>密码</label>
            <div class="input-wrap">
              <SvgIcon class="input-icon" name="lock" :size="15" />
              <input v-model="password" class="input-field" type="password" placeholder="至少 6 个字符" autocomplete="new-password" :disabled="loading" />
            </div>
          </div>
          <div class="form-field">
            <label>确认密码</label>
            <div class="input-wrap">
              <svg class="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 12l2 2 4-4" />
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <input v-model="confirmPassword" class="input-field" type="password" placeholder="再次输入密码" autocomplete="new-password" :disabled="loading" />
            </div>
          </div>
          <button class="auth-btn" type="submit" :disabled="loading">
            <span v-if="loading" class="btn-spinner" />
            <span>{{ loading ? "注册中..." : "创建账户" }}</span>
            <SvgIcon v-if="!loading" name="arrowRight" :size="16" />
          </button>
        </form>

        <div class="auth-footer">
          已有账户？
          <router-link to="/login" class="auth-link">立即登录</router-link>
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
  width: 600px; height: 600px;
  background: radial-gradient(circle, rgba(154, 170, 100, 0.18), rgba(154, 170, 100, 0.1), transparent 70%);
  top: -15%; right: -10%;
  animation: float 10s ease-in-out infinite;
}

.orb-2 {
  width: 500px; height: 500px;
  background: radial-gradient(circle, rgba(154, 170, 100, 0.12), rgba(154, 170, 100, 0.08), transparent 70%);
  bottom: -15%; left: -10%;
  animation: float-delayed 13s ease-in-out infinite;
}

.orb-3 {
  width: 300px; height: 300px;
  background: radial-gradient(circle, rgba(154, 170, 100, 0.05), transparent 70%);
  top: 40%; left: 30%;
  animation: float 16s ease-in-out infinite;
}

.grid-overlay {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(154, 170, 100, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(154, 170, 100, 0.04) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(ellipse at center, black 30%, transparent 80%);
}

.auth-card {
  position: relative;
  width: 400px;
  border-radius: var(--radius-xl);
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  box-shadow: var(--shadow-lg);
  animation: scaleIn 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.card-glow {
  position: absolute;
  inset: -1px;
  border-radius: calc(var(--radius-xl) + 1px);
  background: linear-gradient(135deg, rgba(154, 170, 100, 0.2) 0%, transparent 35%, transparent 65%, rgba(154, 170, 100, 0.15) 100%);
  z-index: -1;
  pointer-events: none;
  filter: blur(1px);
}

.auth-card-inner {
  padding: 44px 36px 36px;
}

.auth-header {
  text-align: center;
  margin-bottom: 32px;
}

.auth-logo {
  position: relative;
  width: 60px; height: 60px;
  margin: 0 auto 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-accent);
  border-radius: var(--radius-lg);
  color: #fff;
  box-shadow: 0 8px 24px var(--color-accent-glow);
}

.logo-rings {
  position: absolute;
  inset: -12px;
  pointer-events: none;
}

.ring {
  position: absolute;
  border-radius: 50%;
  border: 1px solid rgba(154, 170, 100, 0.2);
  animation: pulseSoft 3s ease-in-out infinite;
}

.ring-1 { inset: 0; }
.ring-2 { inset: -8px; border-color: rgba(154, 170, 100, 0.1); animation-delay: 0.5s; }

.auth-logo svg {
  width: 28px; height: 28px;
  position: relative; z-index: 1;
}

.auth-title {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.5px;
  background: linear-gradient(135deg, var(--text-primary) 0%, var(--color-accent-light) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin: 0 0 6px;
}

.auth-subtitle {
  font-size: var(--text-base);
  color: var(--text-muted);
  margin: 0;
  letter-spacing: 0.02em;
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
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
  left: 13px; top: 50%;
  transform: translateY(-50%);
  width: 15px; height: 15px;
  color: var(--text-muted);
  pointer-events: none;
  transition: color 0.2s;
}

.input-wrap:focus-within .input-icon {
  color: var(--text-secondary);
}

.input-wrap .input-field {
  padding-left: 38px;
  height: 44px;
  font-size: var(--text-base);
  border-radius: var(--radius-md);
}

.input-wrap .input-field:focus {
  background: var(--bg-hover);
}

.auth-btn {
  width: 100%;
  height: 46px;
  margin-top: 4px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-accent);
  color: white;
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
  letter-spacing: -0.01em;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 4px 16px var(--color-accent-glow);
}

.auth-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  background: var(--color-accent-light);
  box-shadow: 0 8px 24px var(--color-accent-glow);
}

.auth-btn:disabled { opacity: 0.55; cursor: not-allowed; }

.auth-btn svg { width: 16px; height: 16px; transition: transform 0.2s; }
.auth-btn:hover:not(:disabled) svg { transform: translateX(2px); }

.btn-spinner {
  width: 16px; height: 16px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin-slow 0.6s linear infinite;
  flex-shrink: 0;
}

.auth-footer {
  text-align: center;
  margin-top: 24px;
  font-size: var(--text-base);
  color: var(--text-muted);
}

.auth-link {
  color: var(--text-secondary);
  text-decoration: none;
  font-weight: var(--weight-bold);
  transition: color 0.2s;
}

.auth-link:hover { color: var(--text-secondary); }
</style>
