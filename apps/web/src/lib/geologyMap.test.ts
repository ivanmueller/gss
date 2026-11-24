import type { Map as MapboxMap } from 'mapbox-gl';
// Mapbox's own style checker: CI has no Mapbox token and draws no map.
import { validate } from 'mapbox-gl/dist/style-spec/index.es.js';
import { describe, expect, it } from 'vitest';

import { FORMATION_LAYERS } from './formationsMap';
import {
  GEOLOGY_LAYERS,
  GEOLOGY_RAMPS,
  geologyPixels,
  rampColour,
  syncGeology,
  type GeologyView,
} from './geologyMap';
import { LAND_LAYERS } from './landMap';
import { ST37_LAYERS } from './st37Map';

// A formation's depth or thickness on the oil and gas map (F-287 part 3). Made-up values only.

/** A stand-in for the map that keeps its layers in order, the lowest first. */
function fakeMap(existing: string[] = []) {
  const order: string[] = [...existing];
  const layers = new Map<string, Record<string, unknown> & { paint: Record<string, unknown> }>(
    existing.map((id) => [id, { id, paint: {} }]),
  );
  const sources = new Map<string, Record<string, unknown>>();
  const updates: unknown[] = [];
  const place = (id: string, before?: string) => {
    const at = order.indexOf(id);
    if (at >= 0) order.splice(at, 1);
    const to = before === undefined ? -1 : order.indexOf(before);
    if (to < 0) order.push(id);
    else order.splice(to, 0, id);
  };
  const map = {
    getStyle: () => ({ layers: order.map((id) => ({ id })) }),
    getLayer: (id: string) => layers.get(id),
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, source: object) =>
      sources.set(id, {
        ...source,
        setData: (data: unknown) => updates.push(data),
        updateImage: (image: unknown) => updates.push(image),
      }),
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
  return { map: map as unknown as MapboxMap, layers, sources, order, updates };
}

const CORNERS: [number, number][] = [
  [-116, 55],
  [-115, 55],
  [-115, 54],
  [-116, 54],
];
const VIEW: GeologyView = {
  measure: 'depth',
  image: 'data:image/png;base64,AAAA',
  corners: CORNERS,
  contours: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { value: 3000 },
        geometry: {
          type: 'LineString',
          coordinates: [
            [-116, 54.5],
            [-115, 54.6],
          ],
        },
      },
    ],
  },
};

describe('the ramp', () => {
  it('runs from the first colour to the last, clamped at the ends', () => {
    const ramp = GEOLOGY_RAMPS.depth;
    expect(rampColour(ramp, [0, 100], 0)).toEqual([255, 255, 204]);
    expect(rampColour(ramp, [0, 100], 100)).toEqual([37, 52, 148]);
    expect(rampColour(ramp, [0, 100], -50)).toEqual([255, 255, 204]);
    expect(rampColour(ramp, [0, 100], 500)).toEqual([37, 52, 148]);
    // Halfway: the middle stop.
    expect(rampColour(ramp, [0, 100], 50)).toEqual([65, 182, 196]);
  });

  it('leaves absent squares clear', () => {
    const pixels = geologyPixels(
      Float32Array.from([0, Number.NaN]),
      [0, 10],
      GEOLOGY_RAMPS.thickness,
    );
    expect([...pixels]).toEqual([255, 255, 212, 255, 0, 0, 0, 0]);
  });
});

describe('syncGeology', () => {
  it('draws the shading and its lines under the land, the outlines and the wells', () => {
    const { map, order, layers } = fakeMap([
      'background',
      LAND_LAYERS.agreementFill,
      FORMATION_LAYERS.fill,
      ST37_LAYERS.wells,
      'pins',
    ]);
    syncGeology(map, VIEW, 'light', 'pins');
    expect(order).toEqual([
      'background',
      GEOLOGY_LAYERS.shade,
      GEOLOGY_LAYERS.lines,
      GEOLOGY_LAYERS.labels,
      LAND_LAYERS.agreementFill,
      FORMATION_LAYERS.fill,
      ST37_LAYERS.wells,
      'pins',
    ]);
    expect(layers.get(GEOLOGY_LAYERS.lines)?.paint['line-color']).toBe('#292524');
    syncGeology(map, VIEW, 'dark', 'pins');
    expect(layers.get(GEOLOGY_LAYERS.lines)?.paint['line-color']).toBe('#f5f5f4');
  });

  it('goes under a map layer and, alone, under the pins', () => {
    const alone = fakeMap(['background', 'pins']);
    syncGeology(alone.map, VIEW, 'light', 'pins');
    expect(alone.order.indexOf(GEOLOGY_LAYERS.labels)).toBeLessThan(alone.order.indexOf('pins'));
    const layered = fakeMap(['background', 'gss-layer-1-fill', 'pins']);
    syncGeology(layered.map, VIEW, 'light', 'pins');
    expect(layered.order.indexOf(GEOLOGY_LAYERS.labels)).toBeLessThan(
      layered.order.indexOf('gss-layer-1-fill'),
    );
  });

  it('changes the picture and the lines in place, and removes everything when off', () => {
    const { map, order, sources, updates } = fakeMap(['background', 'pins']);
    syncGeology(map, { ...VIEW, contours: null }, 'light', 'pins');
    expect(sources.get('geology-image')).toMatchObject({ type: 'image', url: VIEW.image });
    syncGeology(map, { ...VIEW, image: 'data:image/png;base64,BBBB' }, 'light', 'pins');
    expect(updates).toHaveLength(2);
    syncGeology(map, null, 'light', 'pins');
    expect(order).toEqual(['background', 'pins']);
    expect(sources.size).toBe(0);
  });

  it('makes layers Mapbox accepts', () => {
    const { map, layers } = fakeMap(['pins']);
    syncGeology(map, VIEW, 'light', 'pins');
    const style = {
      version: 8,
      glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
      sources: {
        'geology-image': { type: 'image', url: VIEW.image, coordinates: CORNERS },
        'geology-contours': { type: 'geojson', data: VIEW.contours },
      },
      layers: Object.values(GEOLOGY_LAYERS).map((id) => {
        const { paint, ...rest } = layers.get(id) ?? { paint: {} };
        return { ...rest, paint };
      }),
    };
    expect(validate(style)).toEqual([]);
  });
});
