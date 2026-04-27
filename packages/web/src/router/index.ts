import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      redirect: "/chat",
    },
    {
      path: "/chat/:conversationId?",
      name: "chat",
      component: () => import("../views/ChatView.vue"),
    },
    {
      path: "/swarms",
      name: "swarms",
      component: () => import("../views/SwarmsView.vue"),
    },
    {
      path: "/agents",
      name: "agents",
      component: () => import("../views/AgentsView.vue"),
    },
    {
      path: "/history",
      name: "history",
      component: () => import("../views/HistoryView.vue"),
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("../views/SettingsView.vue"),
    },
    {
      path: "/usage",
      name: "usage",
      component: () => import("../views/UsageView.vue"),
    },
  ],
});

export default router;
