<script setup lang="ts">
import { useRouter } from "vue-router";
import { useSwarmStore } from "../../stores/swarm.js";

const router = useRouter();
const swarmStore = useSwarmStore();

const navItems = [
  { label: "对话", route: "/chat" },
  { label: "Swarm", route: "/swarms" },
  { label: "历史", route: "/history" },
  { label: "设置", route: "/settings" },
];
</script>

<template>
  <header class="app-header">
    <div class="header-left">
      <h1 class="logo" @click="router.push('/')">Agent Swarm</h1>
      <span v-if="swarmStore.currentSwarm" class="swarm-badge">
        {{ swarmStore.currentSwarm.name }}
      </span>
    </div>
    <nav class="header-nav">
      <router-link
        v-for="item in navItems"
        :key="item.route"
        :to="item.route"
        class="nav-link"
        active-class="nav-link--active"
      >
        {{ item.label }}
      </router-link>
    </nav>
  </header>
</template>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  height: 56px;
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo {
  font-size: 18px;
  font-weight: 700;
  color: #e0e0e0;
  margin: 0;
  cursor: pointer;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.swarm-badge {
  padding: 2px 10px;
  background: rgba(99, 102, 241, 0.2);
  border-radius: 12px;
  font-size: 12px;
  color: #a5b4fc;
}

.header-nav {
  display: flex;
  gap: 4px;
}

.nav-link {
  padding: 6px 16px;
  border-radius: 8px;
  color: #888;
  text-decoration: none;
  font-size: 14px;
  transition: all 0.2s;
}

.nav-link:hover {
  color: #c0c0c0;
  background: rgba(255, 255, 255, 0.05);
}

.nav-link--active {
  color: #e0e0e0;
  background: rgba(99, 102, 241, 0.15);
}
</style>
