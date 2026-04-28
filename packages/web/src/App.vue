<script setup lang="ts">
import { onMounted } from "vue";
import { RouterView } from "vue-router";
import AppSidebar from "./components/layout/AppSidebar.vue";
import { useThemeStore } from "./stores/theme.js";
import { useAuthStore } from "./stores/auth.js";

useThemeStore();

const authStore = useAuthStore();
onMounted(() => {
  authStore.fetchMe();
});
</script>

<template>
  <div class="app-layout">
    <AppSidebar />
    <main class="app-main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  height: 100vh;
  background: var(--color-surface-0);
  color: var(--color-text-primary);
}

.app-main {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
