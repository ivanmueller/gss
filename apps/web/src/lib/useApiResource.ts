import { useCallback, useEffect, useState } from 'react';

import { apiJson, ApiError } from './api';

export type Resource<T> =
  { status: 'loading' } | { status: 'ok'; data: T } | { status: 'error'; error: ApiError };

/**
 * The last answer to each path, for the person signed in (owner's request, 2026-10-30):
 * opening a page or view again shows it at once while it is checked again in the
 * background, instead of "Loading…" every time. Kept in memory only, never on disk, and
 * emptied on sign-out.
 */
const answers = new Map<string, unknown>();
/**
 * Moves on at each clearing, so an answer still on its way when the cache is emptied is not
 * kept afterwards (Codex's review of ivanmueller/gss#85).
 */
let generation = 0;

/**
 * Whose sign-in a token is: the person's id from the token (its `sub`), so an hourly token
 * renewal keeps the same person's answers and another person never gets them. Only the
 * server checks tokens; this decides only what may be shown again. A token that cannot be
 * read stands for itself.
 */
export function signedInAs(token: string): string {
  try {
    const payload = token.split('.')[1] ?? '';
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as unknown;
    if (typeof claims === 'object' && claims !== null && 'sub' in claims) {
      const sub = claims.sub;
      if (typeof sub === 'string' && sub !== '') return `user:${sub}`;
    }
  } catch {
    // Not a JWT: fall through.
  }
  return `token:${token}`;
}

function cacheKey(path: string, token: string): string {
  return `${signedInAs(token)}\n${path}`;
}

/** Forgets every kept answer: on sign-out, so the next person never sees them. */
export function clearApiCache(): void {
  answers.clear();
  generation += 1;
}

/**
 * GETs an API path as the signed-in user, again whenever the path or token changes or reload
 * is called. A path loaded before shows its last answer straight away while it loads again.
 * With `keepPrevious`, the last result stays while a different path loads (a map keeps its
 * pins while the next view loads).
 */
export function useApiResource<T>(
  path: string | null,
  token: string,
  { keepPrevious = false }: { keepPrevious?: boolean } = {},
): [Resource<T>, () => void] {
  const [state, setState] = useState<{
    path: string;
    /** Whose answer it is (signedInAs). */
    who: string;
    version: number;
    resource: Resource<T>;
  } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    const started = generation;
    apiJson<T>(path, token, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        if (started === generation) answers.set(cacheKey(path, token), data);
        setState({ path, who: signedInAs(token), version, resource: { status: 'ok', data } });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const apiError =
          error instanceof ApiError
            ? error
            : new ApiError(0, 'NETWORK', 'The server could not be reached.', null);
        setState({
          path,
          who: signedInAs(token),
          version,
          resource: { status: 'error', error: apiError },
        });
      });
    return () => {
      controller.abort();
    };
  }, [path, token, version]);

  const reload = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);

  // While a reload of the same path for the same person runs (a renewed token included),
  // keep showing the last result. A different path shows its kept answer if there is one,
  // else loading (or, with keepPrevious, the person's last result). Another person's result
  // is never shown (Codex's review of ivanmueller/gss#85).
  const own = state?.who === signedInAs(token) ? state : null;
  if (own?.path === path) return [own.resource, reload];
  const kept = path === null ? undefined : answers.get(cacheKey(path, token));
  if (kept !== undefined) return [{ status: 'ok', data: kept as T }, reload];
  return [own && keepPrevious ? own.resource : { status: 'loading' }, reload];
}
