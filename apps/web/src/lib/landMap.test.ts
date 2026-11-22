import type { Map as MapboxMap } from 'mapbox-gl';
// Mapbox's own style checker, shipped with mapbox-gl: CI has no Mapbox token and draws no map,
// so the land's layers are checked against the style specification here instead.
import { validate } from 'mapbox-gl/dist/style-spec/index.es.js';
import { describe, expect, it } from 'vitest';

import {
  LAND_HOLDER_COLOURS,
  LAND_HOVER_LAYER,
  LAND_LAYERS,
  LAND_PLAIN,
  landExpiring,
  landFeatures,
  landHolderColour,
  syncLand,
  syncLandHover,
  type LandShape,
} from './landMap';
import { DETAIL_GONE, fadeIn } from './mapDetail';
import { ST37_LAYERS } from './st37Map';

// Land held today on the oil and gas map (F-241). Made-up land only.

/** A stand-in for the map that keeps what syncLand asks of it, and the order of its layers. */
function fakeMap(already: string[] = []) {
  const layers = new Map<string, Record<string, unknown> & { paint: Record<string, unknown> }>();
  const order: string[] = [...already];
  for (const id of already) layers.set(id, { id, paint: {} });
  const sources = new Map<string, unknown>();
  const images = new Set<string>();
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
    hasImage: (id: string) => images.has(id),
    addImage: (id: string) => images.add(id),
    setPaintProperty: (id: string, name: string, value: unknown) => {
      const layer = layers.get(id);
      if (layer) layer.paint[name] = value;
    },
    setFilter: (id: string, filter: unknown) => {
      const layer = layers.get(id);
      if (layer) layer.filter = filter;
    },
  };
  return { map: map as unknown as MapboxMap, layers, sources, order, images };
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
const TODAY = '2026-11-21';
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
  expiryText: 'INDEFINITE' as string | null,
  shape: SHAPE,
};
const offset = {
  id: '3',
  offsetType: null,
  offsetNumber: '2050843E02',
  tract: null,
  holder: null,
  expiryDate: '2027-05-08' as string | null,
  zone: null,
  shape: SHAPE,
};
const freehold = {
  id: '5',
  substances: null,
  nationalPark: null as string | null,
  reserveNumber: null,
  reserveName: null,
  shape: SHAPE,
};
const LAND = landFeatures(
  {
    agreements: [
      agreement,
      { ...agreement, id: '8', rights: 'oil_sands', holder: null, expiryText: '2027/01/28' },
    ],
    offsets: [offset, { ...offset, id: '4', expiryDate: '2026-05-08' }],
    freehold: [freehold, { ...freehold, id: '6', nationalPark: 'EXAMPLE PARK' }],
  },
  { today: TODAY },
);

describe('landHolderColour', () => {
  it('gives a holder the same colour every time, from the holders’ colours', () => {
    const colour = landHolderColour('EXAMPLE ENERGY LTD.');
    expect(LAND_HOLDER_COLOURS).toContain(colour);
    expect(landHolderColour('EXAMPLE ENERGY LTD.')).toBe(colour);
    expect(landHolderColour(null)).toBe(LAND_PLAIN);
  });
});

describe('landExpiring', () => {
  it('is an expiry within the 12 months after today, as the province writes it', () => {
    expect(landExpiring('2026/11/21', TODAY)).toBe(true);
    expect(landExpiring('2027/11/21', TODAY)).toBe(true);
    expect(landExpiring('2027/11/22', TODAY)).toBe(false);
    expect(landExpiring('2026/11/20', TODAY)).toBe(false);
  });

  it('is never a word, or nothing', () => {
    expect(landExpiring('INDEFINITE', TODAY)).toBe(false);
    expect(landExpiring('MULTIPLE', TODAY)).toBe(false);
    expect(landExpiring(null, TODAY)).toBe(false);
  });
});

describe('landFeatures', () => {
  it('gives each shape its key and how it is drawn, the land that is not the Crown’s underneath', () => {
    expect(LAND.features.map((f) => f.properties)).toEqual([
      { key: 'freehold:5', look: 'freehold' },
      { key: 'freehold:6', look: 'reserve' },
      {
        key: 'png:7',
        look: 'agreement',
        colour: landHolderColour('EXAMPLE ENERGY LTD.'),
        expiring: false,
      },
      { key: 'oil_sands:8', look: 'agreement', colour: LAND_PLAIN, expiring: true },
      { key: 'offset:3', look: 'offset' },
      { key: 'offset:4', look: 'offset_passed' },
    ]);
    expect(LAND.features[0]?.geometry).toEqual({ type: 'MultiPolygon', coordinates: SHAPE });
  });

  it('draws every agreement in one colour when not coloured by holder', () => {
    const plain = landFeatures(
      { agreements: [agreement], offsets: [], freehold: [] },
      { byHolder: false, today: TODAY },
    );
    expect(plain.features[0]?.properties?.colour).toBe(LAND_PLAIN);
  });
});

describe('syncLand', () => {
  it('draws layers Mapbox accepts, in both tones', () => {
    for (const tone of ['light', 'dark'] as const) {
      const { map, layers, images } = fakeMap();
      syncLand(map, { land: LAND, picked: ['png:7'] }, tone);
      const style = {
        version: 8,
        sources: { 'land-held': { type: 'geojson', data: LAND } },
        layers: [...layers.values()],
      };
      expect(validate(style)).toEqual([]);
      expect([...layers.keys()].sort()).toEqual(Object.values(LAND_LAYERS).sort());
      // The three hatches: expiring agreements, freehold, parks and reserves.
      expect(images.size).toBe(3);
    }
  });

  it('colours agreements by their own colour and hatches the expiring ones', () => {
    const { map, layers } = fakeMap();
    syncLand(map, { land: LAND, picked: [] }, 'light');
    expect(layers.get(LAND_LAYERS.agreementFill)?.paint['fill-color']).toEqual(['get', 'colour']);
    expect(layers.get(LAND_LAYERS.expiring)?.filter).toEqual([
      'all',
      ['match', ['get', 'look'], ['agreement'], true, false],
      ['==', ['get', 'expiring'], true],
    ]);
  });

  it('fades every layer out with the wells’ legs, gone at DETAIL_GONE (F-260)', () => {
    const { map, layers } = fakeMap();
    syncLand(map, { land: LAND, picked: [] }, 'light');
    for (const id of Object.values(LAND_LAYERS)) {
      const layer = layers.get(id);
      expect(layer?.minzoom).toBe(DETAIL_GONE);
      const opacity = layer?.paint[layer.type === 'fill' ? 'fill-opacity' : 'line-opacity'];
      expect((opacity as unknown[]).slice(0, 6)).toEqual(fadeIn(1).slice(0, 6));
    }
    expect(layers.get(LAND_LAYERS.agreementFill)?.paint['fill-opacity']).toEqual(fadeIn(0.7));
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

describe('syncLandHover (F-265)', () => {
  /** A stand-in for the map that counts what the hover outline's own source is given. */
  function hoverMap() {
    const given: GeoJSON.FeatureCollection[] = [];
    const layers = new Map<string, { id: string; paint: Record<string, unknown> }>();
    let source: { setData: (data: GeoJSON.FeatureCollection) => void } | undefined;
    const map = {
      getSource: () => source,
      addSource: (_id: string, added: { data: GeoJSON.FeatureCollection }) => {
        given.push(added.data);
        source = { setData: (data) => given.push(data) };
      },
      getLayer: (id: string) => layers.get(id),
      addLayer: (layer: { id: string; paint?: Record<string, unknown> }) => {
        layers.set(layer.id, { id: layer.id, paint: { ...layer.paint } });
      },
      setPaintProperty: (id: string, name: string, value: unknown) => {
        const layer = layers.get(id);
        if (layer) layer.paint[name] = value;
      },
    };
    return { map: map as unknown as MapboxMap, given, layers };
  }

  it('outlines the land under the pointer from a source of its own, on top of everything', () => {
    const { map, given, layers } = hoverMap();
    // Nothing is added until there is land to outline.
    syncLandHover(map, null, 'light');
    expect(given).toHaveLength(0);
    syncLandHover(map, SHAPE, 'light');
    expect(given).toHaveLength(1);
    expect(given[0]?.features[0]?.geometry).toEqual({ type: 'MultiPolygon', coordinates: SHAPE });
    expect(layers.get(LAND_HOVER_LAYER)?.paint['line-color']).toBe('#1c1917');
    // The same land again (the page drew itself again) is not handed to the map again.
    syncLandHover(map, SHAPE, 'dark');
    expect(given).toHaveLength(1);
    expect(layers.get(LAND_HOVER_LAYER)?.paint['line-color']).toBe('#fafaf9');
    // The pointer left: the outline is emptied, its layer kept for the next land.
    syncLandHover(map, null, 'dark');
    expect(given).toHaveLength(2);
    expect(given[1]?.features).toEqual([]);
  });
});
