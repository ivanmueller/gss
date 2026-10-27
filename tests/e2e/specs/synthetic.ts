import type { Page } from '@playwright/test';

// The time the synthetic workspace data is read at, matching the web app's unit tests: every
// synthetic quote that should be live is live then (apps/web/src/data/synthetic.ts).
export const SYNTHETIC_NOW = new Date('2026-10-27T12:00:00Z');

/** Where the profile menu's Demo data switch keeps its choice (apps/web/src/lib/demo.ts). */
const DEMO_STORAGE_KEY = 'gss.demo';

/**
 * Shows the made-up workspace data at a fixed time: demo data on before the app loads (as
 * the profile menu's switch leaves it) and the clock set to SYNTHETIC_NOW.
 */
export async function showDemoData(page: Page) {
  await page.clock.setFixedTime(SYNTHETIC_NOW);
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, 'on');
  }, DEMO_STORAGE_KEY);
}
