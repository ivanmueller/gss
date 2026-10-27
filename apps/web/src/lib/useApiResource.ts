import { useCallback, useEffect, useState } from 'react';

import { apiJson, ApiError } from './api';

export type Resource<T> =
  { status: 'loading' } | { status: 'ok'; data: T } | { status: 'error'; error: ApiError };

/** GETs an API path as the signed-in user, again whenever the path or token changes or reload is called. */
export function useApiResource<T>(path: string | null, token: string): [Resource<T>, () => void] {
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
        if (!controller.signal.aborted)
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

  // While a reload of the same path runs, keep showing the last result; a different path
  // shows loading until its first result lands.
  return [state?.path === path ? state.resource : { status: 'loading' }, reload];
}
