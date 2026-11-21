import type { Map as MapboxMap } from 'mapbox-gl';
// Mapbox's own style checker, shipped with mapbox-gl: CI has no Mapbox token and draws no map,
// so the land's layers are checked against the style specification here instead.
import { validate } from 'mapbox-gl/dist/style-spec/index.es.js';
import { describe, expect, it } from 'vitest';

import { LAND_LAYERS, landFeatures, syncLand, type LandShape } from './landMap';
import { ST37_LAYERS } from './st37Map';

// Land held today on the oil and gas map (F-241). Made-up land only.

/** A stand-in for the map that keeps what syncLand asks of it, and the order of its layers. */
function fakeMap(already: string[] = []) {
  const layers = new Map<string, Record<string, unknown> & { paint: Record<string, unknown> }>();
  const order: string[] = [...already];
  for (const id of already) layers.set(id, { id, paint: {} });
  const sources = new Map<string, unknown>();
  const map = {
    getLayer: (id: string) => layers.get(id),
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, source: object) =>
      sources.set(
        id,
        Object.defineProperty({ ...source }, 'setData', {
          value: () => undefined,
          enumerable: false,
        }),
      ),
    removeSource: (id: string) => sources.delete(id),
    addLayer: (layer: { id: string; paint?: Record<string, unknown> }, before?: string) => {
      layers.set(layer.id, { ...layer, paint: { ...layer.paint } });
      const at = before === undefined ? -1 : order.indexOf(before);
      if (at === -1) order.push(layer.id);
      else order.splice(at, 0, layer.id);
    },
    removeLayer: (id: string) => {
      layers.delete(id);
      order.splice(order.indexOf(id), 1);
    },
    setPaintProperty: (id: string, name: string, value: unknown) => {
      const layer = layers.get(id);
      if (layer) layer.paint[name] = value;
    },
    setFilter: (id: string, filter: unknown) => {
      const layer = layers.get(id);
      if (layer) layer.filter = filter;
    },
  };
  return { map: map as unknown as MapboxMap, layers, sources, order };
}

const SHAPE: LandShape = [
  [
    [
      [-116.1, 54],
      [-116, 54],
      [-116, 54.1],
      [-116.1, 54],
    ],
  ],
];
const agreement = {
  id: '7',
  rights: 'png' as const,
  agreementType: '002',
  agreementNumber: '924',
  tract: '00',
  group: 'LEASE',
  status: 'ACTIVE',
  vintage: null,
  holder: 'EXAMPLE ENERGY LTD.',
  parties: null,
  zone: null,
  areaHa: 256,
  termDate: null,
  continuationDate: null,
  expiryText: null,
  shape: SHAPE,
};
const LAND = landFeatures({
  agreements: [agreement, { ...agreement, id: '8', rights: 'oil_sands' }],
  offsets: [
    {
      id: '3',
      offsetType: null,
      offsetNumber: '2050843E02',
      tract: null,
      holder: null,
      expiryDate: null,
      zone: null,
      shape: SHAPE,
    },
  ],
  freehold: [
    {
      id: '5',
      substances: null,
      nationalPark: null,
      reserveNumber: null,
      reserveName: null,
      shape: SHAPE,
    },
  ],
});

describe('landFeatures', () => {
  it('gives each shape its class and its key, the freehold underneath', () => {
    expect(LAND.features.map((f) => f.properties)).toEqual([
      { class: 'freehold', key: 'freehold:5' },
      { class: 'png', key: 'png:7' },
      { class: 'oil_sands', key: 'oil_sands:8' },
      { class: 'offset', key: 'offset:3' },
    ]);
    expect(LAND.features[0]?.geometry).toEqual({ type: 'MultiPolygon', coordinates: SHAPE });
  });
});

describe('syncLand', () => {
  it('draws layers Mapbox accepts, in both tones', () => {
    for (const tone of ['light', 'dark'] as const) {
      const { map, layers } = fakeMap();
      syncLand(map, { land: LAND, picked: ['png:7'] }, tone);
      const style = {
        version: 8,
        sources: { 'land-held': { type: 'geojson', data: LAND } },
        layers: [...layers.values()],
      };
      expect(validate(style)).toEqual([]);
      expect([...layers.keys()].sort()).toEqual(Object.values(LAND_LAYERS).sort());
    }
  });

  it('outlines the land whose card is open, and lets it go', () => {
    const { map, layers } = fakeMap();
    syncLand(map, { land: LAND, picked: ['png:7', 'offset:3'] }, 'light');
    expect(layers.get(LAND_LAYERS.picked)?.filter).toEqual([
      'in',
      ['get', 'key'],
      ['literal', ['png:7', 'offset:3']],
    ]);
    syncLand(map, { land: LAND, picked: [] }, 'light');
    expect(layers.get(LAND_LAYERS.picked)?.filter).toEqual(['in', ['get', 'key'], ['literal', []]]);
  });

  it('goes under the wells when they are drawn, else under the pins', () => {
    const wells = fakeMap([ST37_LAYERS.density, ST37_LAYERS.paths, 'pins']);
    syncLand(wells.map, { land: LAND, picked: [] }, 'light', 'pins');
    expect(wells.order.slice(-3)).toEqual([ST37_LAYERS.density, ST37_LAYERS.paths, 'pins']);
    expect(wells.order).toHaveLength(3 + Object.keys(LAND_LAYERS).length);

    const alone = fakeMap(['pins']);
    syncLand(alone.map, { land: LAND, picked: [] }, 'light', 'pins');
    expect(alone.order.at(-1)).toBe('pins');
  });

  it('removes everything when the land is switched off', () => {
    const { map, layers, sources } = fakeMap();
    syncLand(map, { land: LAND, picked: [] }, 'light');
    syncLand(map, null, 'light');
    expect(layers.size).toBe(0);
    expect(sources.size).toBe(0);
  });
});
