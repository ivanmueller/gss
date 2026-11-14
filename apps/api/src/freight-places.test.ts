import type { FreightPlaceAnswer } from '@grain/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { createApp } from './index';
import { ENV, fakeDatabase, USER_ID, VALID_TOKEN } from './testing/helpers';

// Freight rates between areas (F-235): finding a town with Geocodio, and saving its point only
// as the Worker signed it. Synthetic places and values only.
let db = fakeDatabase();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
const app = createApp(openDatabase);

const ORG = '00000000-0000-4000-8000-0000000000aa';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000bb';
const CARRIER = '00000000-0000-4000-8000-00000000d1aa';
const DESTINATION = '00000000-0000-4000-8000-000000000f1a';
const KEY = 'synthetic-geocodio-key';
const WITH_KEY = { ...ENV, GEOCODIO_API_KEY: KEY };
const AUTH = { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' };

let geocodio: () => Response;
let geocodioBodies: unknown[];

function found(extra: Record<string, unknown> = {}) {
  return Response.json({
    results: {
      area: {
        response: {
          results: [
            {
              location: { lat: 49.354, lng: -97.365 },
              accuracy: 0.9,
              accuracy_type: 'place',
              formatted_address: 'Synthetic Town A, MB, Canada',
              address_components: { country: 'CA', state_province: 'MB' },
              ...extra,
            },
          ],
        },
      },
    },
  });
}

beforeEach(() => {
  geocodio = () => found();
  geocodioBodies = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      if (input.includes('/auth/v1/user')) {
        return Promise.resolve(Response.json({ id: USER_ID, email: 'olivia@example.test' }));
      }
      geocodioBodies.push(JSON.parse(String(init?.body)));
      return Promise.resolve(geocodio());
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  db = fakeDatabase();
  openDatabase.mockClear();
});

function post(path: string, body: unknown, env: object = WITH_KEY) {
  return app.request(
    `/api/v1/freight-quotes${path}`,
    { method: 'POST', headers: AUTH, body: JSON.stringify(body) },
    env,
  );
}

async function find(text = 'Synthetic Town A, MB', region = 'CA-MB', organizationId = ORG) {
  const res = await post('/places', { organizationId, text, region });
  return { status: res.status, body: (await res.json()) as FreightPlaceAnswer };
}

const rate = (origin: unknown) => ({
  organizationId: ORG,
  carrierId: CARRIER,
  origin,
  destination: { facilityId: DESTINATION },
  mode: 'truck',
  values: { firmness: 'firm', rate: '335', currency: 'CAD', rateUnit: 'MT', sourceType: 'email' },
});

describe('finding a freight area (POST /freight-quotes/places)', () => {
  it('looks the town up in the province chosen, its repeated province left out', async () => {
    const { status, body } = await find();
    expect(status).toBe(200);
    expect(body).toMatchObject({
      status: 'found',
      sure: true,
      formattedAddress: 'Synthetic Town A, MB, Canada',
      match: { latitude: '49.354000', longitude: '-97.365000', precision: 'approximate' },
    });
    // Only the place and its province go to Geocodio.
    expect(geocodioBodies).toEqual([
      { area: { city: 'Synthetic Town A', state_province: 'MB', country: 'Canada' } },
    ]);
  });

  it('asks the person about a doubtful result', async () => {
    geocodio = () => found({ accuracy: 0.5 });
    expect((await find()).body).toMatchObject({ status: 'found', sure: false });
  });

  it('finds nothing for a result in another province, or only the province itself', async () => {
    geocodio = () => found({ address_components: { country: 'CA', state_province: 'SK' } });
    expect((await find()).body).toEqual({ status: 'not_found' });
    geocodio = () => found({ accuracy_type: 'state' });
    expect((await find()).body).toEqual({ status: 'not_found' });
    geocodio = () => Response.json({ results: { area: { response: { results: [] } } } });
    expect((await find()).body).toEqual({ status: 'not_found' });
  });

  it('refuses bad text or province before calling Geocodio, and roles that cannot enter freight', async () => {
    expect((await find('   ')).status).toBe(422);
    expect((await find('Town\u0007A')).status).toBe(422);
    expect((await find('Synthetic Town A', 'MB')).status).toBe(422);
    expect(geocodioBodies).toEqual([]);
    db.canEnterFreight.mockResolvedValueOnce(false);
    expect((await find()).status).toBe(403);
    expect(geocodioBodies).toEqual([]);
  });

  it('says when Geocodio is not set up or fails', async () => {
    const res = await post('/places', { organizationId: ORG, text: 'Town', region: 'CA-MB' }, ENV);
    expect(res.status).toBe(503);
    geocodio = () => new Response('busy', { status: 500 });
    expect((await find()).status).toBe(502);
  });
});

describe('saving a rate between areas (POST /freight-quotes)', () => {
  it('saves the point only as signed, for that text and province', async () => {
    const answer = (await find()).body;
    if (answer.status !== 'found') throw new Error('fixture');
    const res = await post(
      '',
      rate({ area: { text: 'Synthetic Town A, MB', region: 'CA-MB', match: answer.match } }),
    );
    expect(res.status).not.toBe(422);
    expect(db.createFreight).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        origin: {
          kind: 'area',
          text: 'Synthetic Town A, MB',
          region: 'CA-MB',
          point: { latitude: '49.354000', longitude: '-97.365000', precision: 'approximate' },
        },
        terms: expect.objectContaining({ validUntil: null }) as unknown,
      }),
    );
  });

  it('saves an area without a point when no match is sent', async () => {
    await post('', rate({ area: { text: 'Synthetic Town B', region: 'US-IN' } }));
    expect(db.createFreight).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        origin: { kind: 'area', text: 'Synthetic Town B', region: 'US-IN', point: null },
      }),
    );
  });

  it('refuses a match changed, for other text, another province, organization or expired', async () => {
    const answer = (await find()).body;
    if (answer.status !== 'found') throw new Error('fixture');
    const otherOrg = (await find('Synthetic Town A, MB', 'CA-MB', OTHER_ORG)).body;
    if (otherOrg.status !== 'found') throw new Error('fixture');
    const area = (extra: Record<string, unknown>) => ({
      area: { text: 'Synthetic Town A, MB', region: 'CA-MB', match: answer.match, ...extra },
    });
    for (const origin of [
      area({ match: { ...answer.match, latitude: '50.000000' } }),
      area({ text: 'Synthetic Town C, MB' }),
      area({ region: 'CA-SK' }),
      area({ match: otherOrg.match }),
      area({ match: { ...answer.match, expiresAt: '2020-01-01T00:00:00.000Z' } }),
    ]) {
      const res = await post('', rate(origin));
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ error: { code: 'BAD_PLACE_MATCH' } });
    }
    // Without the key no match can be checked, so none is saved.
    const res = await post('', rate(area({})), ENV);
    expect(await res.json()).toMatchObject({ error: { code: 'BAD_PLACE_MATCH' } });
    expect(db.createFreight).not.toHaveBeenCalled();
  });

  it('refuses an area without a known province or state, or with unshowable text', async () => {
    for (const origin of [
      { area: { text: 'Synthetic Town', region: 'XX-ZZ' } },
      { area: { text: '  ', region: 'CA-MB' } },
      { area: { text: 'Town\u0000A', region: 'CA-MB' } },
    ]) {
      expect((await post('', rate(origin))).status).toBe(422);
    }
    expect(db.createFreight).not.toHaveBeenCalled();
  });
});
