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

const saved = () => Promise.resolve({ status: 'saved' } as const);

/** A Database whose every method is a mock; reads return empty results and writes succeed by default. */
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
    facilitiesInBbox: vi.fn<Database['facilitiesInBbox']>(() =>
      Promise.resolve({ facilities: [], withoutCoordinates: 0 }),
    ),
    facilitiesWithoutCoordinates: vi.fn<Database['facilitiesWithoutCoordinates']>(() =>
      Promise.resolve([]),
    ),
    saveCoordinates: vi.fn<Database['saveCoordinates']>(() => Promise.resolve([])),
    getLogo: vi.fn<Database['getLogo']>(() => Promise.resolve(null)),
    putLogo: vi.fn<Database['putLogo']>(() =>
      Promise.resolve({ status: 'saved', sha256: 'f'.repeat(64) }),
    ),
    existingCounterparties: vi.fn<Database['existingCounterparties']>(() => Promise.resolve([])),
    importCounterparties: vi.fn<Database['importCounterparties']>(() =>
      Promise.resolve('00000000-0000-4000-8000-0000000ba7c4'),
    ),
    isOrgAdmin: vi.fn<Database['isOrgAdmin']>(() => Promise.resolve(true)),
    setMemberNames: vi.fn<Database['setMemberNames']>(() => Promise.resolve(true)),
    listMembers: vi.fn<Database['listMembers']>(() => Promise.resolve([])),
    addMember: vi.fn<Database['addMember']>(() =>
      Promise.resolve({ status: 'added', id: '00000000-0000-4000-8000-00000000ae01' }),
    ),
    updateMember: vi.fn<Database['updateMember']>(() => saved()),
    createCounterparty: vi.fn<Database['createCounterparty']>(() =>
      Promise.resolve({ status: 'created', id: '00000000-0000-4000-8000-00000000c0de' }),
    ),
    updateCounterparty: vi.fn<Database['updateCounterparty']>(() => saved()),
    setArchived: vi.fn<Database['setArchived']>(() => saved()),
    addContact: vi.fn<Database['addContact']>(() => saved()),
    updateContact: vi.fn<Database['updateContact']>(() => saved()),
    removeContact: vi.fn<Database['removeContact']>(() => saved()),
    setMainContact: vi.fn<Database['setMainContact']>(() => saved()),
    changeCommodities: vi.fn<Database['changeCommodities']>(() => saved()),
    addFacility: vi.fn<Database['addFacility']>(() => saved()),
    updateFacility: vi.fn<Database['updateFacility']>(() => saved()),
    removeFacility: vi.fn<Database['removeFacility']>(() => saved()),
    listCommodities: vi.fn<Database['listCommodities']>(() => Promise.resolve([])),
    canEnterQuotes: vi.fn<Database['canEnterQuotes']>(() => Promise.resolve(true)),
    listQuotes: vi.fn<Database['listQuotes']>(() => Promise.resolve([])),
    getQuote: vi.fn<Database['getQuote']>(() => Promise.resolve(null)),
    createQuote: vi.fn<Database['createQuote']>(() =>
      Promise.resolve({ status: 'created', id: '00000000-0000-4000-8000-00000000a001' }),
    ),
    reviseQuote: vi.fn<Database['reviseQuote']>(() => saved()),
    withdrawQuote: vi.fn<Database['withdrawQuote']>(() => saved()),
    listFreight: vi.fn<Database['listFreight']>(() => Promise.resolve([])),
    getFreight: vi.fn<Database['getFreight']>(() => Promise.resolve(null)),
    createFreight: vi.fn<Database['createFreight']>(() =>
      Promise.resolve({ status: 'created', id: '00000000-0000-4000-8000-00000000e001' }),
    ),
    reviseFreight: vi.fn<Database['reviseFreight']>(() => saved()),
    withdrawFreight: vi.fn<Database['withdrawFreight']>(() => saved()),
    listContactLog: vi.fn<Database['listContactLog']>(() => Promise.resolve([])),
    getContactLogEntry: vi.fn<Database['getContactLogEntry']>(() => Promise.resolve(null)),
    createContactLog: vi.fn<Database['createContactLog']>(() =>
      Promise.resolve({
        status: 'created',
        id: '00000000-0000-4000-8000-00000000e101',
        followUpId: null,
      }),
    ),
    correctContactLog: vi.fn<Database['correctContactLog']>(() => saved()),
    listFollowUps: vi.fn<Database['listFollowUps']>(() => Promise.resolve([])),
    countFollowUps: vi.fn<Database['countFollowUps']>(() =>
      Promise.resolve({ overdue: 0, dueToday: 0 }),
    ),
    teamNames: vi.fn<Database['teamNames']>(() => Promise.resolve([])),
    getFollowUp: vi.fn<Database['getFollowUp']>(() => Promise.resolve(null)),
    createFollowUp: vi.fn<Database['createFollowUp']>(() =>
      Promise.resolve({ status: 'created', id: '00000000-0000-4000-8000-00000000f101' }),
    ),
    updateFollowUp: vi.fn<Database['updateFollowUp']>(() => saved()),
    finishFollowUp: vi.fn<Database['finishFollowUp']>(() => saved()),
    removeFollowUp: vi.fn<Database['removeFollowUp']>(() => saved()),
    listFxQuotes: vi.fn<Database['listFxQuotes']>(() => Promise.resolve([])),
    storeBankOfCanadaRates: vi.fn<Database['storeBankOfCanadaRates']>((rates) =>
      Promise.resolve(rates.map((rate) => ({ rate, outcome: 'stored' as const }))),
    ),
    close: vi.fn<Database['close']>(() => Promise.resolve()),
  };
}
