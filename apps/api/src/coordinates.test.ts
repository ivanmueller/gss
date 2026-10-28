import { GEOCODE_LIMIT, signedMatchOf, type GeocodeLookup, type SignedMatch } from '@grain/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { matchSigner, type FacilityAddress } from './geocoding';
import { createApp } from './index';
import { ENV, fakeDatabase, USER_ID, VALID_TOKEN } from './testing/helpers';

// POST /api/v1/facilities/geocode and /coordinates. Every address and result is synthetic.
let db = fakeDatabase();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
const app = createApp(openDatabase);

const KEY = 'synthetic-geocodio-key';
const WITH_KEY = { ...ENV, GEOCODIO_API_KEY: KEY };
const ORG = '00000000-0000-4000-8000-0000000000aa';
const AUTH = { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' };

const MILLS: FacilityAddress = {
  facilityId: '00000000-0000-4000-8000-00000000fac1',
  counterpartyId: '00000000-0000-4000-8000-00000000c0aa',
  legalName: 'Synthetic Prairie Mills',
  facilityName: 'Synthetic Elevator',
  addressLine: '1 Synthetic Road',
  city: 'Synthetic Town',
  region: 'SK',
  postalCode: 'S4P 3Y2',
  country: 'CA',
  version: '2026-10-27T18:00:00.000000Z',
};
const NO_ADDRESS: FacilityAddress = {
  ...MILLS,
  facilityId: '00000000-0000-4000-8000-00000000fac2',
  addressLine: null,
  city: null,
  postalCode: null,
};

let geocodio: (init?: RequestInit) => Response;
let geocodioCalls: RequestInit[] = [];

beforeEach(() => {
  geocodio = () =>
    Response.json({
      results: {
        [MILLS.facilityId]: {
          response: {
            results: [
              {
                address_components: { state_province: 'SK', country: 'CA' },
                formatted_address: '1 Synthetic Rd, Synthetic Town, SK S4P',
                location: { lat: 52.1332144, lng: -106.6700458 },
                accuracy: 0.97,
                accuracy_type: 'rooftop',
              },
            ],
          },
        },
      },
    });
  geocodioCalls = [];
  // Supabase Auth confirms the user; api.geocod.io answers as `geocodio` says.
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      if (input.includes('/auth/v1/user')) {
        return Promise.resolve(Response.json({ id: USER_ID, email: 'olivia@example.test' }));
      }
      if (init) geocodioCalls.push(init);
      return Promise.resolve(geocodio(init));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  db = fakeDatabase();
  openDatabase.mockClear();
});

function post(path: string, body: unknown, env: object = WITH_KEY) {
  return app.request(
    `/api/v1/facilities/${path}`,
    { method: 'POST', headers: AUTH, body: JSON.stringify(body) },
    env,
  );
}

async function lookUp(): Promise<GeocodeLookup> {
  db.facilitiesWithoutCoordinates.mockResolvedValueOnce([MILLS, NO_ADDRESS]);
  const res = await post('geocode', { organizationId: ORG });
  expect(res.status).toBe(200);
  return res.json();
}

async function signedMatch(): Promise<SignedMatch> {
  const match = (await lookUp()).proposals[0]?.match;
  if (!match) throw new Error('no match');
  return signedMatchOf(MILLS.facilityId, match);
}

describe('POST /api/v1/facilities/geocode', () => {
  it('requires sign-in', async () => {
    const res = await app.request(
      '/api/v1/facilities/geocode',
      { method: 'POST', body: '{}' },
      WITH_KEY,
    );
    expect(res.status).toBe(401);
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('looks up the organization’s facilities without coordinates and saves nothing', async () => {
    const lookup = await lookUp();

    expect(db.facilitiesWithoutCoordinates).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      ORG,
      GEOCODE_LIMIT,
    );
    expect(lookup.truncated).toBe(false);
    expect(lookup.proposals).toMatchObject([
      {
        facilityId: MILLS.facilityId,
        legalName: 'Synthetic Prairie Mills',
        miss: null,
        match: {
          latitude: '52.133214',
          longitude: '-106.670046',
          precision: 'exact',
          accuracyType: 'rooftop',
          confidence: '0.97',
          regionMatches: true,
        },
      },
      { facilityId: NO_ADDRESS.facilityId, match: null, miss: 'NO_ADDRESS' },
    ]);
    expect(lookup.proposals[0]?.match?.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(geocodioCalls).toHaveLength(1);
    expect(new Headers(geocodioCalls[0]?.headers).get('authorization')).toBe(`Bearer ${KEY}`);
    expect(geocodioCalls[0]?.body as string).not.toContain('Synthetic Prairie Mills');
    expect(db.saveCoordinates).not.toHaveBeenCalled();
  });

  it('says when more facilities wait than one lookup covers', async () => {
    db.facilitiesWithoutCoordinates.mockResolvedValueOnce(
      Array.from({ length: GEOCODE_LIMIT + 1 }, (_, index) => ({
        ...NO_ADDRESS,
        facilityId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      })),
    );
    const lookup: GeocodeLookup = await (await post('geocode', { organizationId: ORG })).json();
    expect(lookup.proposals).toHaveLength(GEOCODE_LIMIT);
    expect(lookup.truncated).toBe(true);
  });

  it('is only for operations and admin members', async () => {
    db.canEditDirectory.mockResolvedValueOnce(false);
    const res = await post('geocode', { organizationId: ORG });
    expect(res.status).toBe(403);
    expect(db.facilitiesWithoutCoordinates).not.toHaveBeenCalled();
    expect(geocodioCalls).toHaveLength(0);
  });

  it('says so when no Geocodio key is set up', async () => {
    const res = await post('geocode', { organizationId: ORG }, ENV);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'GEOCODING_NOT_CONFIGURED' } });
  });

  it('refuses a malformed request', async () => {
    expect((await post('geocode', { organizationId: 'org-a' })).status).toBe(422);
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('reports a refused key without logging addresses', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    geocodio = () => Response.json({ error: 'Invalid API key' }, { status: 403 });
    db.facilitiesWithoutCoordinates.mockResolvedValueOnce([MILLS]);

    const res = await post('geocode', { organizationId: ORG });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: { code: 'GEOCODER_REFUSED' } });
    const logged = log.mock.calls.flat().join(' ');
    expect(logged).toContain('status=403');
    expect(logged).not.toContain('Synthetic');
  });

  it('reports Geocodio being down', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    geocodio = () => new Response('Service unavailable', { status: 503 });
    db.facilitiesWithoutCoordinates.mockResolvedValueOnce([MILLS]);
    const res = await post('geocode', { organizationId: ORG });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: { code: 'GEOCODER_UNAVAILABLE' } });
  });
});

describe('POST /api/v1/facilities/coordinates', () => {
  it('saves matches exactly as the lookup signed them', async () => {
    const match = await signedMatch();
    db.saveCoordinates.mockResolvedValueOnce([MILLS.facilityId]);

    const res = await post('coordinates', { organizationId: ORG, matches: [match] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: 1, skipped: 0 });
    expect(db.saveCoordinates).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      ORG,
      [match],
    );
  });

  it('reports matches the database did not save', async () => {
    const match = await signedMatch();
    const res = await post('coordinates', { organizationId: ORG, matches: [match] });
    expect(await res.json()).toEqual({ saved: 0, skipped: 1 });
  });

  it.each([
    ['moved coordinates', { latitude: '50.000000' }],
    ['a raised precision', { precision: 'exact', accuracyType: 'place' }],
    ['another facility', { facilityId: NO_ADDRESS.facilityId }],
    ['a later expiry', { expiresAt: '2099-01-01T00:00:00.000Z' }],
    ['another facility version', { facilityVersion: '2026-10-27T18:30:00.000000Z' }],
  ])('refuses a match with %s', async (_what, change) => {
    const match = { ...(await signedMatch()), ...change };
    const res = await post('coordinates', { organizationId: ORG, matches: [match] });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_MATCH' } });
    expect(db.saveCoordinates).not.toHaveBeenCalled();
  });

  it('refuses a match signed for another organization', async () => {
    const match = await signedMatch();
    const res = await post('coordinates', {
      organizationId: '00000000-0000-4000-8000-0000000000bb',
      matches: [match],
    });
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_MATCH' } });
  });

  it('refuses a match older than an hour', async () => {
    const signer = await matchSigner(KEY);
    const old = {
      facilityId: MILLS.facilityId,
      latitude: '52.133214',
      longitude: '-106.670046',
      precision: 'exact' as const,
      accuracyType: 'rooftop',
      confidence: '0.97',
      facilityVersion: '2026-10-27T18:00:00.000000Z',
      expiresAt: '2026-01-01T00:00:00.000Z',
    };
    const match = { ...old, signature: await signer.sign(ORG, old) };
    const res = await post('coordinates', { organizationId: ORG, matches: [match] });
    expect(await res.json()).toMatchObject({ error: { code: 'MATCH_EXPIRED' } });
    expect(db.saveCoordinates).not.toHaveBeenCalled();
  });

  it('refuses the same location twice and malformed values', async () => {
    const match = await signedMatch();
    expect(
      (await post('coordinates', { organizationId: ORG, matches: [match, match] })).status,
    ).toBe(422);
    expect(
      (
        await post('coordinates', {
          organizationId: ORG,
          matches: [{ ...match, latitude: '52.1' }],
        })
      ).status,
    ).toBe(422);
    expect((await post('coordinates', { organizationId: ORG, matches: [] })).status).toBe(422);
    expect(db.saveCoordinates).not.toHaveBeenCalled();
  });

  it('is only for operations and admin members, and needs the key to check matches', async () => {
    const match = await signedMatch();
    db.canEditDirectory.mockResolvedValueOnce(false);
    expect((await post('coordinates', { organizationId: ORG, matches: [match] })).status).toBe(403);
    expect((await post('coordinates', { organizationId: ORG, matches: [match] }, ENV)).status).toBe(
      503,
    );
    expect(db.saveCoordinates).not.toHaveBeenCalled();
  });
});
