import { useSyncExternalStore } from 'react';

// Demo data: whether the workspace shows the made-up sellers, buyers and prices of
// data/synthetic.ts. The profile menu's Demo data switch turns it on and off; the choice is
// kept in this browser (localStorage) and is off until someone turns it on. While it is on,
// "Demo" shows beside the GSS name on every page, so made-up prices are never taken for real
// ones (owner's decision, docs/DECISIONS.md).

export const DEMO_STORAGE_KEY = 'gss.demo';
const CHANGE = 'app:demo';

/** The saved choice; off when nothing is saved or storage is blocked. */
export function readDemoData(): boolean {
  try {
    return window.localStorage.getItem(DEMO_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

// The choice in force, kept here so it also lasts for the session when storage is blocked.
let current: boolean | null = null;

function snapshot(): boolean {
  current ??= readDemoData();
  return current;
}

/** Saves the choice and applies it, here and in the app's other open tabs. */
export function setDemoData(on: boolean) {
  try {
    if (on) window.localStorage.setItem(DEMO_STORAGE_KEY, 'on');
    else window.localStorage.removeItem(DEMO_STORAGE_KEY);
  } catch {
    // Storage blocked: the choice still holds until the page reloads.
  }
  current = on;
  window.dispatchEvent(new Event(CHANGE));
}

function subscribe(onChange: () => void) {
  const stored = (event: StorageEvent) => {
    // Another tab changed the choice (a null key means storage was cleared).
    if (event.key !== DEMO_STORAGE_KEY && event.key !== null) return;
    current = readDemoData();
    onChange();
  };
  window.addEventListener(CHANGE, onChange);
  window.addEventListener('storage', stored);
  return () => {
    window.removeEventListener(CHANGE, onChange);
    window.removeEventListener('storage', stored);
  };
}

/** Whether demo data is on, and a setter, for the switch and the pages that show it. */
export function useDemoData(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribe, snapshot), setDemoData];
}
