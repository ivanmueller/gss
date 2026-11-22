import type { Map as MapboxMap } from 'mapbox-gl';
// Mapbox's own style checker: CI has no Mapbox token and draws no map, so the layers are
// checked against the style specification here instead.
import { validate } from 'mapbox-gl/dist/style-spec/index.es.js';
import { describe, expect, it } from 'vitest';

import { LAND_LAYERS, landFeatures, syncLand } from './landMap';
import {
  landSaleCentre,
  landSaleColour,
  landSaleFeatures,
  landSaleState,
  SALE_AREAS_FULL,
  SALE_AREAS_GONE,
  SALE_BLUES,
  SALE_DOTS_FULL,
  SALE_LAYERS,
  SALE_NO_OFFERS,
  SALE_PICKABLE,
  SALE_UPCOMING,
  syncLandSales,
  type LandSaleParcel,
} from './landSalesMap';
import { ST37_LAYERS } from './st37Map';

// Crown land sales on the oil and gas map (F-242). Made-up parcels and prices only.

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
  return { map: map as unknown as MapboxMap, layers, sources, order };
}

const TODAY = '2026-11-01';
const parcel = (id: string, extra: Partial<LandSaleParcel> = {}): LandSaleParcel => ({
  id,
  saleDate: '2026-11-04',
  contractNo: 'A0001',
  contractType: 'LEASE',
  region: 'PLAINS',
  hectares: '256.0000',
  zone: null,
  land: '51806024',
  inexact: false,
  status: 'ACCEPTED',
  bonus: '56888.32',
  dollarsPerHectare: '222.22',
  buyers: 'EXAMPLE LAND LTD. 100%',
  shape: [
    [
      [
        [-116.1, 54],
        [-116, 54],
        [-116, 54.1],
        [-116.1, 54],
      ],
    ],
  ],
  ...extra,
});

describe('landSaleState and landSaleColour', () => {
  it('tells sold from not sold from not sold yet', () => {
    expect(landSaleState(parcel('1'), TODAY)).toBe('sold');
    expect(landSaleState(parcel('1', { status: 'NO OFFERS' }), TODAY)).toBe('no_offers');
    expect(landSaleState(parcel('1', { status: 'REJECTED' }), TODAY)).toBe('no_offers');
    expect(landSaleState(parcel('1', { status: null }), TODAY)).toBe('upcoming');
  });

  it('gives a sold parcel its blue by dollars per hectare, darker for more', () => {
    const blue = (price: string) =>
      landSaleColour(parcel('1', { dollarsPerHectare: price }), TODAY);
    expect(blue('18.00')).toBe(SALE_BLUES[0]);
    expect(blue('25.00')).toBe(SALE_BLUES[1]);
    expect(blue('222.22')).toBe(SALE_BLUES[4]);
    expect(blue('799.99')).toBe(SALE_BLUES[5]);
    expect(blue('8518.00')).toBe(SALE_BLUES[6]);
  });

  it('gives the others their own colours', () => {
    expect(
      landSaleColour(parcel('1', { status: 'NO OFFERS', dollarsPerHectare: null }), TODAY),
    ).toBe(SALE_NO_OFFERS);
    expect(landSaleColour(parcel('1', { dollarsPerHectare: null }), TODAY)).toBe(SALE_NO_OFFERS);
    expect(landSaleColour(parcel('1', { status: null }), TODAY)).toBe(SALE_UPCOMING);
    // A past sale's parcel that the results do not list is not upcoming.
    expect(landSaleState(parcel('1', { status: null, saleDate: '2019-08-28' }), TODAY)).toBe(
      'no_offers',
    );
  });
});

const PARCELS = landSaleFeatures(
  [parcel('2', { saleDate: '2026-12-02', status: null }), parcel('1')],
  TODAY,
);

describe('landSaleFeatures', () => {
  it('draws the newest sale last, each parcel with its key, state and colour', () => {
    expect(
      PARCELS.features.filter((f) => f.properties?.part === 'area').map((f) => f.properties),
    ).toEqual([
      { key: 'sale:1', state: 'sold', colour: SALE_BLUES[4], part: 'area' },
      { key: 'sale:2', state: 'upcoming', colour: SALE_UPCOMING, part: 'area' },
    ]);
  });

  it('gives each parcel the dot it becomes zoomed out, in its colour (F-262)', () => {
    const dots = PARCELS.features.filter((f) => f.properties?.part === 'dot');
    expect(dots.map((f) => f.properties)).toEqual([
      { key: 'sale:1', state: 'sold', colour: SALE_BLUES[4], part: 'dot' },
      { key: 'sale:2', state: 'upcoming', colour: SALE_UPCOMING, part: 'dot' },
    ]);
    expect(dots.every((f) => f.geometry.type === 'Point')).toBe(true);
  });
});

describe('landSaleCentre', () => {
  it('is the middle of the parcel’s largest piece', () => {
    const square = (west: number, south: number, size: number) => [
      [
        [west, south],
        [west + size, south],
        [west + size, south + size],
        [west, south + size],
        [west, south],
      ],
    ];
    // A small piece far west, a large one east: the dot sits in the large one, not between.
    const centre = landSaleCentre([square(-118, 54, 0.1), square(-116, 54, 0.4)]);
    expect(centre?.[0]).toBeCloseTo(-115.8);
    expect(centre?.[1]).toBeCloseTo(54.2);
  });

  it('is nothing for a shape with no ground', () => {
    expect(landSaleCentre([])).toBeNull();
    expect(landSaleCentre([[[]]])).toBeNull();
  });
});

describe('syncLandSales', () => {
  it('draws layers Mapbox accepts, and removes them when switched off', () => {
    const { map, layers, sources } = fakeMap();
    syncLandSales(map, { parcels: PARCELS, picked: ['sale:1'] }, 'light');
    const style = {
      version: 8,
      sources: { 'land-sales': { type: 'geojson', data: PARCELS } },
      layers: [...layers.values()],
    };
    expect(validate(style)).toEqual([]);
    expect([...layers.keys()].sort()).toEqual(Object.values(SALE_LAYERS).sort());
    expect(layers.get(SALE_LAYERS.picked)?.filter).toEqual([
      'all',
      ['==', ['get', 'part'], 'area'],
      ['in', ['get', 'key'], ['literal', ['sale:1']]],
    ]);
    // Zoomed out the parcels give way to their dots (F-262): the areas and their edges gone
    // at SALE_AREAS_GONE, the dots whole from SALE_DOTS_FULL out, at every zoom farther.
    for (const id of [SALE_LAYERS.fill, SALE_LAYERS.line, SALE_LAYERS.upcoming]) {
      const layer = layers.get(id);
      expect(layer?.minzoom).toBe(SALE_AREAS_GONE);
      const opacity = layer?.paint[id === SALE_LAYERS.fill ? 'fill-opacity' : 'line-opacity'];
      // One steady fade from whole to nothing, with no step in it (F-264).
      expect(opacity as unknown[]).toHaveLength(7);
      expect((opacity as unknown[]).slice(0, 5)).toEqual([
        'interpolate',
        ['linear'],
        ['zoom'],
        SALE_AREAS_GONE,
        0,
      ]);
      expect((opacity as unknown[])[5]).toBe(SALE_AREAS_FULL);
    }
    // The dots come in over four scrolls of the wheel (about 0.15 of a zoom each), not one,
    // and are whole while the parcels can still be seen: a square flows into a circle.
    expect(SALE_AREAS_FULL - SALE_DOTS_FULL).toBeGreaterThanOrEqual(0.55);
    expect(SALE_DOTS_FULL).toBeGreaterThan(SALE_AREAS_GONE);
    const dots = layers.get(SALE_LAYERS.dots);
    expect(dots?.minzoom).toBeUndefined();
    expect(dots?.maxzoom).toBe(SALE_AREAS_FULL);
    expect(dots?.filter).toEqual(['==', ['get', 'part'], 'dot']);
    expect(dots?.paint['circle-opacity']).toEqual([
      'interpolate',
      ['linear'],
      ['zoom'],
      SALE_DOTS_FULL,
      1,
      SALE_AREAS_FULL,
      0,
    ]);
    // A click finds a parcel by its dot as by its area.
    expect(SALE_PICKABLE).toEqual([SALE_LAYERS.dots, SALE_LAYERS.fill]);
    syncLandSales(map, null, 'light');
    expect(layers.size).toBe(0);
    expect(sources.size).toBe(0);
  });

  it('lies over the land held and under the wells, whichever is drawn first', () => {
    const land = landFeatures(
      { agreements: [], offsets: [], freehold: [] },
      { today: '2026-11-21' },
    );
    for (const salesFirst of [true, false]) {
      const { map, order } = fakeMap([ST37_LAYERS.density, 'pins']);
      const drawSales = () => {
        syncLandSales(map, { parcels: PARCELS, picked: [] }, 'light', 'pins');
      };
      const drawLand = () => {
        syncLand(map, { land, picked: [] }, 'light', 'pins');
      };
      if (salesFirst) drawSales();
      drawLand();
      if (!salesFirst) drawSales();
      const at = (id: string) => order.indexOf(id);
      expect(at(LAND_LAYERS.picked)).toBeLessThan(at(ST37_LAYERS.density));
      expect(at(SALE_LAYERS.picked)).toBeLessThan(at(ST37_LAYERS.density));
      if (salesFirst) expect(at(LAND_LAYERS.picked)).toBeLessThan(at(SALE_LAYERS.fill));
    }
  });
});
