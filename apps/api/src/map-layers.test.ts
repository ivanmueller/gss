import type { LayerInspection, MapLayerView } from '@grain/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { createApp } from './index';
import { arcgisSquareUrl, crc32, overviewPageUrl, pictureType, pictureUrl } from './map-layers';
import type { MapLayerSource } from './map-layers-db';
import { ENV, fakeDatabase, USER_ID, VALID_TOKEN } from './testing/helpers';

// /api/v1/map-layers (F-107). Every service, address and value is synthetic.
let db = fakeDatabase();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
const app = createApp(openDatabase);

/** A real 1-pixel PNG. */
const ONE_PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const ONE_PIXEL_BYTES = Uint8Array.from(atob(ONE_PIXEL), (c) => c.charCodeAt(0));

const AUTH = { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' };
const LAYER = '00000000-0000-4000-8000-0000000a1a01';
const VERSION = '00000000-0000-4000-8000-00000000f001';
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
    { name: 'OWNER2', type: 'esriFieldTypeString' },
    { name: 'NET', type: 'esriFieldTypeString' },
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
    if (url.includes('returnCountOnly=true')) return Response.json({ count: 42 });
    if (url.includes('groupByFieldsForStatistics=OWNER2')) {
      return Response.json({
        features: [
          { attributes: { OWNER2: 'BBB', gss_count: 7 } },
          { attributes: { OWNER2: 'CCC', gss_count: 1 } },
        ],
      });
    }
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
  organizationId: 'org-a',
  kind: 'arcgis_features',
  url: SERVICE,
  wmsLayers: null,
  idField: 'OBJECTID',
  colourField: 'OWNER',
  alsoFields: [],
  onlyField: null,
  onlyValues: [],
  definitionExpression: null,
  tileLevels: null,
};

/** How a layer added by hand is presented (F-138). */
const PLAIN = {
  lineWidth: null,
  opacity: 1,
  minZoom: null,
  maxZoom: null,
  othersShown: true,
  map: null,
  mapVisible: true,
  tileLevels: null,
  definitionExpression: null,
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
      fields: ['OWNER', 'TRACKS', 'OWNER2', 'NET'],
      values: [
        { value: 'AAA', count: 9 },
        { value: 'BBB', count: 5 },
      ],
      count: 42,
      drawing: { renderer: null, transparency: 0, minScale: null, maxScale: null },
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
      alsoFields: [],
      onlyField: null,
      onlyValues: [],
      ...PLAIN,
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
      { ...details, wmsLayers: null, alsoFields: [], onlyField: null, onlyValues: [] },
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
    service = () => new Response(ONE_PIXEL_BYTES, { headers: { 'content-type': 'image/png' } });
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

// The zoomed-out view (F-134).
describe('a zoomed-out view', () => {
  const overview = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'MultiLineString',
          coordinates: [
            [
              [-110, 50],
              [-109, 50.5],
            ],
          ],
        },
        properties: { OWNER: 'AAA' },
      },
    ],
  };

  it('counts the layer’s pieces for an admin', async () => {
    db.getMapLayerSource.mockResolvedValueOnce(source);
    service = () => Response.json({ count: 302774 });
    const res = await send(`/${LAYER}/count`, 'GET');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 302774, pageSize: 8000 });
    expect(serviceCalls[0]).toBe(`${SERVICE}/query?where=1%3D1&returnCountOnly=true&f=json`);
    expect(db.isOrgAdmin.mock.calls[0]?.[1]).toBe('org-a');
  });

  it('refuses a layer too big for one', async () => {
    db.getMapLayerSource.mockResolvedValueOnce(source);
    service = () => Response.json({ count: 1_000_001 });
    expect((await send(`/${LAYER}/count`, 'GET')).status).toBe(422);
  });

  it('is for admins only, fetching nothing otherwise', async () => {
    db.getMapLayerSource.mockResolvedValue(source);
    db.isOrgAdmin.mockResolvedValue(false);
    expect((await send(`/${LAYER}/count`, 'GET')).status).toBe(403);
    expect((await send(`/${LAYER}/pages/0`, 'GET')).status).toBe(403);
    db.saveMapLayerOverviewPart.mockResolvedValueOnce({ status: 'forbidden' });
    expect(
      (await send(`/${LAYER}/overview/${VERSION}/0`, 'PUT', { features: overview.features }))
        .status,
    ).toBe(403);
    db.publishMapLayerOverview.mockResolvedValueOnce({ status: 'forbidden' });
    expect(
      (
        await send(`/${LAYER}/overview/${VERSION}/publish`, 'POST', {
          grouping: 'g',
          partCount: 1,
          sourceCount: 1,
        })
      ).status,
    ).toBe(403);
    expect(serviceCalls).toEqual([]);
  });

  it('is only for live lines layers with an id field', async () => {
    db.getMapLayerSource.mockResolvedValueOnce({ ...source, kind: 'file', url: null });
    expect((await send(`/${LAYER}/count`, 'GET')).status).toBe(422);
    db.getMapLayerSource.mockResolvedValueOnce({ ...source, idField: null });
    expect((await send(`/${LAYER}/pages/0`, 'GET')).status).toBe(422);
    expect(serviceCalls).toEqual([]);
  });

  it('passes on one page in ArcGIS’s compact format, and nothing else', async () => {
    db.getMapLayerSource.mockResolvedValue(source);
    service = () =>
      new Response(new Uint8Array([8, 1, 16, 2]), {
        headers: { 'content-type': 'application/x-protobuf' },
      });
    const res = await send(`/${LAYER}/pages/16000`, 'GET');
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([8, 1, 16, 2]));
    const asked = new URL(serviceCalls[0] ?? '');
    expect(asked.origin + asked.pathname).toBe(`${SERVICE}/query`);
    expect(asked.searchParams.get('resultOffset')).toBe('16000');
    expect(asked.searchParams.get('orderByFields')).toBe('OBJECTID');
    expect(asked.searchParams.get('f')).toBe('pbf');
    service = () => Response.json({ error: { code: 400 } });
    expect((await send(`/${LAYER}/pages/0`, 'GET')).status).toBe(502);
    expect((await send(`/${LAYER}/pages/-1`, 'GET')).status).toBe(404);
    expect((await send(`/${LAYER}/pages/1.5`, 'GET')).status).toBe(404);
  });

  it('keeps a part of a view, checked again', async () => {
    const res = await send(`/${LAYER}/overview/${VERSION}/3`, 'PUT', {
      features: overview.features,
    });
    expect(res.status).toBe(200);
    const [, layer, part] = db.saveMapLayerOverviewPart.mock.calls[0] ?? [];
    expect(layer).toBe(LAYER);
    expect(part).toMatchObject({ version: VERSION, partNo: 3, featureCount: 1 });
    const kept = JSON.parse(new TextDecoder().decode(part?.features)) as { properties: unknown }[];
    expect(kept[0]?.properties).toEqual({ OWNER: 'AAA' });
  });

  it('refuses a part that is not GeoJSON, too big, or misnumbered', async () => {
    expect(
      (await send(`/${LAYER}/overview/${VERSION}/0`, 'PUT', { features: [{ type: 'Feature' }] }))
        .status,
    ).toBe(422);
    expect((await send(`/${LAYER}/overview/${VERSION}/64`, 'PUT', { features: [] })).status).toBe(
      404,
    );
    expect((await send(`/${LAYER}/overview/not-a-uuid/0`, 'PUT', { features: [] })).status).toBe(
      404,
    );
    const big = await app.request(
      `/api/v1/map-layers/${LAYER}/overview/${VERSION}/0`,
      { method: 'PUT', headers: AUTH, body: JSON.stringify({ features: ['x'.repeat(200_000)] }) },
      ENV,
    );
    expect(big.status).toBe(413);
    expect(db.saveMapLayerOverviewPart).not.toHaveBeenCalled();
  });

  it('says when a part is sent to a view already published', async () => {
    db.saveMapLayerOverviewPart.mockResolvedValueOnce({ status: 'sealed' });
    const res = await send(`/${LAYER}/overview/${VERSION}/1`, 'PUT', {
      features: overview.features,
    });
    expect(res.status).toBe(409);
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe('SEALED');
  });

  it('publishes a view, or says why not', async () => {
    const publish = () =>
      send(`/${LAYER}/overview/${VERSION}/publish`, 'POST', {
        grouping: 'g',
        partCount: 2,
        sourceCount: 302774,
      });
    expect((await publish()).status).toBe(200);
    expect(db.publishMapLayerOverview.mock.calls[0]?.slice(1)).toEqual([
      LAYER,
      { version: VERSION, grouping: 'g', partCount: 2, sourceCount: 302774 },
    ]);
    db.publishMapLayerOverview.mockResolvedValueOnce({ status: 'stale' });
    expect((await publish()).status).toBe(409);
    db.publishMapLayerOverview.mockResolvedValueOnce({ status: 'incomplete' });
    const incomplete = await publish();
    expect(incomplete.status).toBe(409);
    expect((await incomplete.json<{ error: { code: string } }>()).error.code).toBe('INCOMPLETE');
  });

  it('sends the published view to every member as one document', async () => {
    const encode = (features: unknown[]) => new TextEncoder().encode(JSON.stringify(features));
    db.getMapLayerOverview.mockResolvedValueOnce({
      parts: [encode(overview.features), encode(overview.features)],
      version: VERSION,
    });
    const res = await send(`/${LAYER}/overview`, 'GET');
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBe(`"${VERSION}"`);
    expect(await res.json()).toEqual({
      type: 'FeatureCollection',
      features: [...overview.features, ...overview.features],
    });
    expect((await send(`/${LAYER}/overview`, 'GET')).status).toBe(404);
  });

  it('asks for the page with the colour field only, simplified to about a kilometre', () => {
    const url = new URL(overviewPageUrl(source, 0));
    expect(url.searchParams.get('outFields')).toBe('OWNER');
    expect(url.searchParams.get('outSR')).toBe('102100');
    expect(JSON.parse(url.searchParams.get('quantizationParameters') ?? '{}')).toMatchObject({
      mode: 'view',
      tolerance: 1000,
    });
  });
});

// A railroad's lines as on ArcGIS (F-137).
describe('shared fields and a limit', () => {
  it('counts the values of every field that counts, within the limit', async () => {
    const res = await send('/inspect', 'POST', {
      url: SERVICE,
      field: 'OWNER',
      alsoFields: ['OWNER2'],
      onlyField: 'NET',
      onlyValues: ['M', 'I'],
    });
    expect(res.status).toBe(200);
    const answer = await res.json<LayerInspection>();
    expect(answer.values).toEqual([
      { value: 'BBB', count: 12 },
      { value: 'AAA', count: 9 },
      { value: 'CCC', count: 1 },
    ]);
    const asked = serviceCalls.filter((u) => u.includes('/query?')).map((u) => new URL(u));
    expect(asked.every((u) => u.searchParams.get('where') === "NET IN ('M','I')")).toBe(true);
  });

  it('refuses fields the layer does not have, or fields that count without a colour field', async () => {
    const bad = await send('/inspect', 'POST', {
      url: SERVICE,
      field: 'OWNER',
      alsoFields: ['NOPE'],
    });
    expect(bad.status).toBe(422);
    const lonely = await send('/inspect', 'POST', {
      url: SERVICE,
      field: null,
      alsoFields: ['OWNER2'],
    });
    expect(lonely.status).toBe(422);
  });

  it('adds a layer with them, checked against the service’s fields', async () => {
    const web = { ...details, source: 'web', url: SERVICE, wmsLayers: null };
    const res = await send('', 'POST', {
      ...web,
      alsoFields: ['OWNER2'],
      onlyField: 'NET',
      onlyValues: ['M', 'I'],
    });
    expect(res.status).toBe(201);
    expect(db.createMapLayer.mock.calls[0]?.[2]).toMatchObject({
      alsoFields: ['OWNER2'],
      onlyField: 'NET',
      onlyValues: ['M', 'I'],
    });
    expect((await send('', 'POST', { ...web, onlyField: 'NOPE', onlyValues: ['M'] })).status).toBe(
      422,
    );
    expect(
      (await send('', 'POST', { ...web, onlyField: 'NET', onlyValues: ["M' OR 1=1"] })).status,
    ).toBe(422);
  });

  it('refuses them on a file layer', async () => {
    const res = await send('', 'POST', {
      ...details,
      alsoFields: ['OWNER2'],
      source: 'file',
      fileName: 'rail.geojson',
      geojson: {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: { type: 'Point', coordinates: [-100, 50] }, properties: {} },
        ],
      },
    });
    expect(res.status).toBe(422);
    expect(db.createMapLayer).not.toHaveBeenCalled();
  });

  it('changes them on an admin’s word only, fetching nothing otherwise', async () => {
    db.getMapLayerSource.mockResolvedValue(source);
    const change = { ...details, version: 'v1', wmsLayers: null, alsoFields: ['OWNER2'] };
    db.isOrgAdmin.mockResolvedValueOnce(false);
    expect((await send(`/${LAYER}`, 'PATCH', change)).status).toBe(403);
    expect(serviceCalls).toEqual([]);
    expect((await send(`/${LAYER}`, 'PATCH', change)).status).toBe(200);
    expect(db.updateMapLayer.mock.calls[0]?.[3]).toMatchObject({
      alsoFields: ['OWNER2'],
      onlyField: null,
      onlyValues: [],
    });
  });

  it('asks the service for the limited features with every field that counts', () => {
    const shared = { ...source, alsoFields: ['OWNER2'], onlyField: 'NET', onlyValues: ['M', 'I'] };
    const square = new URL(arcgisSquareUrl(shared, { z: 6, x: 12, y: 21 }));
    expect(square.searchParams.get('where')).toBe("NET IN ('M','I')");
    expect(square.searchParams.get('outFields')).toBe('OBJECTID,OWNER,OWNER2');
    const page = new URL(overviewPageUrl(shared, 0));
    expect(page.searchParams.get('where')).toBe("NET IN ('M','I')");
    expect(page.searchParams.get('outFields')).toBe('OWNER,OWNER2');
  });
});

describe('layers from an ArcGIS map (F-138)', () => {
  const ITEM = '96ec03e4fc8546bd8a864e39a2c3fc41';
  const FROM_MAP = {
    lineWidth: 0.998,
    opacity: 0.8,
    minZoom: 3,
    maxZoom: 18,
    othersShown: false,
    map: { itemId: ITEM, title: 'Synthetic rail map' },
  };

  it('passes on a map’s item from ArcGIS Online, for admins', async () => {
    service = (url) =>
      url.startsWith('https://www.arcgis.com/')
        ? Response.json({ operationalLayers: [] })
        : new Response('no', { status: 404 });
    const res = await send('/arcgis-item', 'POST', { itemId: ITEM, part: 'data' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ operationalLayers: [] });
    expect(serviceCalls).toEqual([
      `https://www.arcgis.com/sharing/rest/content/items/${ITEM}/data?f=json`,
    ]);
    const info = await send('/arcgis-item', 'POST', { itemId: ITEM, part: 'info' });
    expect(info.status).toBe(200);
    expect(serviceCalls[1]).toBe(
      `https://www.arcgis.com/sharing/rest/content/items/${ITEM}?f=json`,
    );
  });

  it('fetches nothing for a member who is not an admin, or an id that is not one', async () => {
    db.isOrgAdmin.mockResolvedValueOnce(false);
    expect((await send('/arcgis-item', 'POST', { itemId: ITEM, part: 'data' })).status).toBe(403);
    for (const itemId of ['../../x', `${ITEM}/data?x=`, ITEM.toUpperCase()]) {
      const res = await send('/arcgis-item', 'POST', { itemId, part: 'data' });
      expect(res.status).toBe(422);
    }
    expect((await send('/arcgis-item', 'POST', { itemId: ITEM, part: 'other' })).status).toBe(422);
    expect(serviceCalls).toEqual([]);
  });

  it('passes on nothing that is not JSON, or a refusal', async () => {
    service = () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } });
    expect((await send('/arcgis-item', 'POST', { itemId: ITEM, part: 'data' })).status).toBe(502);
    service = () => new Response('', { status: 302, headers: { Location: 'https://x.example' } });
    expect((await send('/arcgis-item', 'POST', { itemId: ITEM, part: 'data' })).status).toBe(502);
  });

  it('adds a layer as ArcGIS presents it, with the map’s filter tried on the service first', async () => {
    const res = await send('', 'POST', {
      ...details,
      ...FROM_MAP,
      source: 'web',
      url: SERVICE,
      wmsLayers: null,
      definitionExpression: "STATE = 'TX'",
    });
    expect(res.status).toBe(201);
    expect(db.createMapLayer.mock.calls[0]?.[2]).toMatchObject({
      ...FROM_MAP,
      definitionExpression: "STATE = 'TX'",
    });
    const count = serviceCalls.find((url) => url.includes('returnCountOnly=true'));
    expect(new URL(count ?? 'https://x').searchParams.get('where')).toBe("(STATE = 'TX')");
  });

  it('refuses a filter the service does not take, keeping nothing', async () => {
    const before = service;
    service = (url) =>
      url.includes('returnCountOnly=true')
        ? Response.json({ error: { code: 400, message: 'Invalid query' } })
        : before(url);
    const res = await send('', 'POST', {
      ...details,
      source: 'web',
      url: SERVICE,
      wmsLayers: null,
      definitionExpression: 'NOPE = 1',
    });
    expect(res.status).toBe(502);
    expect(db.createMapLayer).not.toHaveBeenCalled();
  });

  it('refuses a filter that could change the query, on a picture layer, or zooms out of order', async () => {
    for (const body of [
      { definitionExpression: '1=1; drop table x' },
      { definitionExpression: '1=1 -- x' },
      // Unbalanced, it would undo the layer's limit (Codex's review of 1f328f9).
      { definitionExpression: '1=1) OR (1=1' },
      { definitionExpression: '1=1\u0085' },
      // Oracle's q quoting, and a comment past a line separator (Codex's re-reviews).
      { definitionExpression: "q'!'('!' IS NOT NULL) OR (q'!')'!' IS NOT NULL" },
      { definitionExpression: "'a\u2028' IS NOT NULL /*(*/ ) OR (1=1 /*)*/" },
      { minZoom: 9, maxZoom: 4 },
      { opacity: 0 },
      { map: { itemId: '../x', title: 'M' } },
    ]) {
      const res = await send('', 'POST', {
        ...details,
        ...body,
        source: 'web',
        url: SERVICE,
        wmsLayers: null,
      });
      expect(res.status).toBe(422);
    }
    const picture = await send('', 'POST', {
      ...details,
      colourField: null,
      colours: [],
      source: 'web',
      url: 'https://services.example.com/rest/services/Elevation/MapServer',
      wmsLayers: null,
      definitionExpression: '1=1',
    });
    expect(picture.status).toBe(422);
    expect(db.createMapLayer).not.toHaveBeenCalled();
  });

  it('adds a map’s own features as a file layer with its drawing', async () => {
    const res = await send('', 'POST', {
      ...details,
      ...FROM_MAP,
      colourField: null,
      colours: [],
      othersShown: true,
      source: 'file',
      fileName: 'Amtrak Lines (from the ArcGIS map)',
      geojson: SQUARE,
    });
    expect(res.status).toBe(201);
    expect(db.createMapLayer.mock.calls[0]?.[2]).toMatchObject({
      kind: 'file',
      lineWidth: 0.998,
      map: FROM_MAP.map,
      definitionExpression: null,
    });
  });

  it('asks the service for its squares and pages within the map’s filter', () => {
    const filtered = { ...source, definitionExpression: "STATE = 'TX'" };
    const square = new URL(arcgisSquareUrl(filtered, { z: 5, x: 5, y: 11 }));
    expect(square.searchParams.get('where')).toBe("(STATE = 'TX')");
    const page = new URL(overviewPageUrl({ ...filtered, onlyField: 'NET', onlyValues: ['M'] }, 0));
    expect(page.searchParams.get('where')).toBe("(STATE = 'TX') AND NET IN ('M')");
  });
});

describe('pre-drawn ArcGIS maps (F-141)', () => {
  const TILED = 'https://tiles.example.com/tiles/x/arcgis/rest/services/Crop_Density/MapServer';
  const lods = Array.from({ length: 24 }, (_, level) => ({
    level,
    scale: 591_657_527.591555 / 2 ** level,
  }));
  const tiled = {
    name: 'Synthetic crop density',
    capabilities: 'Map,TilesOnly,Tilemap',
    singleFusedMapCache: true,
    minLOD: 3,
    maxLOD: 10,
    tileInfo: {
      rows: 256,
      cols: 256,
      origin: { x: -20037508.342787, y: 20037508.342787 },
      spatialReference: { wkid: 102100, latestWkid: 3857 },
      lods,
    },
  };
  const PNG = ONE_PIXEL_BYTES;
  const picture: MapLayerSource = {
    ...source,
    kind: 'arcgis_tiles',
    url: TILED,
    idField: null,
    colourField: null,
    tileLevels: { min: 3, max: 10 },
  };

  it('takes a pre-drawn map as such, with its levels', async () => {
    service = (url) =>
      url.startsWith(`${TILED}?f=json`)
        ? Response.json(tiled)
        : new Response('no', { status: 404 });
    const inspected = await send('/inspect', 'POST', { url: TILED, field: null });
    expect(inspected.status).toBe(200);
    expect((await inspected.json<LayerInspection>()).kind).toBe('arcgis_tiles');
    const res = await send('', 'POST', {
      ...details,
      colourField: null,
      colours: [],
      source: 'web',
      url: TILED,
      wmsLayers: null,
      mapVisible: false,
    });
    expect(res.status).toBe(201);
    expect(db.createMapLayer.mock.calls[0]?.[2]).toMatchObject({
      kind: 'arcgis_tiles',
      url: TILED,
      tileLevels: { min: 3, max: 10 },
      mapVisible: false,
    });
  });

  it('refuses a pre-drawn map whose squares are not the standard ones', async () => {
    service = () =>
      Response.json({ ...tiled, tileInfo: { ...tiled.tileInfo, rows: 512, cols: 512 } });
    const res = await send('/inspect', 'POST', { url: TILED, field: null });
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain('cannot place');
  });

  it('passes on a pre-drawn square by level, row and column, checked as a picture', async () => {
    db.getMapLayerSource.mockResolvedValue(picture);
    service = () => new Response(PNG, { headers: { 'Content-Type': 'application/octet-stream' } });
    const res = await send(`/${LAYER}/tiles/5/7/11.png`, 'GET');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(serviceCalls).toEqual([`${TILED}/tile/5/11/7`]);
  });

  it('asks for nothing outside its levels, and gives an empty square where it has none', async () => {
    db.getMapLayerSource.mockResolvedValue(picture);
    expect((await send(`/${LAYER}/tiles/11/7/11.png`, 'GET')).status).toBe(404);
    expect((await send(`/${LAYER}/tiles/2/1/1.png`, 'GET')).status).toBe(404);
    expect(serviceCalls).toEqual([]);
    service = () => new Response('Page Not Found', { status: 404 });
    expect((await send(`/${LAYER}/tiles/5/7/11.png`, 'GET')).status).toBe(204);
  });

  it('passes on nothing that is not a picture', async () => {
    db.getMapLayerSource.mockResolvedValue(picture);
    service = () =>
      new Response('<html>', { headers: { 'Content-Type': 'application/octet-stream' } });
    expect((await send(`/${LAYER}/tiles/5/7/11.png`, 'GET')).status).toBe(502);
    // Text after a picture's first bytes is not a picture (Codex's review of 4026e22).
    for (const start of [
      [0x89, 0x50, 0x4e, 0x47],
      [0xff, 0xd8, 0xff],
    ]) {
      const fake = new Uint8Array([
        ...start,
        ...new TextEncoder().encode('<script>x</script>'.repeat(4)),
      ]);
      service = () =>
        new Response(fake, { headers: { 'Content-Type': 'application/octet-stream' } });
      expect((await send(`/${LAYER}/tiles/5/7/11.png`, 'GET')).status).toBe(502);
    }
  });

  it('gives a picture layer’s legend, small pictures only', async () => {
    db.getMapLayerSource.mockResolvedValue(picture);
    service = (url) =>
      url === `${TILED}/legend?f=json`
        ? Response.json({
            layers: [
              {
                layerName: 'All Annual Crops',
                legend: [
                  {
                    label: 'Most Dense - <b>Least</b> Dense',
                    contentType: 'image/png',
                    imageData: ONE_PIXEL,
                  },
                  { label: 'Too big', contentType: 'image/png', imageData: 'A'.repeat(30_000) },
                  { label: 'Not a picture', contentType: 'text/html', imageData: 'PGI+' },
                  // Text called a PNG (Codex's review of 4026e22).
                  {
                    label: 'Text called a PNG',
                    contentType: 'image/png',
                    imageData: btoa('hello, not a picture'),
                  },
                  { label: 'A PNG called a JPEG', contentType: 'image/jpeg', imageData: ONE_PIXEL },
                ],
              },
            ],
          })
        : new Response('no', { status: 404 });
    const res = await send(`/${LAYER}/legend`, 'GET');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      entries: [
        { label: 'Most Dense - Least Dense', image: `data:image/png;base64,${ONE_PIXEL}` },
        { label: 'Too big', image: null },
        { label: 'Not a picture', image: null },
        { label: 'Text called a PNG', image: null },
        { label: 'A PNG called a JPEG', image: null },
      ],
    });
    db.getMapLayerSource.mockResolvedValue(source);
    expect((await send(`/${LAYER}/legend`, 'GET')).status).toBe(404);
  });
});

describe('pictureType (Codex’s reviews of 4026e22, b9746f9 and aca667e)', () => {
  /** A minimal JPEG: start, a quantization table, a frame, a scan with two bytes of data, end. */
  const jpeg = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xdb,
    0x00,
    0x43,
    0x00,
    ...Array.from({ length: 64 }, () => 1),
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    0x00,
    0x01,
    0x00,
    0x01,
    0x01,
    0x01,
    0x11,
    0x00,
    0xff,
    0xda,
    0x00,
    0x08,
    0x01,
    0x01,
    0x00,
    0x00,
    0x3f,
    0x00,
    0x12,
    0x34,
    0xff,
    0xd9,
  ]);

  /** A PNG chunk with its length and correct checksum. */
  function chunk(type: string, data: Uint8Array): number[] {
    const body = new Uint8Array([...new TextEncoder().encode(type), ...data]);
    const crc = crc32(body, 0, body.length);
    const n = data.length;
    return [
      n >>> 24,
      (n >>> 16) & 255,
      (n >>> 8) & 255,
      n & 255,
      ...body,
      crc >>> 24,
      (crc >>> 16) & 255,
      (crc >>> 8) & 255,
      crc & 255,
    ];
  }

  it('takes whole PNGs and JPEGs', async () => {
    expect(await pictureType(ONE_PIXEL_BYTES)).toBe('image/png');
    expect(await pictureType(jpeg)).toBe('image/jpeg');
    expect(await pictureType(new Uint8Array([...jpeg, 0, 0]))).toBe('image/jpeg');
  });

  it('refuses wrappers with a picture’s markers around anything else', async () => {
    const text = [...new TextEncoder().encode('<b>not a picture</b>')];
    // A PNG signature with IHDR and IEND where they would be, but no real chunks.
    const fakePng = new Uint8Array(57);
    fakePng.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    fakePng.set([0x49, 0x48, 0x44, 0x52], 12);
    fakePng.set([0x49, 0x45, 0x4e, 0x44], 49);
    // A PNG whose checksum is wrong, cut short, or without an end.
    const wrongCrc = ONE_PIXEL_BYTES.slice();
    wrongCrc[29] = (wrongCrc[29] ?? 0) ^ 0xff;
    // A PNG of good chunks with text for its picture data (Codex's re-review of aca667e).
    const header = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]);
    const textInside = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...chunk('IHDR', header),
      ...chunk('IDAT', new Uint8Array(text)),
      ...chunk('IEND', new Uint8Array(0)),
    ]);
    for (const bad of [
      fakePng,
      wrongCrc,
      textInside,
      ONE_PIXEL_BYTES.slice(0, ONE_PIXEL_BYTES.length - 12),
      new Uint8Array([0xff, 0xd8, 0xff, ...text, 0xff, 0xd9]),
      new Uint8Array([0xff, 0xd8, ...text, 0xff, 0xd9]),
      // Empty frame and scan headers (Codex's re-review of aca667e).
      new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x02, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]),
      // A JPEG without its quantization table, or with a non-zero byte after its end.
      jpeg.filter((_, k) => k < 2 || k > 70),
      new Uint8Array([...jpeg, 0x41]),
      new Uint8Array(0),
    ]) {
      expect(await pictureType(bad)).toBeNull();
    }
  });

  it('takes a PNG with real picture data built the same way', async () => {
    const { deflateSync } = await import('node:zlib');
    const header = new Uint8Array([0, 0, 0, 2, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
    // One row: its filter byte and two RGB pixels.
    const pixels = deflateSync(new Uint8Array([0, 255, 0, 0, 0, 0, 255]));
    const png = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...chunk('IHDR', header),
      ...chunk('IDAT', new Uint8Array(pixels)),
      ...chunk('IEND', new Uint8Array(0)),
    ]);
    expect(await pictureType(png)).toBe('image/png');
    // The same with one pixel too few.
    const short = deflateSync(new Uint8Array([0, 255, 0, 0]));
    const tooShort = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...chunk('IHDR', header),
      ...chunk('IDAT', new Uint8Array(short)),
      ...chunk('IEND', new Uint8Array(0)),
    ]);
    expect(await pictureType(tooShort)).toBeNull();
  });
});
