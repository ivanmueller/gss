import type { ExpressionSpecification, GeoJSONSource, Map as MapboxMap } from 'mapbox-gl';

import { FACILITY_LAYERS } from './facilitiesMap';
import { GRID_LAYERS } from './gridMap';
import { PIPELINE_LAYERS } from './pipelinesMap';
import { ST37_LAYERS } from './st37Map';

// The formations' outlines on the oil and gas map (F-280; the owner, 2026-11-23: a Formations
// section where each formation is switched on and off, not tied to Wells & licences; F-281, the
// other formations from the Survey's 3D model): each a
// faint fill and a line in its own colour, as the Survey drew the area (holes where the formation
// is absent). Over the land held and the sale parcels; under the wells' zones and shading, the
// township grid, the pipelines, the facilities and the wells.

/** Each formation's colour on a light map and on a dark or satellite one. */
export const FORMATION_COLOURS: Record<'light' | 'dark', Record<string, string>> = {
  light: {
    wilrich: '#0f766e',
    'north-nordegg': '#6d28d9',
    montney: '#c2410c',
    'basal-banff-exshaw': '#a16207',
    muskwa: '#be185d',
    // The ink the Duvernay's outline has had since F-252, so the map opens as before.
    duvernay: '#44403c',
    'horseshoe-canyon': '#4d7c0f',
    cardium: '#0369a1',
    'second-white-specks': '#475569',
    dunvegan: '#047857',
    viking: '#4338ca',
    'spirit-river': '#a21caf',
    mannville: '#854d0e',
    clearwater: '#0e7490',
    bluesky: '#1d4ed8',
    'rock-creek': '#be123c',
    halfway: '#991b1b',
    doig: '#7e22ce',
    wabamun: '#15803d',
    nisku: '#9a3412',
    leduc: '#8b5cf6',
    'beaverhill-lake': '#0c4a6e',
  },
  dark: {
    wilrich: '#5eead4',
    'north-nordegg': '#c4b5fd',
    montney: '#fdba74',
    'basal-banff-exshaw': '#fde047',
    muskwa: '#f9a8d4',
    duvernay: '#e7e5e4',
    'horseshoe-canyon': '#bef264',
    cardium: '#7dd3fc',
    'second-white-specks': '#cbd5e1',
    dunvegan: '#6ee7b7',
    viking: '#a5b4fc',
    'spirit-river': '#f0abfc',
    mannville: '#fef08a',
    clearwater: '#67e8f9',
    bluesky: '#93c5fd',
    'rock-creek': '#fda4af',
    halfway: '#fca5a5',
    doig: '#d8b4fe',
    wabamun: '#86efac',
    nisku: '#fed7aa',
    leduc: '#ddd6fe',
    'beaverhill-lake': '#bae6fd',
  },
};

export interface FormationsView {
  /** The outlines switched on, each feature with its formation's `key`. */
  outlines: GeoJSON.FeatureCollection;
}

const SOURCE = 'formations';
export const FORMATION_LAYERS = {
  fill: 'formation-fill',
  line: 'formation-line',
} as const;

/** What each map's source was last given. */
const drawn = new WeakMap<MapboxMap, GeoJSON.FeatureCollection>();

/**
 * The layer the outlines go under: the wells' zones and shading, the grid, the pipelines, the
 * facilities, the wells, else the pins; listed as they lie on the map, the lowest first.
 */
function anchorOf(map: MapboxMap, beforeId?: string): string | undefined {
  const first = [
    ST37_LAYERS.zones,
    ST37_LAYERS.density,
    GRID_LAYERS.lsd,
    GRID_LAYERS.quarter,
    GRID_LAYERS.section,
    GRID_LAYERS.township,
    GRID_LAYERS.picked,
    PIPELINE_LAYERS.lines,
    PIPELINE_LAYERS.permitted,
    PIPELINE_LAYERS.hit,
    PIPELINE_LAYERS.picked,
    FACILITY_LAYERS.squares,
    FACILITY_LAYERS.picked,
    ST37_LAYERS.paths,
    ST37_LAYERS.planned,
    ST37_LAYERS.dots,
    ST37_LAYERS.pending,
    ST37_LAYERS.wells,
  ].find((id) => map.getLayer(id));
  return first ?? (beforeId && map.getLayer(beforeId) ? beforeId : undefined);
}

/**
 * Keeps the outlines over the land and the sale parcels and under everything else: those drawn
 * after them are placed by their own rules, so the outlines are moved back after each.
 */
export function placeFormations(map: MapboxMap, beforeId?: string) {
  if (!map.getLayer(FORMATION_LAYERS.fill)) return;
  const anchor = anchorOf(map, beforeId);
  for (const id of Object.values(FORMATION_LAYERS)) {
    if (map.getLayer(id)) map.moveLayer(id, anchor);
  }
}

export function syncFormations(
  map: MapboxMap,
  view: FormationsView | null,
  tone: 'light' | 'dark',
  beforeId?: string,
) {
  if (view === null) {
    for (const id of Object.values(FORMATION_LAYERS)) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    drawn.delete(map);
    return;
  }
  const source = map.getSource<GeoJSONSource>(SOURCE);
  if (source && drawn.get(map) !== view.outlines) source.setData(view.outlines);
  else if (!source) map.addSource(SOURCE, { type: 'geojson', data: view.outlines });
  drawn.set(map, view.outlines);

  if (!map.getLayer(FORMATION_LAYERS.fill)) {
    const anchor = anchorOf(map, beforeId);
    map.addLayer(
      {
        id: FORMATION_LAYERS.fill,
        type: 'fill',
        source: SOURCE,
        // Fades as the map closes in, where the wells and the land show the ground.
        paint: { 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.07, 10, 0.03] },
      },
      anchor,
    );
    map.addLayer(
      {
        id: FORMATION_LAYERS.line,
        type: 'line',
        source: SOURCE,
        layout: { 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.2, 10, 1.8],
          'line-opacity': 0.75,
        },
      },
      anchor,
    );
  }
  const colour = [
    'match',
    ['get', 'key'],
    ...Object.entries(FORMATION_COLOURS[tone]).flat(),
    FORMATION_COLOURS[tone].duvernay ?? '#44403c',
  ] as ExpressionSpecification;
  map.setPaintProperty(FORMATION_LAYERS.fill, 'fill-color', colour);
  map.setPaintProperty(FORMATION_LAYERS.line, 'line-color', colour);
  placeFormations(map, beforeId);
}
