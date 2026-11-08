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
  railroadPreset,
  groupingOf,
  valuesOf,
  cleanValue,
  MAX_VALUES_TEXT,
  whereOf,
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

describe('shared values and limits (F-137)', () => {
  it('builds the service’s where clause from the limit, never from a quote', () => {
    expect(whereOf({ onlyField: null, onlyValues: [] })).toBe('1=1');
    expect(whereOf({ onlyField: 'NET', onlyValues: ['M', 'I'] })).toBe("NET IN ('M','I')");
    expect(whereOf({ onlyField: 'NET', onlyValues: ["M' OR '1'='1"] })).toBe('1=0');
  });

  it('lists a feature’s values once each, in field order', () => {
    expect(
      valuesOf({ RROWNER1: 'UP', RROWNER2: null, TRKRGHTS1: 'CPKC', TRKRGHTS2: 'UP', N: 5 }, [
        'RROWNER1',
        'RROWNER2',
        'TRKRGHTS1',
        'TRKRGHTS2',
      ]),
    ).toBe('|UP|CPKC|');
    expect(valuesOf({ RROWNER1: ' ' }, ['RROWNER1'])).toBe('');
  });

  it('offers the publisher’s railroad settings when the layer has their fields', () => {
    const fields = ['RROWNER1', 'RROWNER2', 'RROWNER3', 'TRKRGHTS1', 'TRKRGHTS2', 'NET'];
    expect(railroadPreset(fields)).toEqual({
      colourField: 'RROWNER1',
      alsoFields: ['RROWNER2', 'RROWNER3', 'TRKRGHTS1', 'TRKRGHTS2'],
      onlyField: 'NET',
      onlyValues: ['M', 'I'],
    });
    expect(railroadPreset(['OWNER', 'NET'])).toBeNull();
  });

  it('changes its grouping text with any setting that changes the lines', () => {
    const base = {
      colourField: 'RROWNER1',
      alsoFields: ['RROWNER2'],
      onlyField: 'NET',
      onlyValues: ['M'],
    };
    expect(groupingOf(base)).toBe(groupingOf({ ...base }));
    expect(groupingOf(base)).not.toBe(groupingOf({ ...base, alsoFields: [] }));
    expect(groupingOf(base)).not.toBe(groupingOf({ ...base, onlyValues: ['M', 'I'] }));
  });

  it('refuses a limit value that could change the service’s query', () => {
    const layer = {
      name: 'Rail',
      sourceName: 'P',
      termsUrl: 'https://example.com/t',
      termsNote: 'T',
      colour: '#9ca3af',
      colourField: 'RROWNER1',
      colours: [],
      source: 'web',
      url: 'https://x.example.com/FeatureServer/0',
      wmsLayers: null,
    };
    expect(
      createMapLayerSchema.safeParse({ ...layer, onlyField: 'NET', onlyValues: ["M'"] }).success,
    ).toBe(false);
    expect(
      createMapLayerSchema.safeParse({ ...layer, onlyField: 'NET', onlyValues: ['M', 'I'] })
        .success,
    ).toBe(true);
  });
});

describe('a feature’s values through the checks (Codex’s review of bb488a9)', () => {
  it('keeps every value of several fields, however long each is within its limit', () => {
    const a = 'A'.repeat(300);
    const b = 'B'.repeat(300);
    const values = valuesOf({ OWNER: a, OWNER2: b }, ['OWNER', 'OWNER2']);
    const checked = normalizeFeatureCollection({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-100, 50] },
          properties: { OWNER: a, __values: values },
        },
      ],
    });
    expect(checked.ok && checked.collection.features[0]?.properties.__values).toBe(`|${a}|${b}|`);
  });

  it('cuts each value as values are counted, so the longest stays within the limit', () => {
    const long = 'L'.repeat(900);
    const fields = Array.from({ length: 17 }, (_, i) => `F${String(i)}`);
    const props = Object.fromEntries(fields.map((f, i) => [f, `${String(i)}${long}`]));
    const values = valuesOf(props, fields);
    expect(values.split('|').filter(Boolean)).toHaveLength(17);
    expect(values.length).toBeLessThanOrEqual(MAX_VALUES_TEXT);
    const checked = normalizeFeatureCollection({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-100, 50] },
          properties: { __values: values },
        },
      ],
    });
    expect(checked.ok && checked.collection.features[0]?.properties.__values).toBe(values);
  });
});

describe('values tidied the same everywhere (Codex’s review of da6c543)', () => {
  it('keeps a value with a control character as a checked view keeps it', () => {
    const values = valuesOf({ OWNER: 'A\tB', OWNER2: 'C' }, ['OWNER', 'OWNER2']);
    expect(values).toBe('|A B|C|');
    const checked = normalizeFeatureCollection({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-100, 50] },
          properties: { OWNER: 'A\tB', __values: values },
        },
      ],
    });
    expect(checked.ok && checked.collection.features[0]?.properties).toEqual({
      OWNER: 'A B',
      __values: values,
    });
    expect(cleanValue('A\tB')).toBe('A B');
    expect(cleanValue(7)).toBe('7');
    expect(cleanValue(null)).toBe('');
  });
});

describe('tidying twice changes nothing (Codex’s review of 2693859)', () => {
  it('gives the same value for a cut that ends in a space', () => {
    const raw = `${'A'.repeat(499)} B`;
    const once = cleanValue(raw);
    expect(once).toBe('A'.repeat(499));
    expect(cleanValue(once)).toBe(once);
    expect(valuesOf({ OWNER: once }, ['OWNER'])).toBe(valuesOf({ OWNER: raw }, ['OWNER']));
  });
});
