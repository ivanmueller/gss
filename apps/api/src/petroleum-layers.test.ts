import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { createApp } from './index';
import type { MapLayerSource } from './map-layers-db';
import {
  LayerRefusedError,
  PETROLEUM_SCHEMA_VERSION,
  TooManyLayersError,
  type PetroleumFactory,
} from './petroleum-db';
import { ENV, fakeDatabase, USER_ID, VALID_TOKEN } from './testing/helpers';
import { fakePetroleum } from './testing/petroleum';

// /api/v1/petroleum/layers (F-247 part 2): the oil and gas map's layers, kept in the oil and gas
// database behind grain's membership check. Every service, address and value is synthetic.

let db = fakeDatabase();
let petroleum = fakePetroleum();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
const openPetroleum = vi.fn<PetroleumFactory>(() => petroleum);
const app = createApp(openDatabase, {
  petroleum: openPetroleum,
  petroleumLayersDeadlineMs: 40,
});

const PETRO_URL = 'postgresql://petro_api.ref:secret@db.example.test:5432/postgres';
const WITH_PETROLEUM = { ...ENV, PETROLEUM_DATABASE_URL: PETRO_URL };
const AUTH = { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' };
const LAYER = '00000000-0000-4000-8000-0000000a1a01';
const VERSION = '2026-11-19 01:02:03.000004+00';
const SERVICE = 'https://services.example.com/rest/services/Land/MapServer/8';
const PICTURES = 'https://services.example.com/rest/services/Land/MapServer';
const DESCRIPTION = {
  name: 'Synthetic agreements',
  objectIdField: 'OBJECTID',
  fields: [
    { name: 'OBJECTID', type: 'esriFieldTypeOID' },
    { name: 'STATUS', type: 'esriFieldTypeString' },
  ],
};
const SQUARE = { type: 'FeatureCollection', features: [] };
/** A real 1-pixel PNG. */
const ONE_PIXEL_BYTES = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  ),
  (ch) => ch.charCodeAt(0),
);

const source: MapLayerSource = {
  id: LAYER,
  organizationId: 'org-a',
  kind: 'arcgis_features',
  url: SERVICE,
  wmsLayers: null,
  idField: 'OBJECTID',
  colourField: null,
  alsoFields: [],
  onlyField: null,
  onlyValues: [],
  definitionExpression: null,
  tileLevels: null,
};

const details = {
  name: 'Agreements',
  sourceName: 'Synthetic publisher',
  termsUrl: 'https://example.com/terms',
  termsNote: 'Open licence.',
  colour: '#2f6baa',
  colourField: null,
  colours: [],
};

let service: (url: string) => Response | Promise<Response>;
let serviceCalls: string[] = [];

function admin() {
  db.memberships.mockResolvedValue([
    { organizationId: 'org-a', organizationName: 'Synthetic Org A', role: 'org_admin' },
  ]);
}

beforeEach(() => {
  service = (url) => {
    if (url.startsWith(`${SERVICE}?f=json`)) return Response.json(DESCRIPTION);
    if (url.includes('returnCountOnly=true')) return Response.json({ count: 42 });
    if (url.includes('/query?f=geojson')) return Response.json(SQUARE);
    return new Response('not found', { status: 404 });
  };
  serviceCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      if (input.includes('/auth/v1/user')) {
        return Promise.resolve(Response.json({ id: USER_ID, email: 'adam@example.test' }));
      }
      serviceCalls.push(input);
      return Promise.resolve(service(input));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  db = fakeDatabase();
  petroleum = fakePetroleum();
  openDatabase.mockClear();
  openPetroleum.mockClear();
});

function send(path: string, method = 'GET', body?: unknown, env: object = WITH_PETROLEUM) {
  return app.request(
    `/api/v1/petroleum/layers${path}`,
    { method, headers: AUTH, ...(body !== undefined && { body: JSON.stringify(body) }) },
    env,
  );
}

async function code(res: Response): Promise<unknown> {
  const body = await res.json<{ error?: { code?: unknown } }>();
  return body.error?.code;
}

describe('who may use the oil and gas layers', () => {
  it('lists the layers for any member, as that member', async () => {
    const res = await send('');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ layers: [] });
    expect(petroleum.listLayers).toHaveBeenCalledWith({
      userId: USER_ID,
      organizationId: 'org-a',
      role: 'trader',
      requestId: expect.any(String) as string,
    });
    expect(petroleum.close).toHaveBeenCalled();
  });

  it('refuses a person without a membership before the oil and gas database is opened', async () => {
    db.memberships.mockResolvedValue([]);
    for (const [path, method, body] of [
      ['', 'GET', undefined],
      [`/${LAYER}/features/5/5/10`, 'GET', undefined],
      [`/${LAYER}/remove`, 'POST', { version: VERSION }],
    ] as const) {
      const res = await send(path, method, body);
      expect(res.status).toBe(403);
    }
    expect(openPetroleum).not.toHaveBeenCalled();
    expect(serviceCalls).toEqual([]);
  });

  it('needs the organization named when the person belongs to several, and uses the one named', async () => {
    db.memberships.mockResolvedValue([
      { organizationId: 'org-a', organizationName: 'Synthetic Org A', role: 'viewer' },
      { organizationId: 'org-b', organizationName: 'Synthetic Org B', role: 'org_admin' },
    ]);
    expect((await send('')).status).toBe(403);
    expect((await send(`/${LAYER}/features/5/5/10`)).status).toBe(403);
    expect(openPetroleum).not.toHaveBeenCalled();

    petroleum.layerSource.mockResolvedValue(source);
    const square = await send(`/${LAYER}/features/5/5/10?organization_id=org-a`);
    expect(square.status).toBe(200);
    expect(petroleum.layerSource).toHaveBeenLastCalledWith(
      expect.objectContaining({ organizationId: 'org-a', role: 'viewer' }),
      LAYER,
    );
    // The role is the named organization's: a viewer there, whatever they are elsewhere, so
    // nothing is written (F-247-2-R5-01: the role is checked again before every write).
    const removed = await send(`/${LAYER}/remove?organization_id=org-a`, 'POST', {
      version: VERSION,
    });
    expect(removed.status).toBe(403);
    expect(petroleum.removeLayer).not.toHaveBeenCalled();
    // An admin in the organization named removes, as that organization's admin.
    const asAdmin = await send(`/${LAYER}/remove?organization_id=org-b`, 'POST', {
      version: VERSION,
    });
    expect(asAdmin.status).toBe(200);
    expect(petroleum.removeLayer).toHaveBeenLastCalledWith(
      expect.objectContaining({ organizationId: 'org-b', role: 'org_admin' }),
      LAYER,
      VERSION,
    );
    expect((await send('?organization_id=org-c')).status).toBe(403);
  });

  it.each(['viewer', 'analyst', 'trader', 'operations'])(
    'lets a %s see squares but never inspect or add, before any map service is asked',
    async (role) => {
      db.memberships.mockResolvedValue([
        { organizationId: 'org-a', organizationName: 'Synthetic Org A', role },
      ]);
      petroleum.layerSource.mockResolvedValue(source);
      expect((await send(`/${LAYER}/features/5/5/10`)).status).toBe(200);
      serviceCalls = [];

      const inspected = await send('/inspect', 'POST', {
        url: SERVICE,
        field: null,
        alsoFields: [],
        onlyField: null,
        onlyValues: [],
      });
      expect(inspected.status).toBe(403);
      const added = await send('', 'POST', {
        ...details,
        source: 'web',
        url: SERVICE,
        wmsLayers: null,
      });
      expect(added.status).toBe(403);
      expect(serviceCalls).toEqual([]);
      expect(petroleum.createLayer).not.toHaveBeenCalled();
    },
  );

  it('passes the database’s own refusals on', async () => {
    admin();
    petroleum.updateLayer.mockResolvedValue({ status: 'forbidden' });
    petroleum.removeLayer.mockResolvedValue({ status: 'stale' });
    petroleum.layerSource.mockResolvedValue(source);
    const changed = await send(`/${LAYER}`, 'PATCH', {
      ...details,
      version: VERSION,
      wmsLayers: null,
      mapVisible: true,
    });
    expect(changed.status).toBe(403);
    expect((await send(`/${LAYER}/remove`, 'POST', { version: VERSION })).status).toBe(409);
  });
});

describe('adding, changing and removing as an admin', () => {
  beforeEach(admin);

  it('adds a live ArcGIS layer with its id field and whether it is on when the map opens', async () => {
    const res = await send('', 'POST', {
      ...details,
      source: 'web',
      url: SERVICE,
      wmsLayers: null,
      mapVisible: false,
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: LAYER });
    expect(petroleum.createLayer).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-a', role: 'org_admin' }),
      expect.objectContaining({
        kind: 'arcgis_features',
        url: SERVICE,
        idField: 'OBJECTID',
        mapVisible: false,
        map: null,
        file: null,
      }),
    );
    expect(serviceCalls.filter((url) => url.startsWith(`${SERVICE}?f=json`))).toHaveLength(1);
  });

  // F-247-2-R5-03: the Settings form starts unticked; the API agrees when the field is left out.
  it('adds a layer off when the map opens unless the admin says so', async () => {
    const res = await send('', 'POST', {
      ...details,
      source: 'web',
      url: SERVICE,
      wmsLayers: null,
    });
    expect(res.status).toBe(201);
    expect(petroleum.createLayer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mapVisible: false }),
    );
  });

  // F-247-2-R5-01: the role is read again after the wait on the map service, before the write.
  it('writes nothing when the admin role is removed while the map service answers', async () => {
    let answer: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    service = async (url) => {
      if (!url.startsWith(`${SERVICE}?f=json`)) return new Response('not found', { status: 404 });
      await answered;
      return Response.json(DESCRIPTION);
    };
    const adding = send('', 'POST', { ...details, source: 'web', url: SERVICE, wmsLayers: null });
    await vi.waitFor(() => {
      expect(serviceCalls).toHaveLength(1);
    });
    db.memberships.mockResolvedValue([
      { organizationId: 'org-a', organizationName: 'Synthetic Org A', role: 'viewer' },
    ]);
    answer();
    const res = await adding;
    expect(res.status).toBe(403);
    expect(petroleum.createLayer).not.toHaveBeenCalled();

    // A change and a removal check the role the same way.
    petroleum.layerSource.mockResolvedValue(source);
    const changed = await send(`/${LAYER}`, 'PATCH', {
      ...details,
      version: VERSION,
      wmsLayers: null,
      mapVisible: true,
    });
    expect(changed.status).toBe(403);
    const removed = await send(`/${LAYER}/remove`, 'POST', { version: VERSION });
    expect(removed.status).toBe(403);
    expect(petroleum.updateLayer).not.toHaveBeenCalled();
    expect(petroleum.removeLayer).not.toHaveBeenCalled();
  });

  it('refuses a WMS service, a file and a layer from an ArcGIS map', async () => {
    const wms = 'https://maps.example.com/wms?service=WMS&layers=roads';
    const inspected = await send('/inspect', 'POST', {
      url: wms,
      field: null,
      alsoFields: [],
      onlyField: null,
      onlyValues: [],
    });
    expect(inspected.status).toBe(422);
    expect(await code(inspected)).toBe('NOT_A_LAYER');
    for (const body of [
      { ...details, source: 'web', url: wms, wmsLayers: 'roads' },
      {
        ...details,
        source: 'file',
        fileName: 'areas.geojson',
        geojson: { type: 'FeatureCollection', features: [] },
      },
      {
        ...details,
        source: 'web',
        url: SERVICE,
        wmsLayers: null,
        map: { itemId: 'a'.repeat(32), title: 'A map' },
      },
    ]) {
      const res = await send('', 'POST', body);
      expect(res.status).toBe(422);
      expect(await code(res)).toBe('NOT_A_LAYER');
    }
    expect(petroleum.createLayer).not.toHaveBeenCalled();
    expect(serviceCalls).toEqual([]);
  });

  it('says so when the organization has the most layers it can keep', async () => {
    petroleum.createLayer.mockRejectedValue(new TooManyLayersError());
    const res = await send('', 'POST', {
      ...details,
      source: 'web',
      url: SERVICE,
      wmsLayers: null,
    });
    expect(res.status).toBe(422);
    expect(await code(res)).toBe('TOO_MANY_LAYERS');
  });

  // F-247-2-R1-02: a value the database's checks refuse is the person's to correct (422), never
  // reported as the database being unavailable.
  it('answers 422, not "unavailable", when the database refuses a layer’s values', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    petroleum.createLayer.mockRejectedValue(new LayerRefusedError());
    const added = await send('', 'POST', {
      ...details,
      source: 'web',
      url: SERVICE,
      wmsLayers: null,
    });
    expect(added.status).toBe(422);
    expect(await code(added)).toBe('VALIDATION_FAILED');
    petroleum.layerSource.mockResolvedValue(source);
    petroleum.updateLayer.mockRejectedValue(new LayerRefusedError());
    const changed = await send(`/${LAYER}`, 'PATCH', {
      ...details,
      version: VERSION,
      wmsLayers: null,
      mapVisible: true,
    });
    expect(changed.status).toBe(422);
    expect(await code(changed)).toBe('VALIDATION_FAILED');
    expect(logged).not.toHaveBeenCalled();
    expect(petroleum.abort).not.toHaveBeenCalled();
  });

  it('passes a terms link with capital letters on as typed', async () => {
    const termsUrl = 'HTTPS://Example.COM/Terms';
    const res = await send('', 'POST', {
      ...details,
      termsUrl,
      source: 'web',
      url: SERVICE,
      wmsLayers: null,
    });
    expect(res.status).toBe(201);
    expect(petroleum.createLayer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ termsUrl }),
    );
  });

  it('changes a layer, its default included, and needs the default sent', async () => {
    petroleum.layerSource.mockResolvedValue(source);
    const body = { ...details, version: VERSION, wmsLayers: null };
    const without = await send(`/${LAYER}`, 'PATCH', body);
    expect(without.status).toBe(422);
    expect(petroleum.updateLayer).not.toHaveBeenCalled();

    const res = await send(`/${LAYER}`, 'PATCH', { ...body, mapVisible: true });
    expect(res.status).toBe(200);
    expect(petroleum.updateLayer).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-a', role: 'org_admin' }),
      LAYER,
      VERSION,
      expect.objectContaining({ name: 'Agreements', mapVisible: true }),
    );
  });

  // F-247-2-R12-01: a new colour field is checked against the service, with no other field or
  // limit sent; one the service does not have is not saved.
  it('refuses a new colour field the service does not have, and takes one it has', async () => {
    petroleum.layerSource.mockResolvedValue(source);
    const body = { ...details, version: VERSION, wmsLayers: null, mapVisible: true };
    const missing = await send(`/${LAYER}`, 'PATCH', {
      ...body,
      colourField: 'RETIRED_FIELD',
      colours: [['Active', '#e6194b']],
    });
    expect(missing.status).toBe(422);
    expect(await code(missing)).toBe('VALIDATION_FAILED');
    expect(petroleum.updateLayer).not.toHaveBeenCalled();
    expect(serviceCalls.filter((url) => url.startsWith(`${SERVICE}?f=json`))).toHaveLength(1);

    const there = await send(`/${LAYER}`, 'PATCH', {
      ...body,
      colourField: 'STATUS',
      colours: [['Active', '#e6194b']],
    });
    expect(there.status).toBe(200);
    expect(petroleum.updateLayer).toHaveBeenCalledWith(
      expect.anything(),
      LAYER,
      VERSION,
      expect.objectContaining({ colourField: 'STATUS' }),
    );

    // The colour field as it already is: saved without asking the service.
    serviceCalls = [];
    petroleum.layerSource.mockResolvedValue({ ...source, colourField: 'STATUS' });
    const same = await send(`/${LAYER}`, 'PATCH', {
      ...body,
      name: 'Agreements, renamed',
      colourField: 'STATUS',
      colours: [['Active', '#e6194b']],
    });
    expect(same.status).toBe(200);
    expect(serviceCalls).toEqual([]);
  });

  it('answers 409 for a version someone else changed, 404 for a removed layer', async () => {
    petroleum.layerSource.mockResolvedValue(source);
    petroleum.updateLayer.mockResolvedValue({ status: 'stale' });
    const stale = await send(`/${LAYER}`, 'PATCH', {
      ...details,
      version: VERSION,
      wmsLayers: null,
      mapVisible: false,
    });
    expect(stale.status).toBe(409);
    petroleum.removeLayer.mockResolvedValue({ status: 'not_found' });
    expect((await send(`/${LAYER}/remove`, 'POST', { version: VERSION })).status).toBe(404);
  });

  it('removes a layer', async () => {
    const res = await send(`/${LAYER}/remove`, 'POST', { version: VERSION });
    expect(res.status).toBe(200);
    expect(petroleum.removeLayer).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      LAYER,
      VERSION,
    );
  });
});

describe('what the oil and gas side does not offer', () => {
  beforeEach(admin);

  it.each([
    ['POST', '/arcgis-item'],
    ['GET', `/${LAYER}/file`],
    ['GET', `/${LAYER}/count`],
    ['GET', `/${LAYER}/pages/0`],
    ['PUT', `/${LAYER}/overview/${LAYER}/0`],
    ['POST', `/${LAYER}/overview/${LAYER}/publish`],
    ['GET', `/${LAYER}/overview`],
  ])('has no %s %s', async (method, path) => {
    const res = await send(path, method, method === 'GET' ? undefined : {});
    expect(res.status).toBe(404);
    expect(openPetroleum).not.toHaveBeenCalled();
  });

  it('keeps grain’s layers apart: neither list reads the other database', async () => {
    await send('');
    expect(db.listMapLayers).not.toHaveBeenCalled();
    openPetroleum.mockClear();
    const grain = await app.request(
      '/api/v1/map-layers?organization_id=org-a',
      { headers: AUTH },
      WITH_PETROLEUM,
    );
    expect(grain.status).toBe(200);
    expect(openPetroleum).not.toHaveBeenCalled();
  });

  it('still refuses a change of the opening default on grain’s layers', async () => {
    db.getMapLayerSource.mockResolvedValue(source);
    const res = await app.request(
      `/api/v1/map-layers/${LAYER}`,
      {
        method: 'PATCH',
        headers: AUTH,
        body: JSON.stringify({ ...details, version: VERSION, wmsLayers: null, mapVisible: true }),
      },
      ENV,
    );
    expect(res.status).toBe(422);
    expect(db.updateMapLayer).not.toHaveBeenCalled();
  });
});

describe('squares, pictures and details', () => {
  it('fetches a square from the stored address only', async () => {
    petroleum.layerSource.mockResolvedValue(source);
    // The app's mark on these addresses (`c`, F-247-2-R18-01) changes nothing here.
    const res = await send(`/${LAYER}/features/5/5/10?g=x&c=2`);
    expect(res.status).toBe(200);
    // Kept by the browser for this sign-in only (F-247-2-R1-01), and reused only after asking
    // the Worker again, which checks the membership each time (F-247-2-R4-01).
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
    expect(res.headers.get('Vary')).toMatch(/\bAuthorization\b/);
    expect(res.headers.get('ETag')).toMatch(/^"[0-9a-f]{32}-\d+"$/);
    expect(serviceCalls).toHaveLength(1);
    expect(serviceCalls[0]?.startsWith(`${SERVICE}/query?`)).toBe(true);
  });

  // F-247-2-R4-01: a kept square is reused only after the Worker checks the membership again.
  it('answers “not modified” to a member, and refuses a kept square once access is removed', async () => {
    petroleum.layerSource.mockResolvedValue(source);
    const first = await send(`/${LAYER}/features/5/5/10`);
    const tag = first.headers.get('ETag') ?? '';
    expect(serviceCalls).toHaveLength(1);
    const again = () =>
      app.request(
        `/api/v1/petroleum/layers/${LAYER}/features/5/5/10`,
        { headers: { ...AUTH, 'If-None-Match': tag } },
        WITH_PETROLEUM,
      );
    const unchanged = await again();
    expect(unchanged.status).toBe(304);
    expect(unchanged.headers.get('ETag')).toBe(tag);
    expect(unchanged.headers.get('Cache-Control')).toBe('private, no-cache');
    // Nothing is asked of the web service for a copy still good.
    expect(serviceCalls).toHaveLength(1);
    // A layer changed since: fetched anew.
    petroleum.layerSource.mockResolvedValue({ ...source, onlyField: 'STATUS', onlyValues: ['A'] });
    expect((await again()).status).toBe(200);
    expect(serviceCalls).toHaveLength(2);
    // The same sign-in, its access removed: refused, the browser's copy never confirmed.
    db.memberships.mockResolvedValue([]);
    expect((await again()).status).toBe(403);
    expect(serviceCalls).toHaveLength(2);
  });

  it('answers 404 for a layer that is removed or another organization’s', async () => {
    expect((await send(`/${LAYER}/features/5/5/10`)).status).toBe(404);
    expect((await send(`/${LAYER}/tiles/5/5/10.png`)).status).toBe(404);
    expect((await send(`/${LAYER}/details/7`)).status).toBe(404);
    expect((await send(`/${LAYER}/legend`)).status).toBe(404);
    expect(serviceCalls).toEqual([]);
  });

  it('serves a picture layer’s legend', async () => {
    petroleum.layerSource.mockResolvedValue({
      ...source,
      kind: 'arcgis_image',
      url: PICTURES,
      idField: null,
    });
    service = () => Response.json({ layers: [] });
    const res = await send(`/${LAYER}/legend`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Vary')).toMatch(/\bAuthorization\b/);
    expect(await res.json()).toEqual({ entries: [] });
    service = () => new Response(ONE_PIXEL_BYTES, { headers: { 'Content-Type': 'image/png' } });
    const picture = await send(`/${LAYER}/tiles/5/5/10.png`);
    expect(picture.status).toBe(200);
    expect(picture.headers.get('Cache-Control')).toBe('private, no-cache');
    expect(picture.headers.get('ETag')).toMatch(/^"[0-9a-f]{32}-\d+"$/);
    expect(picture.headers.get('Vary')).toMatch(/\bAuthorization\b/);
  });
});

describe('when the oil and gas database is not there', () => {
  it('says "not set up" without a binding, after the membership check', async () => {
    const res = await send('', 'GET', undefined, ENV);
    expect(res.status).toBe(503);
    expect(await code(res)).toBe('PETROLEUM_NOT_SET_UP');
    expect(openPetroleum).not.toHaveBeenCalled();
  });

  it('says "not ready" while the database is behind the version the code needs', async () => {
    petroleum.schemaVersion.mockResolvedValue(PETROLEUM_SCHEMA_VERSION - 1);
    const res = await send('');
    expect(res.status).toBe(503);
    expect(await code(res)).toBe('PETROLEUM_NOT_READY');
    expect(petroleum.listLayers).not.toHaveBeenCalled();
    expect(petroleum.close).toHaveBeenCalled();
  });

  it('answers "unavailable" and logs no secret when a query fails', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    petroleum.listLayers.mockRejectedValue(
      Object.assign(new Error(`connect failed ${PETRO_URL}`), { code: 'ECONNREFUSED' }),
    );
    const res = await send('');
    expect(res.status).toBe(503);
    expect(await code(res)).toBe('DATABASE_UNAVAILABLE');
    const line = logged.mock.calls.map((call) => String(call[0])).join('\n');
    expect(line).toContain('database=petroleum');
    expect(line).not.toContain('secret');
    // Grain's database is not asked again: one failure, one answer.
    expect(db.memberships).toHaveBeenCalledTimes(1);
  });

  it('drops the connection when a query passes its deadline', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    petroleum.listLayers.mockReturnValue(new Promise(() => undefined));
    const res = await send('');
    expect(res.status).toBe(503);
    expect(await code(res)).toBe('DATABASE_UNAVAILABLE');
    expect(petroleum.abort).toHaveBeenCalled();
  });

  it('does not count a slow map service against the database’s deadline', async () => {
    petroleum.layerSource.mockResolvedValue(source);
    service = async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return Response.json(SQUARE);
    };
    const res = await send(`/${LAYER}/features/5/5/10`);
    expect(res.status).toBe(200);
    expect(petroleum.abort).not.toHaveBeenCalled();
  });
});
