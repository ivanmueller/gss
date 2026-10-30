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

function cacheKey(path: string, token: string): string {
  return `${token}\n${path}`;
}

/** Forgets every kept answer: on sign-out, so the next person never sees them. */
export function clearApiCache(): void {
  answers.clear();
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
    version: number;
    resource: Resource<T>;
  } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    apiJson<T>(path, token, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        answers.set(cacheKey(path, token), data);
        setState({ path, version, resource: { status: 'ok', data } });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const apiError =
          error instanceof ApiError
            ? error
            : new ApiError(0, 'NETWORK', 'The server could not be reached.', null);
        setState({ path, version, resource: { status: 'error', error: apiError } });
      });
    return () => {
      controller.abort();
    };
  }, [path, token, version]);

  const reload = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);

  // While a reload of the same path runs, keep showing the last result. A different path
  // shows its kept answer if there is one, else loading (or, with keepPrevious, the last).
  if (state?.path === path) return [state.resource, reload];
  const kept = path === null ? undefined : answers.get(cacheKey(path, token));
  if (kept !== undefined) return [{ status: 'ok', data: kept as T }, reload];
  return [state && keepPrevious ? state.resource : { status: 'loading' }, reload];
}
