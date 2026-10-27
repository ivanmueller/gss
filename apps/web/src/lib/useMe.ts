import { useEffect, useState } from 'react';

export type MeState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; email: string | null }
  | { status: 'error' };

/** Asks the API who the signed-in user is, proving the server accepted the session. */
export function useMe(accessToken: string | null): MeState {
  const [state, setState] = useState<MeState>({ status: accessToken ? 'loading' : 'idle' });

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    void fetch('/api/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    })
      .then(async (res) => {
        const body: unknown = await res.json();
        const email =
          typeof body === 'object' &&
          body !== null &&
          'email' in body &&
          typeof body.email === 'string'
            ? body.email
            : null;
        if (!controller.signal.aborted)
          setState(res.ok ? { status: 'ok', email } : { status: 'error' });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      });
    return () => {
      controller.abort();
    };
  }, [accessToken]);

  return state;
}
