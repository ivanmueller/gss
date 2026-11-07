import { describe, expect, it } from 'vitest';

import {
  assignColours,
  createMapLayerSchema,
  distinctColours,
  featureFields,
  featureValueCounts,
  isTile,
  LAYER_PALETTE,
  MAX_LAYER_FEATURES,
  MAX_TILES_PER_VIEW,
  normalizeFeatureCollection,
  parseLayerSource,
  simplifyDegrees,
  tileBounds,
  tileBoundsMercator,
  tilesForView,
  type LayerFeatureCollection,
} from './mapLayers';

describe('parseLayerSource', () => {
  it('takes an ArcGIS FeatureServer layer as lines, areas or points', () => {
    expect(
      parseLayerSource(
        ' https://services.example.com/abc/ArcGIS/rest/services/Rail_Lines/FeatureServer/0 ',
      ),
    ).toEqual({
      ok: true,
      kind: 'arcgis_features',
      url: 'https://services.example.com/abc/ArcGIS/rest/services/Rail_Lines/FeatureServer/0',
      wmsLayers: null,
    });
  });

  it('takes a whole FeatureServer as its first layer, dropping the query', () => {
    expect(
      parseLayerSource('https://services.example.com/rest/services/Rail/FeatureServer/?f=pjson'),
    ).toMatchObject({
      ok: true,
      kind: 'arcgis_features',
      url: 'https://services.example.com/rest/services/Rail/FeatureServer/0',
    });
  });

  it('takes a MapServer layer as features and a whole MapServer or ImageServer as pictures', () => {
    expect(
      parseLayerSource('https://maps.example.ca/arcgis/rest/services/Soil/MapServer/2'),
    ).toMatchObject({ ok: true, kind: 'arcgis_features' });
    expect(
      parseLayerSource('https://maps.example.ca/arcgis/rest/services/Soil/MapServer'),
    ).toMatchObject({
      ok: true,
      kind: 'arcgis_image',
      url: 'https://maps.example.ca/arcgis/rest/services/Soil/MapServer',
    });
    expect(
      parseLayerSource('https://maps.example.ca/arcgis/rest/services/Crops/ImageServer'),
    ).toMatchObject({ ok: true, kind: 'arcgis_image' });
  });

  it('takes a WMS address with the layers it names', () => {
    expect(
      parseLayerSource(
        'https://maps.example.ca/geoserver/wms?SERVICE=WMS&REQUEST=GetMap&LAYERS=crops:2025,roads',
      ),
    ).toEqual({
      ok: true,
      kind: 'wms',
      url: 'https://maps.example.ca/geoserver/wms',
      wmsLayers: 'crops:2025,roads',
    });
    expect(parseLayerSource('https://maps.example.ca/cgi/ows')).toMatchObject({
      ok: true,
      kind: 'wms',
      wmsLayers: null,
    });
  });

  it('refuses addresses that are not https, not public or not a map service', () => {
    for (const text of [
      '',
      'http://services.example.com/x/FeatureServer/0',
      'https://127.0.0.1/x/FeatureServer/0',
      'https://localhost/x/FeatureServer/0',
      'https://intranet.local/x/FeatureServer/0',
      'https://services.example.com:8443/x/FeatureServer/0',
      'https://user:pw@services.example.com/x/FeatureServer/0',
      'https://services.example.com/data/rail.zip',
      'javascript:alert(1)',
    ]) {
      expect(parseLayerSource(text).ok, text).toBe(false);
    }
  });
});

describe('colours', () => {
  it('gives every value its own colour, the palette first', () => {
    const colours = distinctColours(1000);
    expect(colours).toHaveLength(1000);
    expect(new Set(colours).size).toBe(1000);
    expect(colours.slice(0, LAYER_PALETTE.length)).toEqual([...LAYER_PALETTE]);
    for (const colour of colours) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('colours the most common values first', () => {
    expect(
      assignColours([
        { value: 'SHORT', count: 3 },
        { value: 'CN', count: 300 },
        { value: '', count: 50 },
        { value: 'CPKC', count: 200 },
      ]),
    ).toEqual([
      ['CN', LAYER_PALETTE[0]],
      ['CPKC', LAYER_PALETTE[1]],
      ['SHORT', LAYER_PALETTE[2]],
    ]);
  });

  it('keeps at most 2,000 values', () => {
    const values = Array.from({ length: 2500 }, (_, i) => ({ value: `R${String(i)}`, count: i }));
    const assigned = assignColours(values);
    expect(assigned).toHaveLength(2000);
    expect(assigned[0]?.[0]).toBe('R2499');
  });
});

describe('createMapLayerSchema', () => {
  const details = {
    name: 'Rail lines',
    sourceName: 'U.S. Bureau of Transportation Statistics',
    termsUrl: 'https://example.com/terms',
    termsNote: 'Public domain.',
    colour: '#2f6baa',
    colourField: 'RROWNER1',
    colours: [['CN', '#e6194b']],
  };

  it('takes a web layer and a file layer', () => {
    expect(
      createMapLayerSchema.safeParse({
        ...details,
        source: 'web',
        url: 'https://x.example.com/FeatureServer/0',
        wmsLayers: null,
      }).success,
    ).toBe(true);
    expect(
      createMapLayerSchema.safeParse({
        ...details,
        source: 'file',
        fileName: 'elevators.geojson',
        geojson: { type: 'FeatureCollection', features: [] },
      }).success,
    ).toBe(true);
  });

  it('refuses a missing terms note, a bad colour, a repeated value and extra fields', () => {
    const web = {
      ...details,
      source: 'web',
      url: 'https://x.example.com/FeatureServer/0',
      wmsLayers: null,
    };
    expect(createMapLayerSchema.safeParse({ ...web, termsNote: ' ' }).success).toBe(false);
    expect(createMapLayerSchema.safeParse({ ...web, colour: 'red' }).success).toBe(false);
    expect(
      createMapLayerSchema.safeParse({ ...web, termsUrl: 'javascript:alert(1)' }).success,
    ).toBe(false);
    expect(
      createMapLayerSchema.safeParse({
        ...web,
        colours: [
          ['CN', '#000000'],
          ['CN', '#111111'],
        ],
      }).success,
    ).toBe(false);
    expect(createMapLayerSchema.safeParse({ ...web, extra: 1 }).success).toBe(false);
  });
});

describe('normalizeFeatureCollection', () => {
  const line = (coordinates: unknown, properties: unknown = { OWNER: 'CN' }) => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates },
    properties,
  });

  it('keeps shapes in longitude and latitude, rounded, numbered, with plain fields', () => {
    const result = normalizeFeatureCollection({
      type: 'FeatureCollection',
      features: [
        line(
          [
            [-113.123456789, 51.987654321],
            [-113, 52],
          ],
          {
            OWNER: 'CN',
            TRACKS: 2,
            PASSENGER: false,
            nested: { a: 1 },
            list: [1],
            '': 'empty name',
            notes: 'line\u0000break',
          },
        ),
        { type: 'Feature', geometry: null, properties: {} },
        { type: 'Feature', geometry: { type: 'GeometryCollection', geometries: [] } },
      ],
    });
    expect(result).toEqual({
      ok: true,
      skipped: 2,
      collection: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: 1,
            geometry: {
              type: 'LineString',
              coordinates: [
                [-113.123457, 51.987654],
                [-113, 52],
              ],
            },
            properties: { OWNER: 'CN', TRACKS: 2, PASSENGER: false, notes: 'line break' },
          },
        ],
      },
    });
  });

  it('takes a single Feature', () => {
    const result = normalizeFeatureCollection({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-100, 50] },
      properties: null,
    });
    expect(result.ok && result.collection.features).toHaveLength(1);
  });

  it('refuses a file that is not GeoJSON, empty, too big or not in longitude and latitude', () => {
    expect(normalizeFeatureCollection([1, 2]).ok).toBe(false);
    expect(normalizeFeatureCollection({ type: 'FeatureCollection', features: [] }).ok).toBe(false);
    const projected = normalizeFeatureCollection({
      type: 'FeatureCollection',
      features: [
        line([
          [500000, 5600000],
          [500100, 5600100],
        ]),
      ],
    });
    expect(projected.ok).toBe(false);
    expect(!projected.ok && projected.message).toMatch(/longitude and latitude/);
    const big = {
      type: 'FeatureCollection',
      features: Array.from({ length: MAX_LAYER_FEATURES + 1 }, () =>
        line([
          [0, 0],
          [1, 1],
        ]),
      ),
    };
    expect(normalizeFeatureCollection(big).ok).toBe(false);
  });

  it('leaves out shapes with broken coordinates', () => {
    const result = normalizeFeatureCollection({
      type: 'FeatureCollection',
      features: [
        line([
          [0, 0],
          ['x', 1],
        ]),
        line([]),
        line([
          [0, 0],
          [1, 1],
        ]),
      ],
    });
    expect(result).toMatchObject({ ok: true, skipped: 2 });
  });
});

describe('fields of a file', () => {
  const collection: LayerFeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 1,
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { OWNER: 'CN', N: 1 },
      },
      {
        type: 'Feature',
        id: 2,
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { OWNER: 'CN' },
      },
      {
        type: 'Feature',
        id: 3,
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { OWNER: 'CPKC', ok: true },
      },
    ],
  };

  it('lists the fields that can colour it, most often filled first', () => {
    expect(featureFields(collection)).toEqual(['OWNER', 'N']);
  });

  it('counts a field’s values', () => {
    expect(featureValueCounts(collection, 'OWNER')).toEqual([
      { value: 'CN', count: 2 },
      { value: 'CPKC', count: 1 },
    ]);
  });
});

describe('map squares', () => {
  it('gives a square’s bounds in degrees and in metres', () => {
    expect(tileBounds({ z: 0, x: 0, y: 0 })).toMatchObject({ west: -180, east: 180 });
    const b = tileBounds({ z: 1, x: 0, y: 0 });
    expect(b.west).toBe(-180);
    expect(b.east).toBe(0);
    expect(b.south).toBeCloseTo(0);
    expect(b.north).toBeCloseTo(85.0511, 3);
    const [w, s, e, n] = tileBoundsMercator({ z: 1, x: 1, y: 1 });
    expect(w).toBeCloseTo(0);
    expect(n).toBeCloseTo(0);
    expect(e).toBeCloseTo(20037508.34, 1);
    expect(s).toBeCloseTo(-20037508.34, 1);
  });

  it('covers a view with at most 24 squares, coarser when the view is wide', () => {
    const prairies = { west: -120, south: 48, east: -95, north: 56 };
    const tiles = tilesForView(prairies, 7);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(MAX_TILES_PER_VIEW);
    expect(tiles.every(isTile)).toBe(true);
    expect(tiles[0]?.z).toBeLessThanOrEqual(7);
    const city = tilesForView({ west: -114.1, south: 51.0, east: -114.0, north: 51.1 }, 13);
    expect(city.every((t) => t.z === 13)).toBe(true);
  });

  it('checks a square is on the map', () => {
    expect(isTile({ z: 3, x: 7, y: 7 })).toBe(true);
    expect(isTile({ z: 3, x: 8, y: 0 })).toBe(false);
    expect(isTile({ z: 1.5, x: 0, y: 0 })).toBe(false);
    expect(isTile({ z: 23, x: 0, y: 0 })).toBe(false);
  });

  it('simplifies lines by about a pixel', () => {
    expect(simplifyDegrees(0)).toBeCloseTo(360 / 512);
    expect(simplifyDegrees(10)).toBeLessThan(0.001);
  });
});
