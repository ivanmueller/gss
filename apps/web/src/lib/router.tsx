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

/** The current path, e.g. "/counterparties". */
export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

export type Route =
  | { page: 'workspace' }
  | { page: 'map' }
  | { page: 'counterparties' }
  | { page: 'import' }
  | { page: 'counterparty'; id: string }
  | { page: 'not-found' };

export function matchRoute(path: string): Route {
  const trimmed = path.replace(/\/+$/, '') || '/';
  if (trimmed === '/') return { page: 'workspace' };
  if (trimmed === '/map') return { page: 'map' };
  if (trimmed === '/counterparties') return { page: 'counterparties' };
  if (trimmed === '/counterparties/import') return { page: 'import' };
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
