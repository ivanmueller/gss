import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  geocodeAddresses,
  GeocoderError,
  geocodioQuery,
  matchFor,
  matchSigner,
  MATCH_LIFETIME_MS,
  proposeCoordinates,
  type FacilityAddress,
  type GeocodioResult,
} from './geocoding';

// Every address and result here is synthetic.
const ORG = '00000000-0000-4000-8000-0000000000aa';
const NOW = new Date('2026-10-27T18:00:00.000Z');

function facility(overrides: Partial<FacilityAddress> = {}): FacilityAddress {
  return {
    facilityId: '00000000-0000-4000-8000-00000000fac1',
    counterpartyId: '00000000-0000-4000-8000-00000000c0aa',
    legalName: 'Synthetic Prairie Mills',
    facilityName: 'Synthetic Elevator',
    addressLine: '1 Synthetic Road',
    city: 'Synthetic Town',
    region: 'SK',
    postalCode: 'S4P 3Y2',
    country: 'CA',
    ...overrides,
  };
}

function result(overrides: Partial<GeocodioResult> = {}): GeocodioResult {
  return {
    latitude: 52.1332144,
    longitude: -106.6700458,
    accuracyType: 'rooftop',
    confidence: 0.97,
    formattedAddress: '1 Synthetic Rd, Synthetic Town, SK S4P',
    country: 'CA',
    region: 'SK',
    ...overrides,
  };
}

/** Geocodio's batch answer for keyed queries: one best result per key, or none. */
function geocodioAnswer(byKey: Record<string, object | null>) {
  return Response.json({
    results: Object.fromEntries(
      Object.entries(byKey).map(([key, found]) => [
        key,
        { query: {}, response: { input: {}, results: found ? [found] : [] } },
      ]),
    ),
  });
}

const ROOFTOP = {
  address_components: { state_province: 'SK', country: 'CA' },
  formatted_address: '1 Synthetic Rd, Synthetic Town, SK S4P',
  location: { lat: 52.1332144, lng: -106.6700458 },
  accuracy: 0.97,
  accuracy_type: 'rooftop',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('geocodioQuery', () => {
  it('sends the address parts only, with Geocodio’s country names', () => {
    expect(geocodioQuery(facility())).toEqual({
      street: '1 Synthetic Road',
      city: 'Synthetic Town',
      state_province: 'SK',
      postal_code: 'S4P 3Y2',
      country: 'Canada',
    });
    expect(
      geocodioQuery(facility({ addressLine: null, postalCode: null, region: 'ND', country: 'US' })),
    ).toEqual({ city: 'Synthetic Town', state_province: 'ND', country: 'USA' });
  });

  it('has nothing to look up without a street, city or postal code', () => {
    expect(geocodioQuery(facility({ addressLine: null, city: null, postalCode: null }))).toBeNull();
  });
});

describe('geocodeAddresses', () => {
  it('posts one batch to Geocodio v2 with the key in a header, keyed by facility', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(geocodioAnswer({ a: ROOFTOP, b: null })),
    );
    const found = await geocodeAddresses(
      'synthetic-key',
      new Map([
        ['a', { city: 'Synthetic Town', country: 'Canada' }],
        ['b', { city: 'Nowhere', country: 'USA' }],
      ]),
      fetchMock,
    );

    expect(found.get('a')).toEqual(result());
    expect(found.get('b')).toBeNull();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.geocod.io/v2/geocode?limit=1');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-key');
    expect(JSON.parse(init?.body as string)).toEqual({
      a: { city: 'Synthetic Town', country: 'Canada' },
      b: { city: 'Nowhere', country: 'USA' },
    });
  });

  it('does not call Geocodio with nothing to look up', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    expect(await geocodeAddresses('synthetic-key', new Map(), fetchMock)).toEqual(new Map());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores a result without usable coordinates', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        geocodioAnswer({
          a: { ...ROOFTOP, location: { lat: 'north', lng: 1 } },
          b: { ...ROOFTOP, location: { lat: 95, lng: 1 } },
        }),
      ),
    );
    const found = await geocodeAddresses(
      'synthetic-key',
      new Map([
        ['a', { city: 'A' }],
        ['b', { city: 'B' }],
      ]),
      fetchMock,
    );
    expect([...found.values()]).toEqual([null, null]);
  });

  it.each([
    [403, 'refused'],
    [401, 'refused'],
    [429, 'refused'],
    [500, 'unavailable'],
  ] as const)('reports HTTP %i as %s', async (status, kind) => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ error: 'Synthetic error' }, { status })),
    );
    await expect(
      geocodeAddresses('synthetic-key', new Map([['a', { city: 'A' }]]), fetchMock),
    ).rejects.toMatchObject({ kind, status });
  });

  it('reports an unreachable Geocodio or an unreadable answer as unavailable', async () => {
    const query = new Map([['a', { city: 'A' }]]);
    await expect(
      geocodeAddresses('synthetic-key', query, () => Promise.reject(new TypeError('network'))),
    ).rejects.toBeInstanceOf(GeocoderError);
    await expect(
      geocodeAddresses('synthetic-key', query, () => Promise.resolve(new Response('not json'))),
    ).rejects.toMatchObject({ kind: 'unavailable' });
  });
});

describe('matchFor', () => {
  it('rounds to six decimals and treats address-level results as exact', () => {
    expect(matchFor(facility(), result(), NOW)).toEqual({
      miss: null,
      match: {
        latitude: '52.133214',
        longitude: '-106.670046',
        precision: 'exact',
        accuracyType: 'rooftop',
        confidence: '0.97',
        formattedAddress: '1 Synthetic Rd, Synthetic Town, SK S4P',
        regionMatches: true,
        expiresAt: new Date(NOW.getTime() + MATCH_LIFETIME_MS).toISOString(),
      },
    });
    for (const accuracyType of ['point', 'range_interpolation', 'nearest_rooftop_match']) {
      expect(matchFor(facility(), result({ accuracyType }), NOW).match?.precision).toBe('exact');
    }
  });

  it('treats a street or town as approximate', () => {
    for (const accuracyType of ['street_center', 'place', 'something_new']) {
      expect(matchFor(facility(), result({ accuracyType }), NOW).match?.precision).toBe(
        'approximate',
      );
    }
  });

  it('offers nothing for a missing, province-wide or foreign result', () => {
    expect(matchFor(facility(), null, NOW)).toEqual({ match: null, miss: 'NOT_FOUND' });
    expect(matchFor(facility(), result({ accuracyType: 'state' }), NOW).miss).toBe('TOO_VAGUE');
    expect(matchFor(facility(), result({ accuracyType: 'county' }), NOW).miss).toBe('TOO_VAGUE');
    expect(matchFor(facility(), result({ country: 'US', region: 'ND' }), NOW).miss).toBe(
      'OTHER_COUNTRY',
    );
    expect(matchFor(facility(), result({ country: null }), NOW).miss).toBe('OTHER_COUNTRY');
  });

  it('flags a result in another province or state', () => {
    expect(matchFor(facility(), result({ region: 'MB' }), NOW).match?.regionMatches).toBe(false);
    expect(matchFor(facility(), result({ region: 'Saskatchewan' }), NOW).match?.regionMatches).toBe(
      true,
    );
    expect(
      matchFor(facility({ region: null }), result({ region: 'MB' }), NOW).match?.regionMatches,
    ).toBe(true);
  });
});

describe('matchSigner', () => {
  const match = {
    facilityId: '00000000-0000-4000-8000-00000000fac1',
    latitude: '52.133214',
    longitude: '-106.670046',
    precision: 'exact' as const,
    accuracyType: 'rooftop',
    confidence: '0.97',
    expiresAt: '2026-10-27T19:00:00.000Z',
  };

  it('accepts only the match it signed, for that organization and key', async () => {
    const signer = await matchSigner('synthetic-key');
    const signature = await signer.sign(ORG, match);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(await signer.verify(ORG, { ...match, signature })).toBe(true);

    expect(await signer.verify(ORG, { ...match, latitude: '52.133215', signature })).toBe(false);
    expect(await signer.verify(ORG, { ...match, precision: 'approximate', signature })).toBe(false);
    expect(
      await signer.verify(ORG, { ...match, expiresAt: '2026-10-28T19:00:00.000Z', signature }),
    ).toBe(false);
    expect(
      await signer.verify('00000000-0000-4000-8000-0000000000bb', { ...match, signature }),
    ).toBe(false);
    const other = await matchSigner('another-synthetic-key');
    expect(await other.verify(ORG, { ...match, signature })).toBe(false);
  });
});

describe('proposeCoordinates', () => {
  it('looks up only facilities with an address and signs every match, in order', async () => {
    const withAddress = facility();
    const withoutAddress = facility({
      facilityId: '00000000-0000-4000-8000-00000000fac2',
      addressLine: null,
      city: null,
      postalCode: null,
    });
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(geocodioAnswer({ [withAddress.facilityId]: ROOFTOP })),
    );
    const proposals = await proposeCoordinates(
      'synthetic-key',
      ORG,
      [withAddress, withoutAddress],
      NOW,
      fetchMock,
    );

    expect(proposals.map((p) => [p.facilityId, p.miss, p.match?.precision])).toEqual([
      [withAddress.facilityId, null, 'exact'],
      [withoutAddress.facilityId, 'NO_ADDRESS', undefined],
    ]);
    expect(proposals[0]).toMatchObject({
      legalName: 'Synthetic Prairie Mills',
      address: { addressLine: '1 Synthetic Road', region: 'SK', country: 'CA' },
    });
    const sent = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as Record<
      string,
      unknown
    >;
    expect(Object.keys(sent)).toEqual([withAddress.facilityId]);
    expect(JSON.stringify(sent)).not.toContain('Synthetic Prairie Mills');

    const signer = await matchSigner('synthetic-key');
    const first = proposals[0]?.match;
    expect(
      first && (await signer.verify(ORG, { facilityId: withAddress.facilityId, ...first })),
    ).toBe(true);
  });
});
