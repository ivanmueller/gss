import { readFileSync } from 'node:fs';

import { FORMATION_OUTLINES } from '@grain/domain';
import type { Map as MapboxMap } from 'mapbox-gl';
// Mapbox's own style checker: CI has no Mapbox token and draws no map.
import { validate } from 'mapbox-gl/dist/style-spec/index.es.js';
import { describe, expect, it } from 'vitest';

import { formationFeatures, formationUrl } from '../components/Formations';
import {
  FORMATION_COLOURS,
  FORMATION_LAYERS,
  placeFormations,
  syncFormations,
} from './formationsMap';
import { GRID_LAYERS } from './gridMap';
import { ST37_LAYERS } from './st37Map';

// The Formations section's outlines on the oil and gas map (F-280).

/** A stand-in for the map that keeps its layers in order, the lowest first. */
function fakeMap(existing: string[] = []) {
  const order: string[] = [...existing];
  const layers = new Map<string, Record<string, unknown> & { paint: Record<string, unknown> }>(
    existing.map((id) => [id, { id, paint: {} }]),
  );
  const sources = new Map<string, unknown>();
  const place = (id: string, before?: string) => {
    const at = order.indexOf(id);
    if (at >= 0) order.splice(at, 1);
    const to = before === undefined ? -1 : order.indexOf(before);
    if (to < 0) order.push(id);
    else order.splice(to, 0, id);
  };
  const map = {
    getLayer: (id: string) => layers.get(id),
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, source: object) =>
      sources.set(id, Object.defineProperty({ ...source }, 'setData', { value: () => undefined })),
    removeSource: (id: string) => sources.delete(id),
    addLayer: (layer: { id: string; paint?: Record<string, unknown> }, before?: string) => {
      layers.set(layer.id, { ...layer, paint: { ...layer.paint } });
      place(layer.id, before);
    },
    moveLayer: (id: string, before?: string) => {
      place(id, before);
    },
    removeLayer: (id: string) => {
      layers.delete(id);
      order.splice(order.indexOf(id), 1);
    },
    setPaintProperty: (id: string, name: string, value: unknown) => {
      const layer = layers.get(id);
      if (layer) layer.paint[name] = value;
    },
  };
  return { map: map as unknown as MapboxMap, layers, sources, order };
}

/** Another section's layer, drawn after the outlines. */
const line = (id: string) => ({ id, type: 'line' as const, source: 'other' });

const SQUARE: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { Shale_Unit: 'Synthetic' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-116, 54],
            [-115, 54],
            [-115, 55],
            [-116, 54],
          ],
        ],
      },
    },
  ],
};

describe('formationFeatures', () => {
  it('keeps the outlines switched on and fetched, each marked with its formation', () => {
    const fetched = new Map([
      ['duvernay', SQUARE],
      ['montney', SQUARE],
    ]);
    const shown = formationFeatures(new Set(['montney', 'wilrich']), fetched);
    // Wilrich is on but not fetched yet; the Duvernay fetched but off.
    expect(shown.features.map((f) => f.properties)).toEqual([{ key: 'montney' }]);
    expect(shown.features[0]?.geometry).toEqual(SQUARE.features[0]?.geometry);
  });
});

describe('the outline files', () => {
  it('has one file a formation, each the dataset unit or model zone it is named for', () => {
    for (const formation of FORMATION_OUTLINES) {
      // Read from the web app's folder, where the tests run (as theme.test.ts reads index.html).
      const file = `public${formationUrl(formation.key)}`;
      const collection = JSON.parse(readFileSync(file, 'utf8')) as GeoJSON.FeatureCollection;
      expect(collection.features).toHaveLength(1);
      const properties = collection.features[0]?.properties;
      if (formation.source === 'shale-report') {
        expect(properties?.Shale_Unit).toBe(formation.unit);
      } else {
        expect(properties?.Zone).toBe(formation.unit);
      }
      const geometry = collection.features[0]?.geometry;
      expect(geometry?.type).toBe('MultiPolygon');
      // Longitude and latitude in and around Alberta, not the model's web-map metres.
      const points = (geometry as GeoJSON.MultiPolygon).coordinates.flat(2);
      expect(points.length).toBeGreaterThan(3);
      for (const [lon, lat] of points) {
        expect(lon).toBeGreaterThan(-125);
        expect(lon).toBeLessThan(-105);
        expect(lat).toBeGreaterThan(47);
        expect(lat).toBeLessThan(61);
      }
    }
  });

  it('gives every formation a colour in both tones', () => {
    for (const tone of ['light', 'dark'] as const) {
      const colours = FORMATION_OUTLINES.map((f) => FORMATION_COLOURS[tone][f.key]);
      expect(colours.every((c) => c !== undefined && /^#[0-9a-f]{6}$/.test(c))).toBe(true);
      expect(new Set(colours).size).toBe(FORMATION_OUTLINES.length);
    }
  });
});

describe('syncFormations', () => {
  it('draws layers Mapbox accepts, in both tones, and removes them when off', () => {
    for (const tone of ['light', 'dark'] as const) {
      const { map, layers, sources } = fakeMap();
      const outlines = formationFeatures(new Set(['duvernay']), new Map([['duvernay', SQUARE]]));
      syncFormations(map, { outlines }, tone);
      const style = {
        version: 8,
        sources: { formations: { type: 'geojson', data: outlines } },
        layers: [...layers.values()],
      };
      expect(validate(style)).toEqual([]);
      expect([...layers.keys()].sort()).toEqual(Object.values(FORMATION_LAYERS).sort());
      syncFormations(map, null, tone);
      expect(layers.size).toBe(0);
      expect(sources.size).toBe(0);
    }
  });

  it('lies over the land and the sales, under the wells’ zones and the grid (placeFormations)', () => {
    const { map, order } = fakeMap(['land-agreement-fill', 'sale-fill', 'pins']);
    const outlines = formationFeatures(new Set(['duvernay']), new Map([['duvernay', SQUARE]]));
    syncFormations(map, { outlines }, 'light', 'pins');
    expect(order).toEqual([
      'land-agreement-fill',
      'sale-fill',
      FORMATION_LAYERS.fill,
      FORMATION_LAYERS.line,
      'pins',
    ]);
    // The wells' zones and the grid drawn after, just under the pins: moved back under them.
    map.addLayer(line(ST37_LAYERS.zones), 'pins');
    map.addLayer(line(GRID_LAYERS.township), 'pins');
    // Land drawn again goes under the zones; the outlines are moved back over it.
    map.addLayer(line('land-redrawn'), ST37_LAYERS.zones);
    placeFormations(map, 'pins');
    expect(order.indexOf('land-redrawn')).toBeLessThan(order.indexOf(FORMATION_LAYERS.fill));
    expect(order.indexOf(FORMATION_LAYERS.line)).toBeLessThan(order.indexOf(ST37_LAYERS.zones));
    expect(order.indexOf(FORMATION_LAYERS.line)).toBeLessThan(order.indexOf(GRID_LAYERS.township));
  });
});
