import { vi } from 'vitest';

import type { Database } from '../db';

// Shared by the API unit tests. Everything here is synthetic.

export const ENV = {
  SUPABASE_URL: 'https://example-project.supabase.co/',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  DATABASE_URL: 'postgresql://app_api.ref:secret@db.example.test:6543/postgres',
};
export const USER_ID = '00000000-0000-4000-8000-00000000a11c';

/** An unsigned token with the given claims; only Supabase Auth (mocked here) judges validity. */
export function token(claims: Record<string, unknown>): string {
  const part = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${part({ alg: 'ES256', typ: 'JWT' })}.${part(claims)}.signature`;
}

/** A signed-in user with two-factor authentication. */
export const VALID_TOKEN = token({ sub: USER_ID, aal: 'aal2' });

/** Answers every Supabase Auth call with a fresh copy of the response (or the error). */
export function mockAuthServer(response: Response | Error) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response.clone()),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

type Mocked<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown
    ? ReturnType<typeof vi.fn<T[K]>>
    : never;
};

/** A Database whose every method is a mock; reads return empty results by default. */
export function fakeDatabase(): Mocked<Database> {
  return {
    memberships: vi.fn<Database['memberships']>(() =>
      Promise.resolve([
        { organizationId: 'org-a', organizationName: 'Synthetic Org A', role: 'trader' },
      ]),
    ),
    canEditDirectory: vi.fn<Database['canEditDirectory']>(() => Promise.resolve(true)),
    listCounterparties: vi.fn<Database['listCounterparties']>(() => Promise.resolve([])),
    getCounterparty: vi.fn<Database['getCounterparty']>(() => Promise.resolve(null)),
    getLogo: vi.fn<Database['getLogo']>(() => Promise.resolve(null)),
    putLogo: vi.fn<Database['putLogo']>(() =>
      Promise.resolve({ status: 'saved', sha256: 'f'.repeat(64) }),
    ),
    counterpartyKeys: vi.fn<Database['counterpartyKeys']>(() => Promise.resolve(new Set<string>())),
    importCounterparties: vi.fn<Database['importCounterparties']>(() =>
      Promise.resolve('00000000-0000-4000-8000-0000000ba7c4'),
    ),
    close: vi.fn<Database['close']>(() => Promise.resolve()),
  };
}
