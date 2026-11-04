import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type ComponentProps,
  type MouseEvent,
} from 'react';

// A minimal client-side router: the Worker serves index.html for every non-API path,
// and these helpers keep the address bar and the rendered page in step.

const NAVIGATE = 'app:navigate';

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATE, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATE, onChange);
  };
}

/**
 * What each history entry remembers (owner's request, 2026-11-04): where the page was scrolled
 * when it was left, and the address the new page was opened from, so Back returns to the same
 * place with the same filters.
 */
interface EntryState {
  scrollY?: number;
  from?: string;
}

function entryState(): EntryState {
  const state: unknown = window.history.state;
  return typeof state === 'object' && state !== null ? state : {};
}

function here(): string {
  return `${window.location.pathname}${window.location.search}`;
}

export function navigate(to: string) {
  // The page being left keeps its scroll position, for when Back returns to it.
  window.history.replaceState({ ...entryState(), scrollY: window.scrollY }, '', here());
  window.history.pushState({ from: here() } satisfies EntryState, '', to);
  window.dispatchEvent(new Event(NAVIGATE));
}

/**
 * Back to `path` (e.g. "/counterparties"): when this page was opened from it, the browser's own
 * Back, which returns to it as it was (its filters in the address, its scroll position);
 * otherwise opens `path`.
 */
export function goBackTo(path: string) {
  const from = entryState().from;
  if (from !== undefined && new URL(from, window.location.origin).pathname === path) {
    window.history.back();
  } else {
    navigate(path);
  }
}

/**
 * Once the page's content is shown (`ready`), scrolls back to where it was when it was left,
 * when Back returned to it; a page opened afresh starts at the top.
 */
export function useRestoredScroll(ready: boolean) {
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    const y = entryState().scrollY;
    if (y !== undefined) window.scrollTo(0, y);
  }, [ready]);
}

/** Like navigate, but replaces the current entry, so Back skips it (old addresses, view options). */
export function redirect(to: string) {
  // The entry keeps what it remembers (where it was opened from).
  window.history.replaceState({ from: entryState().from }, '', to);
  window.dispatchEvent(new Event(NAVIGATE));
}

/** The current path, e.g. "/counterparties". */
export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

/** The current query string, e.g. "?view=map". */
export function useSearch(): string {
  return useSyncExternalStore(subscribe, () => window.location.search);
}

/**
 * Sets (or, with null, removes) query parameters of the current address without a new history
 * entry, so a view or filter survives a reload and can be shared as a link.
 */
export function setSearchParams(changes: Record<string, string | null>) {
  const params = new URLSearchParams(window.location.search);
  for (const [name, value] of Object.entries(changes)) {
    if (value === null) params.delete(name);
    else params.set(name, value);
  }
  const query = params.toString();
  redirect(`${window.location.pathname}${query ? `?${query}` : ''}`);
}

export type Route =
  | { page: 'workspace' }
  | { page: 'counterparties' }
  | { page: 'counterparty'; id: string }
  | { page: 'team' }
  | { page: 'quotes' }
  | { page: 'new-quote' }
  | { page: 'quote'; id: string }
  | { page: 'freight' }
  | { page: 'new-freight' }
  | { page: 'freight-rate'; id: string }
  | { page: 'follow-ups' }
  /** An old address that now lives elsewhere. */
  | { page: 'redirect'; to: string }
  | { page: 'not-found' };

export function matchRoute(path: string): Route {
  const trimmed = path.replace(/\/+$/, '') || '/';
  if (trimmed === '/') return { page: 'workspace' };
  // The map moved into Counterparties (owner's request, 2026-10-28).
  if (trimmed === '/map') return { page: 'redirect', to: '/counterparties?view=map' };
  // Coordinates are found when counterparties are added, and on their pages (2026-10-30).
  if (trimmed === '/map/coordinates' || trimmed === '/counterparties/coordinates')
    return { page: 'redirect', to: '/counterparties' };
  if (trimmed === '/team') return { page: 'team' };
  if (trimmed === '/counterparties') return { page: 'counterparties' };
  // Adding moved into the + button's window (owner's request, 2026-10-30).
  if (trimmed === '/counterparties/new') return { page: 'redirect', to: '/counterparties?add=one' };
  if (trimmed === '/counterparties/import')
    return { page: 'redirect', to: '/counterparties?add=import' };
  const match = /^\/counterparties\/([0-9a-f-]{36})$/i.exec(trimmed);
  if (match?.[1]) return { page: 'counterparty', id: match[1] };
  if (trimmed === '/quotes') return { page: 'quotes' };
  if (trimmed === '/quotes/new') return { page: 'new-quote' };
  const quote = /^\/quotes\/([0-9a-f-]{36})$/i.exec(trimmed);
  if (quote?.[1]) return { page: 'quote', id: quote[1] };
  if (trimmed === '/follow-ups') return { page: 'follow-ups' };
  if (trimmed === '/freight') return { page: 'freight' };
  if (trimmed === '/freight/new') return { page: 'new-freight' };
  const freight = /^\/freight\/([0-9a-f-]{36})$/i.exec(trimmed);
  if (freight?.[1]) return { page: 'freight-rate', id: freight[1] };
  return { page: 'not-found' };
}

/** An <a> that navigates without reloading, except when the user asks for a new tab. */
export function Link({ href, onClick, ...props }: ComponentProps<'a'> & { href: string }) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    navigate(href);
  }
  return <a href={href} onClick={handleClick} {...props} />;
}
