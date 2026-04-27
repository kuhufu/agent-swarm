import { defineStore } from "pinia";
import { ref, watch } from "vue";

export const useThemeStore = defineStore("theme", () => {
  const current = ref<"dark" | "light">(
    (localStorage.getItem("theme") as "dark" | "light") ?? "dark",
  );

  watch(current, (val) => {
    localStorage.setItem("theme", val);
    document.documentElement.setAttribute("data-theme", val);
  }, { immediate: true });

  function toggle() {
    current.value = current.value === "dark" ? "light" : "dark";
  }

  return { current, toggle };
});
