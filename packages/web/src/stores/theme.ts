import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";

export type ThemeMode = "dark" | "light" | "auto";
const THEME_MODE_KEY = "theme-mode";
const THEME_MODES: ThemeMode[] = ["auto", "light", "dark"];

function restoreThemeMode(): ThemeMode {
  const stored = localStorage.getItem(THEME_MODE_KEY);
  return THEME_MODES.includes(stored as ThemeMode) ? stored as ThemeMode : "auto";
}

function getSystemTheme(): "dark" | "light" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export const useThemeStore = defineStore("theme", () => {
  const mode = ref<ThemeMode>(restoreThemeMode());
  const systemTheme = ref<"dark" | "light">(getSystemTheme());

  const resolvedTheme = computed(() =>
    mode.value === "auto" ? systemTheme.value : mode.value,
  );

  function applyTheme(theme: "dark" | "light") {
    document.documentElement.setAttribute("data-theme", theme);
  }

  // Watch for mode changes and apply
  watch([mode, resolvedTheme], ([nextMode, nextTheme]) => {
    localStorage.setItem(THEME_MODE_KEY, nextMode);
    applyTheme(nextTheme);
  }, { immediate: true });

  // Listen for system theme changes when in auto mode
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  function onSystemThemeChange() {
    systemTheme.value = getSystemTheme();
  }
  mediaQuery.addEventListener("change", onSystemThemeChange);

  function setMode(newMode: ThemeMode) {
    mode.value = newMode;
  }

  function cycleMode() {
    const idx = THEME_MODES.indexOf(mode.value);
    mode.value = THEME_MODES[(idx + 1) % THEME_MODES.length];
  }

  return { mode, resolvedTheme, setMode, cycleMode };
});
