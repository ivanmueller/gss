import { useEffect, useState } from 'react';

export interface MeOrganization {
  id: string;
  name: string;
  role: string;
}

export type MeState =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'ok';
      name: string | null;
      /** No first name yet: the app asks for it before anything else. */
      nameMissing: boolean;
      /** Signed in with a temporary password: the app asks for their own first. */
      mustChangePassword: boolean;
      organizations: MeOrganization[];
    }
  | { status: 'error' };

function stringProperty(body: unknown, key: string): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** "Ivan M.": first name and last initial; the first name alone; or null without one. */
export function displayName(firstName: string | null, lastName: string | null): string | null {
  if (firstName === null) return null;
  const first = lastName === null ? undefined : lastName.codePointAt(0);
  const initial = first === undefined ? '' : ` ${String.fromCodePoint(first).toUpperCase()}.`;
  return `${firstName}${initial}`;
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

/**
 * Asks the API who the signed-in user is, proving the server accepted the session. A new
 * `version` asks again (after the person chose a password or gave their name).
 */
export function useMe(accessToken: string | null, version = 0): MeState {
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
            ? {
                status: 'ok',
                name: displayName(
                  stringProperty(body, 'firstName'),
                  stringProperty(body, 'lastName'),
                ),
                nameMissing: stringProperty(body, 'firstName') === null,
                mustChangePassword:
                  typeof body === 'object' &&
                  body !== null &&
                  (body as Record<string, unknown>).mustChangePassword === true,
                organizations: readOrganizations(body),
              }
            : { status: 'error' },
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      });
    return () => {
      controller.abort();
    };
  }, [accessToken, version]);

  return state;
}
