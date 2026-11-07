import type { LayerInspection, MapLayerView } from '@grain/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { createApp } from './index';
import { arcgisSquareUrl, pictureUrl } from './map-layers';
import type { MapLayerSource } from './map-layers-db';
import { ENV, fakeDatabase, USER_ID, VALID_TOKEN } from './testing/helpers';

// /api/v1/map-layers (F-107). Every service, address and value is synthetic.
let db = fakeDatabase();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
const app = createApp(openDatabase);

const AUTH = { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' };
const LAYER = '00000000-0000-4000-8000-0000000a1a01';
const SERVICE = 'https://services.example.com/rest/services/Rail/FeatureServer/0';
const DESCRIPTION = {
  name: 'Synthetic Rail Lines',
  objectIdField: 'OBJECTID',
  copyrightText: '<b>Public domain.</b>',
  fields: [
    { name: 'OBJECTID', type: 'esriFieldTypeOID' },
    { name: 'OWNER', type: 'esriFieldTypeString' },
    { name: 'TRACKS', type: 'esriFieldTypeInteger' },
    { name: 'MILES', type: 'esriFieldTypeDouble' },
  ],
};
const SQUARE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 7,
      geometry: {
        type: 'LineString',
        coordinates: [
          [-110, 50],
          [-109, 50],
        ],
      },
      properties: { OBJECTID: 7, OWNER: 'AAA' },
    },
  ],
};

let service: (url: string) => Response;
let serviceCalls: string[] = [];
let serviceInits: (RequestInit | undefined)[] = [];

beforeEach(() => {
  service = (url) => {
    if (url.startsWith(`${SERVICE}?f=json`)) return Response.json(DESCRIPTION);
    if (url.includes('groupByFieldsForStatistics')) {
      return Response.json({
        features: [
          { attributes: { OWNER: 'BBB', gss_count: 5 } },
          { attributes: { OWNER: 'AAA', gss_count: 9 } },
          { attributes: { OWNER: null, gss_count: 2 } },
        ],
      });
    }
    if (url.includes('/query?f=geojson')) return Response.json(SQUARE);
    if (url.includes('objectIds=')) {
      return Response.json({
        features: [{ attributes: { OBJECTID: 7, OWNER: 'AAA', NOTE: '', MILES: 1.5 } }],
      });
    }
    return new Response('not found', { status: 404 });
  };
  serviceCalls = [];
  serviceInits = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      if (input.includes('/auth/v1/user')) {
        return Promise.resolve(Response.json({ id: USER_ID, email: 'adam@example.test' }));
      }
      serviceCalls.push(input);
      serviceInits.push(init);
      return Promise.resolve(service(input));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  db = fakeDatabase();
  openDatabase.mockClear();
});

function send(path: string, method: string, body?: unknown) {
  return app.request(
    `/api/v1/map-layers${path}`,
    { method, headers: AUTH, ...(body !== undefined && { body: JSON.stringify(body) }) },
    ENV,
  );
}

const details = {
  name: 'Rail lines',
  sourceName: 'Synthetic publisher',
  termsUrl: 'https://example.com/terms',
  termsNote: 'Public domain.',
  colour: '#2f6baa',
  colourField: 'OWNER',
  colours: [['AAA', '#e6194b']],
};

const source: MapLayerSource = {
  id: LAYER,
  kind: 'arcgis_features',
  url: SERVICE,
  wmsLayers: null,
  idField: 'OBJECTID',
  colourField: 'OWNER',
};

describe('GET /api/v1/map-layers', () => {
  it('requires sign-in', async () => {
    const res = await app.request('/api/v1/map-layers', {}, ENV);
    expect(res.status).toBe(401);
  });

  it('lists the organization’s layers', async () => {
    const layer = { id: LAYER, name: 'Rail lines' } as MapLayerView;
    db.listMapLayers.mockResolvedValueOnce([layer]);
    const res = await send('', 'GET');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ layers: [layer] });
    expect(db.listMapLayers.mock.calls[0]?.[1]).toBe('org-a');
  });

  it('refuses an organization the person is not in', async () => {
    const res = await send('?organization_id=org-b', 'GET');
    expect(res.status).toBe(403);
    expect(db.listMapLayers).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/map-layers/inspect', () => {
  it('describes an ArcGIS layer and counts a field’s values', async () => {
    const res = await send('/inspect', 'POST', { url: `${SERVICE}?f=pjson`, field: 'OWNER' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      kind: 'arcgis_features',
      url: SERVICE,
      wmsLayers: null,
      title: 'Synthetic Rail Lines',
      copyright: 'Public domain.',
      fields: ['OWNER', 'TRACKS'],
      values: [
        { value: 'AAA', count: 9 },
        { value: 'BBB', count: 5 },
      ],
    } satisfies LayerInspection);
  });

  it('is for admins only', async () => {
    db.isOrgAdmin.mockResolvedValueOnce(false);
    const res = await send('/inspect', 'POST', { url: SERVICE, field: null });
    expect(res.status).toBe(403);
    expect(serviceCalls).toEqual([]);
  });

  it('refuses an address that is not a public https map service, fetching nothing', async () => {
    for (const url of [
      'http://services.example.com/x/FeatureServer/0',
      'https://10.0.0.1/x/MapServer',
    ]) {
      const res = await send('/inspect', 'POST', { url, field: null });
      expect(res.status).toBe(422);
    }
    expect(serviceCalls).toEqual([]);
  });

  it('says when the service does not answer', async () => {
    service = () => new Response('down', { status: 503 });
    const res = await send('/inspect', 'POST', { url: SERVICE, field: null });
    expect(res.status).toBe(502);
  });

  it('refuses a field the layer does not have', async () => {
    const res = await send('/inspect', 'POST', { url: SERVICE, field: 'MILES' });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/v1/map-layers', () => {
  it('adds a web layer with the id field read from the service', async () => {
    const res = await send('', 'POST', {
      ...details,
      source: 'web',
      url: SERVICE,
      wmsLayers: null,
    });
    expect(res.status).toBe(201);
    expect(db.createMapLayer.mock.calls[0]?.[2]).toEqual({
      ...details,
      kind: 'arcgis_features',
      url: SERVICE,
      wmsLayers: null,
      idField: 'OBJECTID',
      file: null,
    });
  });

  it('refuses colours by a field the service does not have', async () => {
    const res = await send('', 'POST', {
      ...details,
      colourField: 'NOPE',
      source: 'web',
      url: SERVICE,
      wmsLayers: null,
    });
    expect(res.status).toBe(422);
    expect(db.createMapLayer).not.toHaveBeenCalled();
  });

  it('needs the WMS layers to show', async () => {
    const wms = { ...details, colourField: null, colours: [], source: 'web' };
    const without = await send('', 'POST', {
      ...wms,
      url: 'https://maps.example.ca/wms',
      wmsLayers: null,
    });
    expect(without.status).toBe(422);
    const named = await send('', 'POST', {
      ...wms,
      url: 'https://maps.example.ca/wms?SERVICE=WMS&LAYERS=crops',
      wmsLayers: null,
    });
    expect(named.status).toBe(201);
    expect(db.createMapLayer.mock.calls[0]?.[2]).toMatchObject({ kind: 'wms', wmsLayers: 'crops' });
    expect(serviceCalls).toEqual([]);
  });

  it('adds a file layer, checked again and kept as tidy GeoJSON', async () => {
    const res = await send('', 'POST', {
      ...details,
      source: 'file',
      fileName: 'rail.geojson',
      geojson: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-100.1234567, 50] },
            properties: { OWNER: 'AAA', nested: { a: 1 } },
          },
          { type: 'Feature', geometry: null, properties: {} },
        ],
      },
    });
    expect(res.status).toBe(201);
    const layer = db.createMapLayer.mock.calls[0]?.[2];
    expect(layer).toMatchObject({ kind: 'file', url: null, idField: null });
    expect(layer?.file?.featureCount).toBe(1);
    expect(JSON.parse(new TextDecoder().decode(layer?.file?.geojson))).toEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 1,
          geometry: { type: 'Point', coordinates: [-100.123457, 50] },
          properties: { OWNER: 'AAA' },
        },
      ],
    });
  });

  it('refuses a file that is not GeoJSON in longitude and latitude', async () => {
    const res = await send('', 'POST', {
      ...details,
      source: 'file',
      fileName: 'utm.geojson',
      geojson: {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: { type: 'Point', coordinates: [500000, 5600000] } },
        ],
      },
    });
    expect(res.status).toBe(422);
    expect(db.createMapLayer).not.toHaveBeenCalled();
  });

  it('refuses a layer without its terms', async () => {
    const res = await send('', 'POST', {
      ...details,
      termsNote: '',
      source: 'web',
      url: SERVICE,
      wmsLayers: null,
    });
    expect(res.status).toBe(422);
  });

  it('says when the person is not an admin', async () => {
    db.createMapLayer.mockResolvedValueOnce({ status: 'forbidden' });
    const res = await send('', 'POST', {
      ...details,
      source: 'web',
      url: SERVICE,
      wmsLayers: null,
    });
    expect(res.status).toBe(403);
  });
});

describe('changing and removing', () => {
  it('saves a change to the version the person saw', async () => {
    db.getMapLayerSource.mockResolvedValueOnce(source);
    const res = await send(`/${LAYER}`, 'PATCH', { ...details, version: 'v1', wmsLayers: null });
    expect(res.status).toBe(200);
    expect(db.updateMapLayer.mock.calls[0]?.slice(1)).toEqual([
      LAYER,
      'v1',
      { ...details, wmsLayers: null },
    ]);
  });

  it('refuses a change made meanwhile', async () => {
    db.getMapLayerSource.mockResolvedValueOnce(source);
    db.updateMapLayer.mockResolvedValueOnce({ status: 'stale' });
    const res = await send(`/${LAYER}`, 'PATCH', { ...details, version: 'v1', wmsLayers: null });
    expect(res.status).toBe(409);
  });

  it('removes a layer', async () => {
    const res = await send(`/${LAYER}/remove`, 'POST', { version: 'v1' });
    expect(res.status).toBe(200);
    expect(db.removeMapLayer.mock.calls[0]?.slice(1)).toEqual([LAYER, 'v1']);
  });

  it('says when a non-admin tries to remove one', async () => {
    db.removeMapLayer.mockResolvedValueOnce({ status: 'forbidden' });
    const res = await send(`/${LAYER}/remove`, 'POST', { version: 'v1' });
    expect(res.status).toBe(403);
  });
});

describe('fetching a layer for the map', () => {
  it('sends a file layer’s GeoJSON with its checksum', async () => {
    db.getMapLayerFile.mockResolvedValueOnce({
      geojson: new TextEncoder().encode('{"type":"FeatureCollection","features":[]}'),
      sha256: 'a'.repeat(64),
    });
    const res = await send(`/${LAYER}/file`, 'GET');
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBe(`"${'a'.repeat(64)}"`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.json()).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('fetches one map square from the stored address only', async () => {
    db.getMapLayerSource.mockResolvedValueOnce(source);
    const res = await send(`/${LAYER}/features/6/12/21`, 'GET');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SQUARE);
    expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(serviceCalls).toHaveLength(1);
    expect(serviceCalls[0]?.startsWith(`${SERVICE}/query?`)).toBe(true);
  });

  it('refuses a square off the map or a layer of another kind', async () => {
    const off = await send(`/${LAYER}/features/3/8/0`, 'GET');
    expect(off.status).toBe(404);
    db.getMapLayerSource.mockResolvedValueOnce({ ...source, kind: 'file', url: null });
    const file = await send(`/${LAYER}/features/3/1/1`, 'GET');
    expect(file.status).toBe(404);
    expect(serviceCalls).toEqual([]);
  });

  it('does not pass on an ArcGIS error or an answer that is not JSON', async () => {
    db.getMapLayerSource.mockResolvedValue(source);
    service = () => Response.json({ error: { code: 400, message: 'Invalid query' } });
    expect((await send(`/${LAYER}/features/6/12/21`, 'GET')).status).toBe(502);
    service = () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
    expect((await send(`/${LAYER}/features/6/12/21`, 'GET')).status).toBe(502);
  });

  it('gives a clicked feature’s fields, without empty ones', async () => {
    db.getMapLayerSource.mockResolvedValueOnce(source);
    const res = await send(`/${LAYER}/details/7`, 'GET');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      fields: [
        ['OBJECTID', 7],
        ['OWNER', 'AAA'],
        ['MILES', 1.5],
      ],
    });
  });

  it('passes on a picture only when it is one', async () => {
    db.getMapLayerSource.mockResolvedValue({
      ...source,
      kind: 'arcgis_image',
      url: 'https://maps.example.ca/rest/services/Soil/MapServer',
      idField: null,
      colourField: null,
    });
    service = () =>
      new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
    const ok = await send(`/${LAYER}/tiles/5/7/11.png`, 'GET');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    service = () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } });
    expect((await send(`/${LAYER}/tiles/5/7/11.png`, 'GET')).status).toBe(502);
  });
});

describe('addresses built for a map square', () => {
  it('asks ArcGIS for the square, simplified, with only the id and colour fields', () => {
    const url = new URL(arcgisSquareUrl(source, { z: 6, x: 12, y: 21 }));
    expect(url.origin + url.pathname).toBe(`${SERVICE}/query`);
    expect(url.searchParams.get('f')).toBe('geojson');
    expect(url.searchParams.get('outFields')).toBe('OBJECTID,OWNER');
    expect(url.searchParams.get('geometry')?.split(',')).toHaveLength(4);
    expect(url.searchParams.get('resultType')).toBe('tile');
  });

  it('asks an ArcGIS map, an image service and a WMS service for a picture', () => {
    const tile = { z: 1, x: 1, y: 1 };
    expect(
      pictureUrl(
        { ...source, kind: 'arcgis_image', url: 'https://m.example.ca/S/MapServer' },
        tile,
      ),
    ).toMatch(
      /^https:\/\/m\.example\.ca\/S\/MapServer\/export\?bbox=0\.00%2C-20037508\.34%2C20037508\.34%2C0\.00&/,
    );
    expect(
      pictureUrl(
        { ...source, kind: 'arcgis_image', url: 'https://m.example.ca/S/ImageServer' },
        tile,
      ),
    ).toContain('/ImageServer/exportImage?');
    const wms = new URL(
      pictureUrl(
        { ...source, kind: 'wms', url: 'https://m.example.ca/wms', wmsLayers: 'crops' },
        tile,
      ),
    );
    expect(wms.searchParams.get('LAYERS')).toBe('crops');
    expect(wms.searchParams.get('CRS')).toBe('EPSG:3857');
  });
});

// Codex's review of 11c467e.
describe('fetching outside services safely', () => {
  /** A body sent in 1 MB pieces, `pieces` of them, then failing if `fail`; counts what was read. */
  function stream(pieces: number, fail = false) {
    const read = { pieces: 0, cancelled: false };
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (read.pieces === pieces) {
          if (fail) controller.error(new Error('connection reset'));
          else controller.close();
          return;
        }
        read.pieces += 1;
        controller.enqueue(new Uint8Array(1024 * 1024).fill(32));
      },
      cancel() {
        read.cancelled = true;
      },
    });
    return { body, read };
  }

  it('refuses a redirect instead of following it', async () => {
    service = () =>
      new Response(null, { status: 302, headers: { location: 'https://elsewhere.example.net/x' } });
    const res = await send('/inspect', 'POST', { url: SERVICE, field: null });
    expect(res.status).toBe(502);
    expect(serviceCalls).toEqual([`${SERVICE}?f=json`]);
    expect(serviceInits[0]?.redirect).toBe('manual');
  });

  it('asks every service with redirects refused', async () => {
    db.getMapLayerSource.mockResolvedValueOnce(source);
    await send(`/${LAYER}/features/6/12/21`, 'GET');
    expect(serviceInits.map((init) => init?.redirect)).toEqual(['manual']);
  });

  it('checks who may add a layer before fetching anything', async () => {
    const web = { ...details, source: 'web', url: SERVICE, wmsLayers: null };
    db.isOrgAdmin.mockResolvedValueOnce(false);
    expect((await send('', 'POST', web)).status).toBe(403);
    expect((await send('?organization_id=org-b', 'POST', web)).status).toBe(403);
    expect(serviceCalls).toEqual([]);
    expect(db.createMapLayer).not.toHaveBeenCalled();
  });

  it('stops reading an answer as soon as it passes the limit, whatever its length says', async () => {
    const { body, read } = stream(20);
    service = () => new Response(body, { headers: { 'content-type': 'application/json' } });
    db.getMapLayerSource.mockResolvedValueOnce(source);
    const res = await send(`/${LAYER}/features/6/12/21`, 'GET');
    expect(res.status).toBe(502);
    // The 8 MB limit, plus the one piece a stream reads ahead.
    expect(read.pieces).toBeLessThanOrEqual(10);
    expect(read.cancelled).toBe(true);
  });

  it('treats a body that fails on the way as the service failing', async () => {
    const { body } = stream(1, true);
    service = () => new Response(body, { headers: { 'content-type': 'application/json' } });
    const res = await send('/inspect', 'POST', { url: SERVICE, field: null });
    expect(res.status).toBe(502);
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe('LAYER_SERVICE_FAILED');
  });

  it('treats a body that fails while adding a layer the same way', async () => {
    const { body } = stream(1, true);
    service = () => new Response(body, { headers: { 'content-type': 'application/json' } });
    const res = await send('', 'POST', {
      ...details,
      source: 'web',
      url: SERVICE,
      wmsLayers: null,
    });
    expect(res.status).toBe(502);
    expect(db.createMapLayer).not.toHaveBeenCalled();
  });
});
