import type { DraftInput, FreightPlaceAnswer } from '@grain/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { createApp } from './index';
import { ENV, fakeDatabase, USER_ID, VALID_TOKEN } from './testing/helpers';

// Verifying Claude's freight rate drafts (F-235 part 2): who may, the towns placed on the map
// only when sure (one click) or as the Worker signed them (the form), and nothing saved when the
// lookup fails. Synthetic places and values only.
let db = fakeDatabase();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
const app = createApp(openDatabase);

const ORG = '00000000-0000-4000-8000-0000000000aa';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000bb';
const DRAFT = '00000000-0000-4000-8000-0000000d0f01';
const RATE = '00000000-0000-4000-8000-0000000ef001';
const KEY = 'synthetic-geocodio-key';
const WITH_KEY = { ...ENV, GEOCODIO_API_KEY: KEY };
const AUTH = { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' };

type FreightFields = Extract<DraftInput, { kind: 'freight' }>['fields'];
const FIELDS: FreightFields = {
  mode: 'truck',
  origin: { text: 'Synthetic Town A MB', region: 'CA-MB' },
  destination: { text: 'Synthetic Town B IN', region: 'US-IN' },
  values: {
    firmness: 'firm',
    rate: '335',
    currency: 'CAD',
    rateUnit: 'MT',
    quotedAt: '2026-11-13T16:00:00.000Z',
    sourceType: 'email',
  },
  checks: {},
};

let geocodio: (body: Record<string, Record<string, string>>) => Response;
let lookups: number;

function found(accuracy = 0.9, state = 'MB', country = 'CA') {
  return Response.json({
    results: {
      area: {
        response: {
          results: [
            {
              location: { lat: 49.354, lng: -97.365 },
              accuracy,
              accuracy_type: 'place',
              formatted_address: 'Synthetic Town, Somewhere',
              address_components: { country, state_province: state },
            },
          ],
        },
      },
    },
  });
}

beforeEach(() => {
  lookups = 0;
  geocodio = (body) =>
    body.area?.state_province === 'IN' ? found(0.5, 'IN', 'US') : found(0.9, 'MB', 'CA');
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      if (input.includes('/auth/v1/user')) {
        return Promise.resolve(Response.json({ id: USER_ID, email: 'olivia@example.test' }));
      }
      lookups += 1;
      return Promise.resolve(
        geocodio(
          JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<
            string,
            Record<string, string>
          >,
        ),
      );
    }),
  );
  db.draftToVerify.mockResolvedValue({
    kind: 'freight',
    organizationId: ORG,
    open: true,
    allowed: true,
    fields: FIELDS,
  });
  db.verifyCallDraft.mockResolvedValue({ status: 'verified', kind: 'freight', resultId: RATE });
});

afterEach(() => {
  vi.unstubAllGlobals();
  db = fakeDatabase();
  openDatabase.mockClear();
});

function verify(body: unknown = {}, env: object = WITH_KEY) {
  return app.request(
    `/api/v1/calls/drafts/${DRAFT}/verify`,
    { method: 'POST', headers: AUTH, body: JSON.stringify(body) },
    env,
  );
}

/** The route the database was asked to save. */
const savedRoute = () => db.verifyCallDraft.mock.calls[0]?.[5];

describe('verifying a freight draft in one click', () => {
  it('places a town found for sure, and leaves a doubtful one without a point', async () => {
    const response = await verify();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ verified: true, kind: 'freight', resultId: RATE });
    expect(savedRoute()).toEqual({
      origin: {
        kind: 'area',
        text: 'Synthetic Town A MB',
        region: 'CA-MB',
        point: { latitude: '49.354000', longitude: '-97.365000', precision: 'approximate' },
      },
      destination: { kind: 'area', text: 'Synthetic Town B IN', region: 'US-IN', point: null },
    });
    expect(lookups).toBe(2);
  });

  it('saves the towns without points when Geocodio is not set up', async () => {
    expect((await verify({}, ENV)).status).toBe(200);
    expect(savedRoute()).toMatchObject({ origin: { point: null }, destination: { point: null } });
    expect(lookups).toBe(0);
  });

  it('saves nothing when the lookup fails, so no point is lost for good', async () => {
    geocodio = () => new Response('down', { status: 500 });
    const response = await verify();
    expect(response.status).toBe(502);
    expect(db.verifyCallDraft).not.toHaveBeenCalled();
  });

  it('looks nothing up for a viewer or analyst, or a draft already decided (Codex, F-235-2-D1-01)', async () => {
    db.draftToVerify.mockResolvedValue({
      kind: 'freight',
      organizationId: ORG,
      open: true,
      allowed: false,
      fields: FIELDS,
    });
    expect((await verify()).status).toBe(403);
    db.draftToVerify.mockResolvedValue({
      kind: 'freight',
      organizationId: ORG,
      open: false,
      allowed: true,
      fields: FIELDS,
    });
    expect((await verify()).status).toBe(409);
    db.draftToVerify.mockResolvedValue(null);
    expect((await verify()).status).toBe(404);
    expect(lookups).toBe(0);
    expect(db.verifyCallDraft).not.toHaveBeenCalled();
  });

  it('looks nothing up for a draft that cannot be saved as it is', async () => {
    db.draftToVerify.mockResolvedValue({
      kind: 'freight',
      organizationId: ORG,
      open: true,
      allowed: true,
      fields: { ...FIELDS, mode: null, destination: { text: null, region: null } },
    });
    const response = await verify();
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: 'DRAFT_INCOMPLETE' },
      missing: expect.arrayContaining(['truck or rail']) as unknown,
    });
    expect(lookups).toBe(0);
    expect(db.verifyCallDraft).not.toHaveBeenCalled();
  });
});

describe('verifying a freight draft saved in the form', () => {
  /** A match the Worker signed, as POST /freight-quotes/places answers. */
  async function signed(text: string, region: string, organizationId = ORG) {
    const response = await app.request(
      '/api/v1/freight-quotes/places',
      { method: 'POST', headers: AUTH, body: JSON.stringify({ organizationId, text, region }) },
      WITH_KEY,
    );
    const answer = await response.json<FreightPlaceAnswer>();
    if (answer.status !== 'found') throw new Error('not found');
    return answer.match;
  }

  const edited = (origin: unknown, destination: unknown) => ({
    edited: {
      values: FIELDS.values as Record<string, string>,
      freight: { mode: 'rail', origin, destination },
    },
  });

  it('keeps a point only as the Worker signed it, for the draft organization', async () => {
    const match = await signed('Synthetic Town C, MB', 'CA-MB');
    lookups = 0;
    const response = await verify(
      edited(
        { area: { text: 'Synthetic Town C, MB', region: 'CA-MB', match } },
        { area: { text: 'Synthetic Town B IN', region: 'US-IN' } },
      ),
    );
    expect(response.status).toBe(200);
    expect(savedRoute()).toEqual({
      origin: {
        kind: 'area',
        text: 'Synthetic Town C, MB',
        region: 'CA-MB',
        point: { latitude: match.latitude, longitude: match.longitude, precision: match.precision },
      },
      destination: { kind: 'area', text: 'Synthetic Town B IN', region: 'US-IN', point: null },
    });
    // The form's own lookups placed the towns: Verify looks nothing up.
    expect(lookups).toBe(0);
    expect(db.verifyCallDraft.mock.calls[0]?.[4]).toMatchObject({
      edited: { freight: { mode: 'rail' } },
    });
  });

  it('refuses a match changed, for another place, or signed for another organization', async () => {
    const match = await signed('Synthetic Town C, MB', 'CA-MB');
    const other = await signed('Synthetic Town C, MB', 'CA-MB', OTHER_ORG);
    for (const origin of [
      {
        area: {
          text: 'Synthetic Town C, MB',
          region: 'CA-MB',
          match: { ...match, latitude: '50.000000' },
        },
      },
      { area: { text: 'Synthetic Town D, MB', region: 'CA-MB', match } },
      { area: { text: 'Synthetic Town C, MB', region: 'CA-MB', match: other } },
    ]) {
      const response = await verify(
        edited(origin, { area: { text: 'Synthetic Town B IN', region: 'US-IN' } }),
      );
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ error: { code: 'BAD_PLACE_MATCH' } });
    }
    expect(db.verifyCallDraft).not.toHaveBeenCalled();
  });

  it('passes a saved location on as it is', async () => {
    const location = '00000000-0000-4000-8000-000000000f1a';
    expect(
      (
        await verify(
          edited(
            { facilityId: location },
            { area: { text: 'Synthetic Town B IN', region: 'US-IN' } },
          ),
        )
      ).status,
    ).toBe(200);
    expect(savedRoute()).toMatchObject({ origin: { kind: 'facility', facilityId: location } });
  });

  it('needs the route when the form is saved', async () => {
    const response = await verify({ edited: { values: FIELDS.values } });
    expect(response.status).toBe(422);
    expect(db.verifyCallDraft).not.toHaveBeenCalled();
  });
});

describe('other drafts', () => {
  it('are verified as before, with no route and no lookup', async () => {
    db.draftToVerify.mockResolvedValue({
      kind: 'follow_up',
      organizationId: ORG,
      open: true,
      allowed: true,
      fields: { values: { task: 'Call back' } },
    });
    db.verifyCallDraft.mockResolvedValue({ status: 'verified', kind: 'follow_up', resultId: RATE });
    expect((await verify()).status).toBe(200);
    expect(savedRoute()).toBeUndefined();
    expect(lookups).toBe(0);
  });
});
