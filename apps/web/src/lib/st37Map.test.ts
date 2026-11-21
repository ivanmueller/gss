import type { Map as MapboxMap } from 'mapbox-gl';
// Mapbox's own style checker, shipped with mapbox-gl: CI has no Mapbox token and draws no map,
// so the wells' layers are checked against the style specification here instead.
import { validate } from 'mapbox-gl/dist/style-spec/index.es.js';
import { describe, expect, it } from 'vitest';

import {
  highlightSt37,
  ST37_LAYERS,
  ST37_MAIN_LEG,
  ST37_OUTLINES,
  st37Features,
  st37ZoneFeatures,
  syncSt37,
} from './st37Map';

// The AER's ST37 wells on the oil and gas map (F-243 part 4). Made-up wells only.

/** A stand-in for the map that keeps what syncSt37 asks of it. */
function fakeMap() {
  const layers = new Map<string, Record<string, unknown> & { paint: Record<string, unknown> }>();
  const sources = new Map<string, unknown>();
  const images = new Set<string>();
  const map = {
    getLayer: (id: string) => layers.get(id),
    getSource: (id: string) => sources.get(id),
    // A source can be given new data later, as a Mapbox source can (kept out of comparisons).
    addSource: (id: string, source: object) =>
      sources.set(
        id,
        Object.defineProperty({ ...source }, 'setData', {
          value: () => undefined,
          enumerable: false,
        }),
      ),
    removeSource: (id: string) => sources.delete(id),
    addLayer: (layer: { id: string; paint?: Record<string, unknown> }) => {
      layers.set(layer.id, { ...layer, paint: { ...layer.paint } });
    },
    removeLayer: (id: string) => layers.delete(id),
    hasImage: (id: string) => images.has(id),
    addImage: (id: string) => images.add(id),
    updateImage: () => undefined,
    setPaintProperty: (id: string, name: string, value: unknown) => {
      const layer = layers.get(id);
      if (layer) layer.paint[name] = value;
    },
    setLayoutProperty: (id: string, name: string, value: unknown) => {
      const layer = layers.get(id);
      if (layer) layer.layout = { ...(layer.layout as object | undefined), [name]: value };
    },
    setFilter: (id: string, filter: unknown) => {
      const layer = layers.get(id);
      if (layer) layer.filter = filter;
    },
  };
  return { map: map as unknown as MapboxMap, layers, sources, images };
}

const WELLS = st37Features([
  {
    uwi: '00/09-07-030-26W4/0',
    licenceNumber: '0509395',
    wellName: null,
    licensee: null,
    statusClass: 'producing',
    statusFluid: null,
    statusType: null,
    spudDate: null,
    totalDepthM: null,
    trueVerticalDepthM: null,
    surface: [-113.6, 53.3],
    bottom: [-113.62, 53.3],
    path: [
      [-113.6, 53.3],
      [-113.62, 53.3],
    ],
    licenceDate: null,
    plannedOperation: null,
    plannedFormation: null,
    plannedDepthM: null,
    plannedBottom: null,
  },
]);

const OUTLINE = '/outlines/duvernay.geojson';
/** One made-up zone. */
const ZONES = st37ZoneFeatures([
  {
    wells: 30,
    ring: [
      [-113.7, 53.2],
      [-113.5, 53.2],
      [-113.5, 53.4],
      [-113.7, 53.2],
    ],
  },
]);

describe('syncSt37', () => {
  it('draws layers Mapbox accepts, in both tones', () => {
    for (const tone of ['light', 'dark'] as const) {
      const { map, layers } = fakeMap();
      syncSt37(
        map,
        {
          wells: WELLS,
          shown: ['producing', 'licensed'],
          outline: '/outlines/duvernay.geojson',
          zones: ZONES,
        },
        tone,
      );
      highlightSt37(map, '0509395');
      const style = {
        version: 8,
        sources: {
          'st37-wells': { type: 'geojson', data: WELLS },
          'st37-outline': { type: 'geojson', data: '/outlines/duvernay.geojson' },
          'st37-zones': { type: 'geojson', data: ZONES },
        },
        layers: [...layers.values()],
      };
      expect(validate(style)).toEqual([]);
      expect([...layers.keys()].sort()).toEqual(Object.values(ST37_LAYERS).sort());
    }
  });

  it('highlights the whole well under the pointer: every leg under its licence (F-257)', () => {
    const { map, layers } = fakeMap();
    syncSt37(map, { wells: WELLS, shown: ['producing'], outline: null, zones: null }, 'light');
    highlightSt37(map, '0509395');
    expect(layers.get(ST37_LAYERS.hoverPath)?.filter).toEqual([
      'all',
      ['==', ['get', 'licence'], '0509395'],
      ['in', ['get', 'part'], ['literal', ['path', 'planned']]],
    ]);
    // Every leg bold; the main leg in a colour of its own, the others in the map's ink.
    expect(layers.get(ST37_LAYERS.hoverPath)?.paint).toMatchObject({
      'line-width': 3,
      'line-color': ['case', ['==', ['get', 'leg'], 'main'], ST37_MAIN_LEG.light, '#1c1917'],
    });
    highlightSt37(map, null);
    expect(layers.get(ST37_LAYERS.hoverDots)?.filter).toContainEqual([
      '==',
      ['get', 'licence'],
      '',
    ]);
  });

  it('draws the parts switched on: a dot a well when the main legs are off (F-257)', () => {
    const { map, layers } = fakeMap();
    const view = { wells: WELLS, shown: ['producing' as const], outline: null, zones: null };
    const legsOf = (id: string) =>
      (layers.get(id)?.filter as unknown[]).find((f) =>
        JSON.stringify(f).startsWith('["in",["get","leg"]'),
      );
    const statusesOf = (id: string) =>
      (layers.get(id)?.filter as unknown[]).find((f) =>
        JSON.stringify(f).startsWith('["in",["get","status"]'),
      );

    // Everything on: every leg, and no dot a well.
    syncSt37(map, view, 'light');
    expect(legsOf(ST37_LAYERS.paths)).toEqual([
      'in',
      ['get', 'leg'],
      ['literal', ['main', 'other']],
    ]);
    expect(statusesOf(ST37_LAYERS.wells)).toEqual(['in', ['get', 'status'], ['literal', []]]);
    expect(layers.get(ST37_LAYERS.dots)?.filter).toContainEqual([
      'in',
      ['get', 'at'],
      ['literal', ['hole', 'plan']],
    ]);

    // Main legs and planned lines off: other legs only, a dot a well, and a leg not drilled
    // yet has its dot where it starts.
    syncSt37(map, { ...view, parts: { legs: false, otherLegs: true, planned: false } }, 'light');
    for (const id of [ST37_LAYERS.paths, ST37_LAYERS.dots, ST37_LAYERS.pending]) {
      expect(legsOf(id)).toEqual(['in', ['get', 'leg'], ['literal', ['other']]]);
    }
    expect(statusesOf(ST37_LAYERS.wells)).toEqual([
      'in',
      ['get', 'status'],
      ['literal', ['producing']],
    ]);
    expect(statusesOf(ST37_LAYERS.planned)).toEqual(['in', ['get', 'status'], ['literal', []]]);
    expect(layers.get(ST37_LAYERS.dots)?.filter).toContainEqual([
      'in',
      ['get', 'at'],
      ['literal', ['hole', 'start']],
    ]);
    expect(
      validate({
        version: 8,
        sources: { 'st37-wells': { type: 'geojson', data: WELLS } },
        layers: [...layers.values()],
      }),
    ).toEqual([]);
  });

  it('removes everything when the wells are switched off', () => {
    const { map, layers, sources } = fakeMap();
    syncSt37(map, { wells: WELLS, shown: ['producing'], outline: OUTLINE, zones: ZONES }, 'light');
    syncSt37(map, null, 'light');
    expect(layers.size).toBe(0);
    expect(sources.size).toBe(0);
  });

  it("draws a formation's outline under the wells, and takes it away without one", () => {
    const { map, layers, sources } = fakeMap();
    syncSt37(map, { wells: WELLS, shown: ['producing'], outline: OUTLINE, zones: null }, 'light');
    expect(sources.get('st37-outline')).toEqual({ type: 'geojson', data: OUTLINE });
    expect(layers.has(ST37_LAYERS.outlineLine)).toBe(true);
    syncSt37(map, { wells: WELLS, shown: ['producing'], outline: null, zones: null }, 'light');
    expect(sources.has('st37-outline')).toBe(false);
    expect(layers.has(ST37_LAYERS.outlineFill)).toBe(false);
    expect(layers.has(ST37_LAYERS.density)).toBe(true);
  });

  it('shades the zones under the wells, and takes them away without any', () => {
    const { map, layers, sources } = fakeMap();
    const view = { wells: WELLS, shown: ['producing' as const], outline: null };
    syncSt37(map, { ...view, zones: ZONES }, 'light');
    expect(sources.get('st37-zones')).toEqual({ type: 'geojson', data: ZONES });
    expect(ZONES.features[0]?.properties).toEqual({ wells: 30 });
    expect(layers.has(ST37_LAYERS.zones)).toBe(true);
    syncSt37(map, { ...view, zones: null }, 'light');
    expect(sources.has('st37-zones')).toBe(false);
    expect(layers.has(ST37_LAYERS.zones)).toBe(false);
  });

  it("names the Survey and its licence for the Duvernay's outline", () => {
    expect(ST37_OUTLINES.duvernay?.credit).toMatch(
      /Alberta Geological Survey.*Open Government Licence – Alberta/,
    );
  });
});
