import { readFileSync } from 'node:fs';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ThemeModule = typeof import('./theme');

/** A fresh copy of the module, since it remembers the choice in force. */
async function load(): Promise<ThemeModule> {
  vi.resetModules();
  return import('./theme');
}

const listeners = new Set<() => void>();
let systemDark = false;

function setSystem(dark: boolean) {
  systemDark = dark;
  for (const listener of listeners) listener();
}

beforeEach(() => {
  systemDark = false;
  listeners.clear();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      get matches() {
        return query === '(prefers-color-scheme: dark)' && systemDark;
      },
      media: query,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }),
  });
});

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.style.colorScheme = '';
  Reflect.deleteProperty(window, 'matchMedia');
  vi.restoreAllMocks();
});

function isDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

describe('theme', () => {
  it('follows the device until the user chooses', async () => {
    const theme = await load();
    expect(theme.readThemePreference()).toBe('system');
    expect(theme.resolveTheme('system', true)).toBe('dark');
    expect(theme.resolveTheme('system', false)).toBe('light');
    expect(theme.resolveTheme('light', true)).toBe('light');
    expect(theme.resolveTheme('dark', false)).toBe('dark');
  });

  it('ignores a saved value it does not know, and blocked storage', async () => {
    window.localStorage.setItem('gss.theme', 'sepia');
    const theme = await load();
    expect(theme.readThemePreference()).toBe('system');

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(theme.readThemePreference()).toBe('system');
  });

  it('saves and applies a choice, and System removes it', async () => {
    const theme = await load();
    theme.setThemePreference('dark');
    expect(window.localStorage.getItem('gss.theme')).toBe('dark');
    expect(isDark()).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');

    theme.setThemePreference('system');
    expect(window.localStorage.getItem('gss.theme')).toBeNull();
    expect(isDark()).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('keeps a choice for the session when storage is blocked', async () => {
    const theme = await load();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => theme.useThemePreference());
    act(() => {
      result.current[1]('dark');
    });
    expect(result.current[0]).toBe('dark');
    expect(isDark()).toBe(true);
  });

  it('tracks the device setting live while on System', async () => {
    const theme = await load();
    const stop = theme.startThemeSync();
    expect(isDark()).toBe(false);

    setSystem(true);
    expect(isDark()).toBe(true);

    theme.setThemePreference('light');
    setSystem(true);
    expect(isDark()).toBe(false);
    stop();
  });

  it('applies a choice made in another tab', async () => {
    const theme = await load();
    const stop = theme.startThemeSync();
    const { result } = renderHook(() => theme.useThemePreference());

    act(() => {
      window.localStorage.setItem('gss.theme', 'dark');
      window.dispatchEvent(new StorageEvent('storage', { key: 'gss.theme' }));
    });
    expect(result.current[0]).toBe('dark');
    expect(isDark()).toBe(true);
    stop();
  });

  it('starts on the saved choice', async () => {
    window.localStorage.setItem('gss.theme', 'dark');
    const theme = await load();
    const stop = theme.startThemeSync();
    expect(isDark()).toBe(true);
    stop();
  });
});

describe('the pre-paint script in index.html', () => {
  // Vitest runs in apps/web.
  const html = readFileSync('index.html', 'utf8');
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

  function run() {
    // The script is the app's own, from index.html, and runs here exactly as the browser runs it.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const pagePaint = new Function(script) as () => void;
    pagePaint();
  }

  it('uses the same storage key as lib/theme.ts', async () => {
    const theme = await load();
    expect(script).toContain(`'${theme.THEME_STORAGE_KEY}'`);
  });

  it('chooses the theme by the same rules as lib/theme.ts', async () => {
    const theme = await load();
    for (const saved of [null, 'light', 'dark', 'sepia']) {
      for (const dark of [false, true]) {
        window.localStorage.clear();
        if (saved) window.localStorage.setItem('gss.theme', saved);
        systemDark = dark;
        run();
        const expected = theme.resolveTheme(theme.readThemePreference(), dark);
        expect(isDark(), `saved ${String(saved)}, system dark ${String(dark)}`).toBe(
          expected === 'dark',
        );
        expect(document.documentElement.style.colorScheme).toBe(expected);
      }
    }
  });

  it('follows the device when storage is blocked (Codex review)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    systemDark = true;
    run();
    expect(isDark()).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });
});
