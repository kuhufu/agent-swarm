import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";

export type ThemeMode = "dark" | "light" | "auto";
const THEME_MODE_KEY = "theme-mode";
const ACCENT_COLOR_KEY = "accent-color";
const THEME_MODES: ThemeMode[] = ["auto", "light", "dark"];

export interface AccentPreset {
  name: string;
  accent: string;
  dark: {
    light: string;
    bg: string;
    glow: string;
  };
  light: {
    light: string;
    bg: string;
    glow: string;
  };
}

export const accentPresets: AccentPreset[] = [
  {
    name: "天空蓝 (默认)",
    accent: "#60a5fa",
    dark: { light: "#93c5fd", bg: "rgba(96,165,250,0.08)", glow: "rgba(96,165,250,0.2)" },
    light: { light: "#60a5fa", bg: "rgba(59,130,246,0.06)", glow: "rgba(59,130,246,0.15)" },
  },
  {
    name: "靛蓝",
    accent: "#6366f1",
    dark: { light: "#818cf8", bg: "rgba(99,102,241,0.08)", glow: "rgba(99,102,241,0.2)" },
    light: { light: "#818cf8", bg: "rgba(99,102,241,0.06)", glow: "rgba(99,102,241,0.15)" },
  },
  {
    name: "翡翠绿",
    accent: "#34d399",
    dark: { light: "#5eead4", bg: "rgba(52,211,153,0.08)", glow: "rgba(52,211,153,0.2)" },
    light: { light: "#5eead4", bg: "rgba(52,211,153,0.06)", glow: "rgba(52,211,153,0.15)" },
  },
  {
    name: "琥珀",
    accent: "#f59e0b",
    dark: { light: "#fbbf24", bg: "rgba(245,158,11,0.08)", glow: "rgba(245,158,11,0.2)" },
    light: { light: "#fbbf24", bg: "rgba(245,158,11,0.06)", glow: "rgba(245,158,11,0.15)" },
  },
  {
    name: "玫瑰红",
    accent: "#f43f5e",
    dark: { light: "#fb7185", bg: "rgba(244,63,94,0.08)", glow: "rgba(244,63,94,0.2)" },
    light: { light: "#fb7185", bg: "rgba(244,63,94,0.06)", glow: "rgba(244,63,94,0.15)" },
  },
  {
    name: "紫色",
    accent: "#a855f7",
    dark: { light: "#c084fc", bg: "rgba(168,85,247,0.08)", glow: "rgba(168,85,247,0.2)" },
    light: { light: "#c084fc", bg: "rgba(168,85,247,0.06)", glow: "rgba(168,85,247,0.15)" },
  },
];

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [0, 0, 0];
  return [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)];
}

function lightenColor(hex: string, percent: number): string {
  const [r, g, b] = hexToRgb(hex);
  const lr = Math.round(r + (255 - r) * percent / 100);
  const lg = Math.round(g + (255 - g) * percent / 100);
  const lb = Math.round(b + (255 - b) * percent / 100);
  return `#${lr.toString(16).padStart(2, "0")}${lg.toString(16).padStart(2, "0")}${lb.toString(16).padStart(2, "0")}`;
}

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
  const accentColor = ref<string | null>(null);

  const resolvedTheme = computed(() =>
    mode.value === "auto" ? systemTheme.value : mode.value,
  );

  function applyTheme(theme: "dark" | "light") {
    document.documentElement.setAttribute("data-theme", theme);
  }

  function isPresetColor(hex: string): boolean {
    return accentPresets.some((p) => p.accent === hex);
  }

  function applyAccent(hex: string | null) {
    const root = document.documentElement;
    if (!hex) {
      root.style.removeProperty("--color-accent");
      root.style.removeProperty("--color-accent-light");
      root.style.removeProperty("--color-accent-bg");
      root.style.removeProperty("--color-accent-glow");
      root.removeAttribute("data-accent-custom");
      return;
    }

    const preset = accentPresets.find((p) => p.accent === hex);
    if (preset) {
      root.removeAttribute("data-accent-custom");
      const theme = resolvedTheme.value;
      const v = preset[theme];
      root.style.setProperty("--color-accent", preset.accent);
      root.style.setProperty("--color-accent-light", v.light);
      root.style.setProperty("--color-accent-bg", v.bg);
      root.style.setProperty("--color-accent-glow", v.glow);
    } else {
      root.setAttribute("data-accent-custom", "");
      root.style.setProperty("--color-accent", hex);
      root.style.removeProperty("--color-accent-light");
      root.style.removeProperty("--color-accent-bg");
      root.style.removeProperty("--color-accent-glow");
    }
  }

  function setAccentColor(hex: string) {
    accentColor.value = hex;
    localStorage.setItem(ACCENT_COLOR_KEY, hex);
    applyAccent(hex);
  }

  function resetAccentColor() {
    accentColor.value = null;
    localStorage.removeItem(ACCENT_COLOR_KEY);
    applyAccent(null);
  }

  // Watch for mode changes and apply
  watch([mode, resolvedTheme], ([nextMode, nextTheme]) => {
    localStorage.setItem(THEME_MODE_KEY, nextMode);
    applyTheme(nextTheme);

    if (accentColor.value && isPresetColor(accentColor.value)) {
      const preset = accentPresets.find((p) => p.accent === accentColor.value);
      if (preset) {
        const v = preset[nextTheme];
        const root = document.documentElement;
        root.style.setProperty("--color-accent", preset.accent);
        root.style.setProperty("--color-accent-light", v.light);
        root.style.setProperty("--color-accent-bg", v.bg);
        root.style.setProperty("--color-accent-glow", v.glow);
      }
    }
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

  // Restore accent color from localStorage on init
  const savedAccent = localStorage.getItem(ACCENT_COLOR_KEY);
  if (savedAccent) {
    accentColor.value = savedAccent;
    applyAccent(savedAccent);
  }

  return { mode, resolvedTheme, accentColor, setMode, cycleMode, setAccentColor, resetAccentColor };
});
