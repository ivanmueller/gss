import { useSyncExternalStore } from 'react';

// Light and night (dark) themes. The colours live in styles/tokens/themes.css; this module
// only decides which one is on, by putting the `dark` class on <html>.
//
// The user's choice is kept in this browser (localStorage). "System" follows the device's
// light or dark setting, live. The small script in index.html applies the saved choice before
// the page first paints, so the app never flashes the wrong theme; keep the two in step.

export type ThemePreference = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'gss.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';
const CHANGE = 'app:theme';

function systemPrefersDark(): boolean {
  return typeof Reflect.get(window, 'matchMedia') === 'function'
    ? window.matchMedia(DARK_QUERY).matches
    : false;
}

/** The saved choice; "system" when nothing (or nothing valid) is saved or storage is blocked. */
export function readThemePreference(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): Theme {
  if (preference === 'system') return prefersDark ? 'dark' : 'light';
  return preference;
}

function apply(preference: ThemePreference) {
  const theme = resolveTheme(preference, systemPrefersDark());
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

// The choice in force: read from storage once, then kept here, so it also lasts for the
// session when storage is blocked (some private browsing modes).
let current: ThemePreference | null = null;

function snapshot(): ThemePreference {
  current ??= readThemePreference();
  return current;
}

/** Saves and applies a choice, here and in the app's other open tabs. */
export function setThemePreference(preference: ThemePreference) {
  try {
    if (preference === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage blocked: the choice still holds until the page reloads.
  }
  current = preference;
  apply(preference);
  window.dispatchEvent(new Event(CHANGE));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE, onChange);
  return () => {
    window.removeEventListener(CHANGE, onChange);
  };
}

/** The user's theme choice and a setter, for the theme menu. */
export function useThemePreference(): [ThemePreference, (preference: ThemePreference) => void] {
  return [useSyncExternalStore(subscribe, snapshot), setThemePreference];
}

/**
 * Applies the saved theme and keeps "System" in step with the device setting. Called once
 * by main.tsx; returns a function that stops listening.
 */
export function startThemeSync(): () => void {
  apply(snapshot());
  const stored = (event: StorageEvent) => {
    // Another tab changed the choice (a null key means storage was cleared).
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    current = readThemePreference();
    apply(current);
    window.dispatchEvent(new Event(CHANGE));
  };
  const follow = () => {
    if (snapshot() === 'system') apply('system');
  };
  const query =
    typeof Reflect.get(window, 'matchMedia') === 'function' ? window.matchMedia(DARK_QUERY) : null;
  window.addEventListener('storage', stored);
  query?.addEventListener('change', follow);
  return () => {
    window.removeEventListener('storage', stored);
    query?.removeEventListener('change', follow);
  };
}
