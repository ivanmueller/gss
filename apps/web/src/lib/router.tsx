import { useSyncExternalStore, type ComponentProps, type MouseEvent } from 'react';

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

export function navigate(to: string) {
  window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(NAVIGATE));
}

/** Like navigate, but replaces the current entry, so Back skips it (old addresses, view options). */
export function redirect(to: string) {
  window.history.replaceState(null, '', to);
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
  | { page: 'coordinates' }
  | { page: 'counterparties' }
  | { page: 'new-counterparty' }
  | { page: 'import' }
  | { page: 'counterparty'; id: string }
  /** An old address that now lives elsewhere. */
  | { page: 'redirect'; to: string }
  | { page: 'not-found' };

export function matchRoute(path: string): Route {
  const trimmed = path.replace(/\/+$/, '') || '/';
  if (trimmed === '/') return { page: 'workspace' };
  // The map moved into Counterparties (owner's request, 2026-10-28).
  if (trimmed === '/map') return { page: 'redirect', to: '/counterparties?view=map' };
  if (trimmed === '/map/coordinates')
    return { page: 'redirect', to: '/counterparties/coordinates' };
  if (trimmed === '/counterparties') return { page: 'counterparties' };
  if (trimmed === '/counterparties/new') return { page: 'new-counterparty' };
  if (trimmed === '/counterparties/import') return { page: 'import' };
  if (trimmed === '/counterparties/coordinates') return { page: 'coordinates' };
  const match = /^\/counterparties\/([0-9a-f-]{36})$/i.exec(trimmed);
  if (match?.[1]) return { page: 'counterparty', id: match[1] };
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
