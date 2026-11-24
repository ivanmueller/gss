import { MAP_ASK_INSTRUCTIONS, MAP_ASK_JSON_SCHEMA } from '@grain/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAP_ASK_MODEL, ReadingDeadlineError, type ClaudeClient } from './anthropic';
import type { Database } from './db';
import { createApp } from './index';
import { ASK_PER_MINUTE, AskLimiter } from './map-ask';
import { PETROLEUM_SCHEMA_VERSION, type PetroleumFactory } from './petroleum-db';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';
import { fakePetroleum } from './testing/petroleum';

// Ask the map, read by Claude (F-254 part 2): members only, the fixed instructions and the typed
// words sent, the answer checked against the map's settings, names kept only as typed.

let db = fakeDatabase();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
let petroleum = fakePetroleum();
const openPetroleum = vi.fn<PetroleumFactory>(() => petroleum);
let claude: { readCall: ReturnType<typeof vi.fn<ClaudeClient['readCall']>> };
let app = createApp(openDatabase);

const WITH_KEY = { ...ENV, ANTHROPIC_API_KEY: 'sk-ant-synthetic' };
const PATH = '/api/v1/petroleum/ask';
const ask = (text: unknown, env: Record<string, unknown> = WITH_KEY, path = PATH) =>
  app.request(
    path,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    },
    env,
  );

const read = (json: unknown) =>
  Promise.resolve({
    status: 'read' as const,
    json,
    model: MAP_ASK_MODEL,
    inputTokens: 3000,
    outputTokens: 200,
  });

beforeEach(() => {
  mockAuthServer(Response.json({ id: USER_ID, email: 'adam@example.test' }));
  claude = {
    readCall: vi.fn<ClaudeClient['readCall']>(() =>
      read({
        settings: { goTo: 'duvernay', wells: { on: true, spudFrom: 2020 }, open: 'wells' },
        reasons: [],
      }),
    ),
  };
  petroleum = fakePetroleum();
  petroleum.schemaVersion.mockResolvedValue(PETROLEUM_SCHEMA_VERSION);
  app = createApp(openDatabase, {
    claude: (env) => (env.ANTHROPIC_API_KEY ? claude : null),
    petroleum: openPetroleum,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  db = fakeDatabase();
});

describe('POST /api/v1/petroleum/ask', () => {
  it('reads a member’s request with the fast model, the fixed instructions and the words only', async () => {
    const res = await ask('Duvernay wells drilled since 2020');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({
      settings: { goTo: 'duvernay', wells: { on: true, spudFrom: 2020 }, open: 'wells' },
      reasons: [],
    });
    expect(claude.readCall).toHaveBeenCalledTimes(1);
    expect(claude.readCall).toHaveBeenCalledWith({
      system: MAP_ASK_INSTRUCTIONS,
      user: 'Duvernay wells drilled since 2020',
      schema: MAP_ASK_JSON_SCHEMA,
      model: 'claude-haiku-5-5',
      effort: 'low',
      maxTokens: expect.any(Number) as number,
      deadlineMs: expect.any(Number) as number,
    });
    expect(db.memberships).toHaveBeenCalledWith(USER_ID);
  });

  it('drops a name that is not in the request', async () => {
    claude.readCall.mockReturnValueOnce(
      read({
        settings: {
          wells: { on: true, operator: 'Chevron Canada Limited' },
          rigs: { contractor: 'ensign' },
        },
        reasons: [],
      }),
    );
    const res = await ask('wells of chevron canada, rigs of Ensign');
    expect(await res.json()).toEqual({
      settings: { wells: { on: true }, rigs: { contractor: 'ensign' } },
      reasons: [],
    });
  });

  it('refuses an answer outside the map’s settings', async () => {
    for (const json of [
      { settings: { zoom: 5 }, reasons: [] },
      { settings: { wells: { statuses: ['flowing'] } }, reasons: [] },
      { settings: { wells: { spudFrom: 2024, spudTo: 2020 } }, reasons: [] },
      { settings: {}, reasons: ['weather'] },
      { settings: {} },
      'wells',
    ]) {
      claude.readCall.mockReturnValueOnce(read(json));
      const res = await ask('anything');
      expect(res.status, JSON.stringify(json)).toBe(502);
      expect(await res.json()).toMatchObject({ error: { code: 'CLAUDE_FAILED' } });
    }
  });

  it('says when Claude declined, failed, was too slow or is not set up', async () => {
    claude.readCall.mockResolvedValueOnce({ status: 'refused', model: MAP_ASK_MODEL });
    expect((await ask('wells')).status).toBe(502);
    claude.readCall.mockRejectedValueOnce(new Error('network'));
    expect((await ask('wells')).status).toBe(502);
    claude.readCall.mockRejectedValueOnce(new ReadingDeadlineError('late'));
    expect((await ask('wells')).status).toBe(504);
    const res = await ask('wells', ENV);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'CLAUDE_NOT_CONFIGURED' } });
  });

  it('refuses an empty or long request, someone not a member and someone not signed in', async () => {
    expect((await ask('   ')).status).toBe(422);
    expect((await ask('x'.repeat(501))).status).toBe(422);
    expect((await ask(42)).status).toBe(422);
    db.memberships.mockResolvedValueOnce([]);
    expect((await ask('wells')).status).toBe(403);
    expect((await ask('wells', WITH_KEY, `${PATH}?organization_id=org-b`)).status).toBe(403);
    const anonymous = await app.request(
      PATH,
      { method: 'POST', body: JSON.stringify({ text: 'wells' }) },
      WITH_KEY,
    );
    expect(anonymous.status).toBe(401);
    expect(claude.readCall).not.toHaveBeenCalled();
  });

  it('stops a person after a dozen requests a minute', async () => {
    for (let i = 0; i < ASK_PER_MINUTE; i += 1) expect((await ask('wells')).status).toBe(200);
    const res = await ask('wells');
    expect(res.status).toBe(429);
    expect(claude.readCall).toHaveBeenCalledTimes(ASK_PER_MINUTE);
  });
});

describe('AskLimiter', () => {
  it('counts each person apart, over the last minute', () => {
    const limiter = new AskLimiter();
    for (let i = 0; i < ASK_PER_MINUTE; i += 1) expect(limiter.take('a', 1_000)).toBe(true);
    expect(limiter.take('a', 1_000)).toBe(false);
    expect(limiter.take('b', 1_000)).toBe(true);
    expect(limiter.take('a', 61_001)).toBe(true);
  });
});

describe('POST /api/v1/petroleum/ask, places by name (F-254 part 3)', () => {
  const WITH_GEOCODIO = { ...WITH_KEY, GEOCODIO_API_KEY: 'synthetic-geocodio' };
  const AUTH_USER = Response.json({ id: USER_ID, email: 'adam@example.test' });
  const square = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { M: 5, RGE: 22, TWP: 62 },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-117.2, 54.3],
              [-117.0, 54.3],
              [-117.0, 54.4],
              [-117.2, 54.3],
            ],
          ],
        },
      },
    ],
  };
  const town = (country: string, region: string, accuracy = 'place') =>
    Response.json({
      results: {
        town: {
          query: {},
          response: {
            input: {},
            results: [
              {
                location: { lat: 54.4, lng: -116.8 },
                accuracy: 1,
                accuracy_type: accuracy,
                formatted_address: 'Fox Creek, AB',
                address_components: { country, state_province: region },
              },
            ],
          },
        },
      },
    });
  /** The auth server, the province's grid and Geocodio, each answered by its address. */
  function services(grid: () => Response, geocodio: () => Response) {
    const fetchMock = mockAuthServer(AUTH_USER);
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('alberta_township')
          ? grid()
          : url.includes('geocod.io')
            ? geocodio()
            : AUTH_USER.clone(),
      ),
    );
    return fetchMock;
  }

  it('moves to a legal land location read from the words, found on the province’s grid', async () => {
    const fetchMock = services(
      () => Response.json(square),
      () => town('CA', 'AB'),
    );
    claude.readCall.mockReturnValueOnce(
      read({ settings: { wells: { on: true } }, reasons: ['place_by_name'] }),
    );
    const res = await ask('wells in Twp 62 Rge 22 W5', WITH_GEOCODIO);
    expect(await res.json()).toEqual({
      settings: { wells: { on: true } },
      reasons: [],
      place: { label: 'T62 R22 W5', bounds: [-117.2, 54.3, -117, 54.4] },
    });
    const gridUrl = fetchMock.mock.calls.map(([url]) => url).find((u) => u.includes('township'));
    expect(new URL(gridUrl ?? 'https://x').searchParams.get('where')).toBe(
      'M=5 AND RGE=22 AND TWP=62',
    );
    expect(fetchMock.mock.calls.some(([url]) => url.includes('geocod.io'))).toBe(false);
  });

  it('moves to a town Claude named as typed, found in Alberta only', async () => {
    const fetchMock = services(
      () => Response.json(square),
      () => town('CA', 'AB'),
    );
    claude.readCall.mockReturnValueOnce(
      read({ settings: { rigs: { on: true } }, reasons: [], town: 'Fox Creek' }),
    );
    const res = await ask('rigs near Fox Creek', WITH_GEOCODIO);
    const body = await res.json<{
      place: { label: string; bounds: number[] };
      reasons: string[];
    }>();
    expect(body.place.label).toBe('Fox Creek, AB');
    expect(body.reasons).toEqual([]);
    const geocodio = fetchMock.mock.calls.find(([url]) => url.includes('geocod.io'));
    // Only the town's name and the province go to Geocodio.
    expect(JSON.parse(geocodio?.[1]?.body as string)).toEqual({
      town: { city: 'Fox Creek', state_province: 'AB', country: 'Canada' },
    });

    // In another province, or only a county: no place.
    for (const [country, region, accuracy] of [
      ['CA', 'BC', 'place'],
      ['CA', 'AB', 'county'],
    ] as const) {
      services(
        () => Response.json(square),
        () => town(country, region, accuracy),
      );
      claude.readCall.mockReturnValueOnce(read({ settings: {}, reasons: [], town: 'Fox Creek' }));
      expect(await (await ask('rigs near Fox Creek', WITH_GEOCODIO)).json()).toEqual({
        settings: {},
        reasons: ['place_not_found'],
      });
    }
  });

  it('never looks up a town that is not in the typed words, and says when none was found', async () => {
    const fetchMock = services(
      () => Response.json({ type: 'FeatureCollection', features: [] }),
      () => town('CA', 'AB'),
    );
    claude.readCall.mockReturnValueOnce(read({ settings: {}, reasons: [], town: 'Edmonton' }));
    expect(await (await ask('rigs near the city', WITH_GEOCODIO)).json()).toEqual({
      settings: {},
      reasons: [],
    });
    expect(fetchMock.mock.calls.some(([url]) => url.includes('geocod.io'))).toBe(false);
    // A township the grid does not hold.
    claude.readCall.mockReturnValueOnce(read({ settings: {}, reasons: [] }));
    expect(await (await ask('126-34W6', WITH_GEOCODIO)).json()).toEqual({
      settings: {},
      reasons: ['place_not_found'],
    });
    // No Geocodio key: the town is not found, the rest still applies.
    claude.readCall.mockReturnValueOnce(
      read({ settings: { rigs: { on: true } }, reasons: [], town: 'Fox Creek' }),
    );
    expect(await (await ask('rigs near Fox Creek')).json()).toEqual({
      settings: { rigs: { on: true } },
      reasons: ['place_not_found'],
    });
  });

  it('says so when the province’s grid cannot be reached', async () => {
    services(
      () => new Response('down', { status: 503 }),
      () => town('CA', 'AB'),
    );
    claude.readCall.mockReturnValueOnce(read({ settings: {}, reasons: [] }));
    const res = await ask('62-22W5', WITH_GEOCODIO);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ settings: {}, reasons: ['place_not_found'] });
  });
});

describe('POST /api/v1/petroleum/ask, fields and pools by name (F-254 part 3b)', () => {
  const WITH_PETROLEUM = {
    ...WITH_KEY,
    PETROLEUM_DATABASE_URL: 'postgresql://petro_api.ref:secret@db.example.test:5432/postgres',
  };
  const FOUND = {
    field: { code: 990002, name: 'EXAMPLE SOUTH' },
    pool: null,
    wells: 12,
    bounds: [-117.3, 54.2, -116.9, 54.5] as [number, number, number, number],
  };

  it('filters the wells by the field on the AER’s list and moves to them', async () => {
    petroleum.st37FieldFind.mockResolvedValueOnce(FOUND);
    claude.readCall.mockReturnValueOnce(
      read({
        // A field Claude writes into the settings is never applied: only the list's name is.
        settings: { wells: { statuses: ['producing'], field: 'MADE UP' } },
        reasons: [],
        field: 'example south',
      }),
    );
    const res = await ask('producing wells in the Example South field', WITH_PETROLEUM);
    expect(await res.json()).toEqual({
      settings: {
        wells: { statuses: ['producing'], on: true, field: 'EXAMPLE SOUTH', pool: null },
      },
      reasons: [],
      place: { label: 'EXAMPLE SOUTH field', bounds: [-117.3, 54.2, -116.9, 54.5] },
    });
    expect(petroleum.st37FieldFind).toHaveBeenCalledWith(
      {
        userId: USER_ID,
        organizationId: 'org-a',
        role: 'trader',
        requestId: expect.any(String) as string,
      },
      'example south',
      null,
    );
  });

  it('names a pool in its field', async () => {
    petroleum.st37FieldFind.mockResolvedValueOnce({
      ...FOUND,
      pool: { code: 728001, name: 'EXAMPLE A' },
      wells: 3,
    });
    claude.readCall.mockReturnValueOnce(
      read({ settings: {}, reasons: [], field: 'Example South', pool: 'Example A' }),
    );
    const body = await (
      await ask('the Example A pool of Example South', WITH_PETROLEUM)
    ).json<{ settings: unknown; place: { label: string } }>();
    expect(body.settings).toEqual({
      wells: { on: true, field: 'EXAMPLE SOUTH', pool: 'EXAMPLE A' },
    });
    expect(body.place.label).toBe('EXAMPLE A pool, EXAMPLE SOUTH field');
    expect(petroleum.st37FieldFind).toHaveBeenLastCalledWith(
      expect.anything(),
      'Example South',
      'Example A',
    );
  });

  it('says when the field is not on the list, has no wells loaded, or a pool has no field', async () => {
    const cases: [Awaited<ReturnType<typeof petroleum.st37FieldFind>>, string][] = [
      [{ field: null, pool: null, wells: 0, bounds: null }, 'field_not_found'],
      [{ ...FOUND, wells: 0, bounds: null }, 'field_not_loaded'],
    ];
    for (const [found, reason] of cases) {
      petroleum.st37FieldFind.mockResolvedValueOnce(found);
      claude.readCall.mockReturnValueOnce(read({ settings: {}, reasons: [], field: 'Example' }));
      expect(await (await ask('wells in the Example field', WITH_PETROLEUM)).json()).toEqual({
        settings: {},
        reasons: [reason],
      });
    }
    claude.readCall.mockReturnValueOnce(read({ settings: {}, reasons: [], pool: 'Example A' }));
    expect(await (await ask('the Example A pool', WITH_PETROLEUM)).json()).toEqual({
      settings: {},
      reasons: ['pool_needs_field'],
    });
  });

  it('never looks up a field that is not in the typed words, and copes without the database', async () => {
    claude.readCall.mockReturnValueOnce(read({ settings: {}, reasons: [], field: 'Pembina' }));
    expect(await (await ask('wells in that field', WITH_PETROLEUM)).json()).toEqual({
      settings: {},
      reasons: [],
    });
    expect(petroleum.st37FieldFind).not.toHaveBeenCalled();
    // The oil and gas database not set up: the field is not found, the rest still applies.
    claude.readCall.mockReturnValueOnce(
      read({ settings: { rigs: { on: true } }, reasons: [], field: 'Pembina' }),
    );
    const res = await ask('rigs in the Pembina field');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      settings: { rigs: { on: true } },
      reasons: ['field_not_found'],
    });
  });
});
