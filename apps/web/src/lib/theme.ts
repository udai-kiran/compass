import { useSyncExternalStore } from "react";

/**
 * Client-side color-theme preference. Each theme re-tints the Tailwind v4
 * `--color-brand-*` / `--color-accent-*` variables via a `data-theme` attribute
 * on <html> (the override rules live in index.css). The choice is a pure UI
 * preference kept in localStorage — it never touches the API, so it works even
 * in the read-only demo session and applies on the unauthenticated landing.
 */
export interface ThemeOption {
  id: string;
  label: string;
  /** Representative swatch (the theme's brand-600 tone) for the picker. */
  swatch: string;
}

export const THEMES: ThemeOption[] = [
  { id: "emerald", label: "Emerald", swatch: "#059669" },
  { id: "ocean", label: "Ocean", swatch: "#2563eb" },
  { id: "indigo", label: "Indigo", swatch: "#4f46e5" },
  { id: "violet", label: "Violet", swatch: "#7c3aed" },
  { id: "rose", label: "Rose", swatch: "#e11d48" },
  { id: "amber", label: "Amber", swatch: "#d97706" },
];

export const DEFAULT_THEME = "emerald";
const STORAGE_KEY = "compass.theme";
const THEME_EVENT = "compass:theme-change";

function isThemeId(v: string | null): v is string {
  return v !== null && THEMES.some((t) => t.id === v);
}

export function getStoredTheme(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isThemeId(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function applyTheme(id: string): void {
  document.documentElement.dataset.theme = id;
}

export function setTheme(id: string): void {
  if (!isThemeId(id)) return;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage disabled (private mode) — still apply for this session.
  }
  applyTheme(id);
  window.dispatchEvent(new CustomEvent(THEME_EVENT));
}

/** Apply the saved theme before the app renders, to avoid a flash of default. */
export function initTheme(): void {
  applyTheme(getStoredTheme());
}

function subscribe(callback: () => void): () => void {
  // Custom event covers same-tab changes; `storage` syncs across tabs.
  window.addEventListener(THEME_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(THEME_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/** `[theme, setTheme]`, re-rendering on change (this tab or another). */
export function useTheme(): [string, (id: string) => void] {
  const theme = useSyncExternalStore(subscribe, getStoredTheme, () => DEFAULT_THEME);
  return [theme, setTheme];
}
