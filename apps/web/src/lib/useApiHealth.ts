import { useEffect, useState } from 'react';

export type ApiHealth = 'checking' | 'ok' | 'unreachable';

function isHealthy(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'status' in body && body.status === 'ok';
}

/** Calls the same-origin GET /api/v1/health once. */
export function useApiHealth(): ApiHealth {
  const [health, setHealth] = useState<ApiHealth>('checking');

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/v1/health', { signal: controller.signal })
      .then(async (res) => {
        const body: unknown = await res.json();
        if (!controller.signal.aborted) setHealth(res.ok && isHealthy(body) ? 'ok' : 'unreachable');
      })
      .catch(() => {
        if (!controller.signal.aborted) setHealth('unreachable');
      });
    return () => {
      controller.abort();
    };
  }, []);

  return health;
}
