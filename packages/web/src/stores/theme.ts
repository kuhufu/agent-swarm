import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";

export type ThemeMode = "dark" | "light" | "auto";

function getSystemTheme(): "dark" | "light" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export const useThemeStore = defineStore("theme", () => {
  const mode = ref<ThemeMode>(
    (localStorage.getItem("theme-mode") as ThemeMode) ?? "auto",
  );

  const resolvedTheme = computed(() =>
    mode.value === "auto" ? getSystemTheme() : mode.value,
  );

  function applyTheme(theme: "dark" | "light") {
    document.documentElement.setAttribute("data-theme", theme);
  }

  // Watch for mode changes and apply
  watch(resolvedTheme, (val) => {
    localStorage.setItem("theme-mode", mode.value);
    applyTheme(val);
  }, { immediate: true });

  // Listen for system theme changes when in auto mode
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  function onSystemThemeChange() {
    if (mode.value === "auto") {
      applyTheme(getSystemTheme());
    }
  }
  mediaQuery.addEventListener("change", onSystemThemeChange);

  function setMode(newMode: ThemeMode) {
    mode.value = newMode;
  }

  function cycleMode() {
    const order: ThemeMode[] = ["auto", "light", "dark"];
    const idx = order.indexOf(mode.value);
    mode.value = order[(idx + 1) % order.length];
  }

  return { mode, resolvedTheme, setMode, cycleMode };
});
