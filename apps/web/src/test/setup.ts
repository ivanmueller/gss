import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import { clearApiCache } from '../lib/useApiResource';

// jsdom has no ResizeObserver; Radix menus measure their trigger with it.
if (!('ResizeObserver' in window)) {
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: class {
      observe() {
        return undefined;
      }
      unobserve() {
        return undefined;
      }
      disconnect() {
        return undefined;
      }
    },
  });
}

// jsdom has no pointer capture or scrolling; the Radix dropdown (components/ui/select.tsx)
// calls them when it opens.
for (const name of ['hasPointerCapture', 'releasePointerCapture', 'scrollIntoView'] as const) {
  if (!(name in Element.prototype)) {
    Object.defineProperty(Element.prototype, name, {
      configurable: true,
      value: () => false,
    });
  }
}

afterEach(() => {
  cleanup();
  // Each test starts with no kept API answers (lib/useApiResource.ts).
  clearApiCache();
});
