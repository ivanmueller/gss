import { useEffect, useState } from 'react';

export interface MeOrganization {
  id: string;
  name: string;
  role: string;
}

export type MeState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; email: string | null; organizations: MeOrganization[] }
  | { status: 'error' };

function readEmail(body: unknown): string | null {
  return typeof body === 'object' &&
    body !== null &&
    'email' in body &&
    typeof body.email === 'string'
    ? body.email
    : null;
}

function readOrganizations(body: unknown): MeOrganization[] {
  if (typeof body !== 'object' || body === null || !('organizations' in body)) return [];
  const list: unknown = body.organizations;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return [];
    const { id, name, role } = item as Record<string, unknown>;
    return typeof id === 'string' && typeof name === 'string' && typeof role === 'string'
      ? [{ id, name, role }]
      : [];
  });
}

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
        if (controller.signal.aborted) return;
        setState(
          res.ok
            ? { status: 'ok', email: readEmail(body), organizations: readOrganizations(body) }
            : { status: 'error' },
        );
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
