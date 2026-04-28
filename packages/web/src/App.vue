<script setup lang="ts">
import { computed, onMounted } from "vue";
import { RouterView, useRoute } from "vue-router";
import AppSidebar from "./components/layout/AppSidebar.vue";
import { useThemeStore } from "./stores/theme.js";
import { useAuthStore } from "./stores/auth.js";

useThemeStore();

const route = useRoute();
const authStore = useAuthStore();

const showSidebar = computed(() => authStore.isAuthenticated && route.name !== "login" && route.name !== "register");

onMounted(() => {
  authStore.fetchMe();
});
</script>

<template>
  <div class="app-layout">
    <AppSidebar v-if="showSidebar" />
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
