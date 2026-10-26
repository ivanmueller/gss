import { useSyncExternalStore } from 'react';

const noop = (): void => undefined;

// Some environments (older browsers, jsdom) expose no callable matchMedia.
function canMatchMedia(): boolean {
  return typeof Reflect.get(window, 'matchMedia') === 'function';
}

/** Tracks a CSS media query; returns `fallback` where matchMedia is unavailable. */
export function useMediaQuery(query: string, fallback: boolean): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (!canMatchMedia()) return noop;
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => {
        list.removeEventListener('change', onChange);
      };
    },
    () => (canMatchMedia() ? window.matchMedia(query).matches : fallback),
  );
}
