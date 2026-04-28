import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      redirect: "/chat",
    },
    {
      path: "/login",
      name: "login",
      component: () => import("../views/LoginView.vue"),
    },
    {
      path: "/register",
      name: "register",
      component: () => import("../views/RegisterView.vue"),
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
      path: "/documents",
      name: "documents",
      component: () => import("../views/DocumentsView.vue"),
    },
  ],
});

router.beforeEach(async (to) => {
  const publicRoutes: string[] = ["login", "register"];
  if (publicRoutes.includes(to.name as string)) return true;

  const token = localStorage.getItem("token");
  if (!token) return "/login";

  return true;
});

export default router;
