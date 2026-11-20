import type { Map as MapboxMap } from 'mapbox-gl';
// Mapbox's own style checker, shipped with mapbox-gl: CI has no Mapbox token and draws no map,
// so the wells' layers are checked against the style specification here instead.
import { validate } from 'mapbox-gl/dist/style-spec/index.es.js';
import { describe, expect, it } from 'vitest';

import { highlightSt37, ST37_LAYERS, st37Features, syncSt37 } from './st37Map';

// The AER's ST37 wells on the oil and gas map (F-243 part 4). Made-up wells only.

/** A stand-in for the map that keeps what syncSt37 asks of it. */
function fakeMap() {
  const layers = new Map<string, Record<string, unknown> & { paint: Record<string, unknown> }>();
  const sources = new Map<string, unknown>();
  const images = new Set<string>();
  const map = {
    getLayer: (id: string) => layers.get(id),
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, source: unknown) => sources.set(id, source),
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

describe('syncSt37', () => {
  it('draws layers Mapbox accepts, in both tones', () => {
    for (const tone of ['light', 'dark'] as const) {
      const { map, layers } = fakeMap();
      syncSt37(map, { wells: WELLS, shown: ['producing', 'licensed'] }, tone);
      highlightSt37(map, '00/09-07-030-26W4/0');
      const style = {
        version: 8,
        sources: { 'st37-wells': { type: 'geojson', data: WELLS } },
        layers: [...layers.values()],
      };
      expect(validate(style)).toEqual([]);
      expect([...layers.keys()].sort()).toEqual(Object.values(ST37_LAYERS).sort());
    }
  });

  it('removes everything when the wells are switched off', () => {
    const { map, layers, sources } = fakeMap();
    syncSt37(map, { wells: WELLS, shown: ['producing'] }, 'light');
    syncSt37(map, null, 'light');
    expect(layers.size).toBe(0);
    expect(sources.size).toBe(0);
  });
});
