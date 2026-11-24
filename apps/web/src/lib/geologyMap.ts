import type { GeologyMeasure } from '@grain/domain';
import type { GeoJSONSource, ImageSource, Map as MapboxMap } from 'mapbox-gl';

import { FACILITY_LAYERS } from './facilitiesMap';
import { FORMATION_LAYERS } from './formationsMap';
import { GRID_LAYERS } from './gridMap';
import { LAND_LAYERS } from './landMap';
import { SALE_LAYERS } from './landSalesMap';
import { PIPELINE_LAYERS } from './pipelinesMap';
import { RIG_LAYERS } from './rigsMap';
import { ST37_LAYERS } from './st37Map';

// A formation's depth or thickness on the oil and gas map (F-287 part 3): the Survey's grid
// shaded by value, a picture laid on the map, with its contour lines and their values. Under
// everything else drawn from the oil and gas data and the map layers, over the base map.

export const GEOLOGY_LAYERS = {
  shade: 'geology-shade',
  lines: 'geology-lines',
  labels: 'geology-labels',
} as const;
const IMAGE = 'geology-image';
const LINES = 'geology-contours';

/** Each measure's colours, the least first: depth pale to deep blue, thickness pale to brown. */
export const GEOLOGY_RAMPS: Record<GeologyMeasure, readonly string[]> = {
  depth: ['#ffffcc', '#a1dab4', '#41b6c4', '#2c7fb8', '#253494'],
  thickness: ['#ffffd4', '#fed98e', '#fe9929', '#d95f0e', '#993404'],
};

export interface GeologyView {
  measure: GeologyMeasure;
  /** The shading, a picture of the grid (a data URL), and where its corners lie. */
  image: string;
  corners: [number, number][];
  /** The contour lines, each with its `value` in metres; null until fetched. */
  contours: GeoJSON.FeatureCollection | null;
}

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A value's colour on a ramp between `from` and `to`, straight between its stops. */
export function rampColour(
  ramp: readonly string[],
  [from, to]: [number, number],
  value: number,
): [number, number, number] {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  const at = t * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(at));
  const a = rgb(ramp[i] ?? '#000000');
  const b = rgb(ramp[i + 1] ?? '#000000');
  const f = at - i;
  return [0, 1, 2].map((k) => Math.round((a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * f)) as [
    number,
    number,
    number,
  ];
}

/** The grid's squares as picture pixels (RGBA, the north row first), clear where absent. */
export function geologyPixels(
  values: Float32Array,
  range: [number, number],
  ramp: readonly string[],
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(values.length * 4);
  values.forEach((value, i) => {
    if (Number.isNaN(value)) return;
    const [r, g, b] = rampColour(ramp, range, value);
    pixels.set([r, g, b, 255], i * 4);
  });
  return pixels;
}

const OURS: ReadonlySet<string> = new Set(
  [
    LAND_LAYERS,
    SALE_LAYERS,
    FORMATION_LAYERS,
    ST37_LAYERS,
    GRID_LAYERS,
    PIPELINE_LAYERS,
    FACILITY_LAYERS,
    RIG_LAYERS,
  ].flatMap((layers) => Object.values(layers) as string[]),
);

/** The lowest layer drawn over the base map: a map layer's or the oil and gas data's, else the pins. */
function anchorOf(map: MapboxMap, beforeId?: string): string | undefined {
  const own: ReadonlySet<string> = new Set(Object.values(GEOLOGY_LAYERS));
  const first = map
    .getStyle()
    .layers.find(
      (layer) =>
        !own.has(layer.id) &&
        (OURS.has(layer.id) || layer.id.startsWith('gss-layer-') || layer.id === beforeId),
    );
  return first?.id;
}

/** Keeps the shading and its lines under everything else drawn over the base map. */
export function placeGeology(map: MapboxMap, beforeId?: string) {
  if (!map.getLayer(GEOLOGY_LAYERS.shade)) return;
  const anchor = anchorOf(map, beforeId);
  for (const id of Object.values(GEOLOGY_LAYERS)) {
    if (map.getLayer(id)) map.moveLayer(id, anchor);
  }
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const drawn = new WeakMap<MapboxMap, GeologyView>();

export function syncGeology(
  map: MapboxMap,
  view: GeologyView | null,
  tone: 'light' | 'dark',
  beforeId?: string,
) {
  if (view === null) {
    for (const id of Object.values(GEOLOGY_LAYERS)) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of [IMAGE, LINES]) if (map.getSource(id)) map.removeSource(id);
    drawn.delete(map);
    return;
  }
  const before = drawn.get(map);
  const corners = view.corners as [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ];
  const image = map.getSource<ImageSource>(IMAGE);
  if (!image) map.addSource(IMAGE, { type: 'image', url: view.image, coordinates: corners });
  else if (before?.image !== view.image)
    image.updateImage({ url: view.image, coordinates: corners });
  const lines = map.getSource<GeoJSONSource>(LINES);
  if (!lines) map.addSource(LINES, { type: 'geojson', data: view.contours ?? EMPTY });
  else if (before?.contours !== view.contours) lines.setData(view.contours ?? EMPTY);
  drawn.set(map, view);

  if (!map.getLayer(GEOLOGY_LAYERS.shade)) {
    const anchor = anchorOf(map, beforeId);
    map.addLayer(
      {
        id: GEOLOGY_LAYERS.shade,
        type: 'raster',
        source: IMAGE,
        // Each square keeps its own colour, as the Survey's grid has it.
        paint: { 'raster-resampling': 'nearest', 'raster-fade-duration': 0 },
      },
      anchor,
    );
    map.addLayer(
      {
        id: GEOLOGY_LAYERS.lines,
        type: 'line',
        source: LINES,
        layout: { 'line-join': 'round' },
        paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 10, 1.2] },
      },
      anchor,
    );
    map.addLayer(
      {
        id: GEOLOGY_LAYERS.labels,
        type: 'symbol',
        source: LINES,
        minzoom: 6.5,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['concat', ['number-format', ['get', 'value'], {}], ' m'],
          'text-size': 11,
          'symbol-spacing': 400,
        },
        paint: { 'text-halo-width': 1.2 },
      },
      anchor,
    );
  }
  const ink = tone === 'light' ? '#292524' : '#f5f5f4';
  const halo = tone === 'light' ? '#ffffff' : '#1c1917';
  // Fainter as the map closes in, where the wells and the land show the ground.
  map.setPaintProperty(GEOLOGY_LAYERS.shade, 'raster-opacity', [
    'interpolate',
    ['linear'],
    ['zoom'],
    5,
    tone === 'light' ? 0.6 : 0.5,
    11,
    0.3,
  ]);
  map.setPaintProperty(GEOLOGY_LAYERS.lines, 'line-color', ink);
  map.setPaintProperty(GEOLOGY_LAYERS.lines, 'line-opacity', 0.45);
  map.setPaintProperty(GEOLOGY_LAYERS.labels, 'text-color', ink);
  map.setPaintProperty(GEOLOGY_LAYERS.labels, 'text-halo-color', halo);
  placeGeology(map, beforeId);
}
