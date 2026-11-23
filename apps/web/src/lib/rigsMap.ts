import type { GeoJSONSource, Map as MapboxMap } from 'mapbox-gl';

// Rigs on the oil and gas map (F-282): each rig at its latest well as a triangle, and over the
// last 30 or 90 days each earlier move as a dot that fades with age. Over everything else drawn
// from the oil and gas data, the wells included: rigs are few, and the pointer finds them first.

/** The rigs' colour: amber with a dark edge, seen on the light, dark and satellite maps. */
export const RIG_COLOUR = '#f59f00';

export interface RigsView {
  /**
   * One point a move, with its `key` ("rig:N"), `now` (the rig's latest well, in the last 30
   * days) and `age` (0 today to 1 at the period's start).
   */
  points: GeoJSON.FeatureCollection;
  /** The key of the move whose panel is open, drawn larger. */
  picked: readonly string[];
}

const SOURCE = 'rigs';
const TRIANGLE = 'rig-triangle';
export const RIG_LAYERS = {
  moves: 'rig-moves',
  now: 'rig-now',
  picked: 'rig-picked',
} as const;
/** The layers a pointer can find a rig on, the rigs now first. */
export const RIG_PICKABLE = [RIG_LAYERS.now, RIG_LAYERS.moves];

const drawn = new WeakMap<MapboxMap, GeoJSON.FeatureCollection>();

/**
 * A triangle pointing up as a signed distance field (as facilitiesMap's square), so the map can
 * colour it: each pixel's alpha its distance from the edge, 191 on it.
 */
export function triangleImage(
  size = 28,
  radius = 8,
): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(size * size * 4);
  const centre = (size - 1) / 2;
  const k = Math.sqrt(3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // The exact distance to an equilateral triangle (Quilez), its point upwards.
      let px = Math.abs(x - centre) - radius;
      let py = -(y - centre - radius / 3) + radius / k;
      if (px + k * py > 0) {
        const nx = (px - k * py) / 2;
        const ny = (-k * px - py) / 2;
        px = nx;
        py = ny;
      }
      px -= Math.min(Math.max(px, -2 * radius), 0);
      const d = -Math.hypot(px, py) * Math.sign(py);
      const alpha = Math.round(255 - 255 * (d / 8 + 0.25));
      data[(y * size + x) * 4 + 3] = Math.max(0, Math.min(255, alpha));
    }
  }
  return { width: size, height: size, data };
}

/** Keeps the rigs on top of the oil and gas data after anything else is drawn again. */
export function placeRigs(map: MapboxMap, beforeId?: string) {
  if (!map.getLayer(RIG_LAYERS.now)) return;
  const anchor = beforeId && map.getLayer(beforeId) ? beforeId : undefined;
  for (const id of [RIG_LAYERS.moves, RIG_LAYERS.now, RIG_LAYERS.picked]) {
    if (map.getLayer(id)) map.moveLayer(id, anchor);
  }
}

export function syncRigs(
  map: MapboxMap,
  view: RigsView | null,
  tone: 'light' | 'dark',
  beforeId?: string,
) {
  if (view === null) {
    for (const id of Object.values(RIG_LAYERS)) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    drawn.delete(map);
    return;
  }
  const source = map.getSource<GeoJSONSource>(SOURCE);
  if (source && drawn.get(map) !== view.points) source.setData(view.points);
  else if (!source) map.addSource(SOURCE, { type: 'geojson', data: view.points });
  drawn.set(map, view.points);
  if (!map.hasImage(TRIANGLE)) {
    map.addImage(TRIANGLE, triangleImage(), { sdf: true, pixelRatio: 2 });
  }
  const edge = tone === 'light' ? '#1c1917' : '#0c0a09';
  if (!map.getLayer(RIG_LAYERS.now)) {
    const anchor = beforeId && map.getLayer(beforeId) ? beforeId : undefined;
    map.addLayer(
      {
        id: RIG_LAYERS.moves,
        type: 'circle',
        source: SOURCE,
        filter: ['!', ['get', 'now']],
        paint: {
          'circle-color': RIG_COLOUR,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2, 10, 4, 14, 6],
          'circle-stroke-width': 0.75,
          'circle-stroke-color': edge,
          // The newest moves strong, the oldest faint.
          'circle-opacity': ['interpolate', ['linear'], ['get', 'age'], 0, 0.85, 1, 0.2],
          'circle-stroke-opacity': ['interpolate', ['linear'], ['get', 'age'], 0, 0.8, 1, 0.2],
        },
      },
      anchor,
    );
    map.addLayer(
      {
        id: RIG_LAYERS.now,
        type: 'symbol',
        source: SOURCE,
        filter: ['get', 'now'],
        layout: {
          'icon-image': TRIANGLE,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 9, 0.9, 14, 1.3],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: { 'icon-color': RIG_COLOUR, 'icon-halo-width': 1.25, 'icon-halo-color': edge },
      },
      anchor,
    );
    map.addLayer(
      {
        id: RIG_LAYERS.picked,
        type: 'symbol',
        source: SOURCE,
        layout: {
          'icon-image': TRIANGLE,
          'icon-size': 1.8,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: { 'icon-color': RIG_COLOUR, 'icon-halo-width': 2, 'icon-halo-color': edge },
      },
      anchor,
    );
  }
  map.setPaintProperty(RIG_LAYERS.now, 'icon-halo-color', edge);
  map.setPaintProperty(RIG_LAYERS.moves, 'circle-stroke-color', edge);
  map.setFilter(RIG_LAYERS.picked, ['in', ['get', 'key'], ['literal', [...view.picked]]]);
  placeRigs(map, beforeId);
}
