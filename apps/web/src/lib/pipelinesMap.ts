import type { PipelineSubstance } from '@grain/domain';
import type { ExpressionSpecification, GeoJSONSource, Map as MapboxMap } from 'mapbox-gl';

import { FACILITY_LAYERS } from './facilitiesMap';
import { SALE_LAYERS } from './landSalesMap';
import { ST37_LAYERS } from './st37Map';

// Pipelines on the oil and gas map (F-249): the AER's licensed lines, each coloured by what it
// carries and drawn wider for a larger pipe; operating lines at full strength, permitted ones
// dashed, discontinued ones faint and abandoned or removed ones fainter still. Over the land, the
// sale parcels and the township grid; under the facilities, the sales' dots and the wells.

/** Each substance group's colour, the same in the legend, the chips and on the map. */
export const PIPELINE_COLOURS: Record<PipelineSubstance, string> = {
  gas: '#e8590c',
  sour_gas: '#c2255c',
  effluent: '#2b8a3e',
  crude: '#5c3d2e',
  products: '#7048e8',
  water: '#1c7ed6',
  other: '#868e96',
};

/** How strongly a status is drawn: in use, idle, or out of use. */
export function pipelineStrength(status: string | null): number {
  switch (status) {
    case 'Operating':
    case 'Permitted':
      return 1;
    case 'Discontinued':
      return 0.5;
    default:
      return 0.25;
  }
}

export interface PipelinesView {
  /**
   * One feature a segment, with its `key` ("pipeline:ID"), `colour`, `strength` (pipelineStrength),
   * `diameter` (mm, 0 when not given) and `permitted`.
   */
  lines: GeoJSON.FeatureCollection;
  /** The keys of the segment whose panel is open, drawn bolder. */
  picked: readonly string[];
}

const SOURCE = 'pipelines';
export const PIPELINE_LAYERS = {
  lines: 'pipeline-lines',
  permitted: 'pipeline-permitted',
  hit: 'pipeline-hit',
  picked: 'pipeline-picked',
} as const;
/** The layer a pointer finds a segment on: wider than the line, unseen. */
export const PIPELINE_PICKABLE = [PIPELINE_LAYERS.hit];

/** The zoom the large lines are drawn from: the second scroll after the bar reads 30 km. */
export const PIPELINES_FROM = 7.8;

const diameter: ExpressionSpecification = ['get', 'diameter'];
/** Wider for a larger pipe, and wider close in. */
const WIDTH: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  PIPELINES_FROM,
  ['case', ['>=', diameter, 508], 2, ['>=', diameter, 219.1], 1.2, 0.6],
  12,
  [
    'case',
    ['>=', diameter, 508],
    3.5,
    ['>=', diameter, 219.1],
    2.2,
    ['>=', diameter, 114.3],
    1.4,
    1,
  ],
  16,
  ['case', ['>=', diameter, 508], 6, ['>=', diameter, 219.1], 4, ['>=', diameter, 114.3], 2.6, 1.8],
];
/** Fades in over a scroll, then each line at its status's strength. */
const OPACITY: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  PIPELINES_FROM,
  0,
  PIPELINES_FROM + 0.3,
  ['*', 0.85, ['get', 'strength']],
];

/** What each map's source was last given. */
const drawn = new WeakMap<MapboxMap, GeoJSON.FeatureCollection>();

/** The layer pipelines go under: the facilities, the sales' dots, the wells, else the pins. */
function anchorOf(map: MapboxMap, beforeId?: string): string | undefined {
  const first = [
    FACILITY_LAYERS.squares,
    FACILITY_LAYERS.picked,
    SALE_LAYERS.dots,
    ST37_LAYERS.paths,
    ST37_LAYERS.planned,
    ST37_LAYERS.dots,
    ST37_LAYERS.pending,
    ST37_LAYERS.wells,
  ].find((id) => map.getLayer(id));
  return first ?? (beforeId && map.getLayer(beforeId) ? beforeId : undefined);
}

/** Keeps the pipelines over the land and under the facilities after either is drawn again. */
export function placePipelines(map: MapboxMap, beforeId?: string) {
  if (!map.getLayer(PIPELINE_LAYERS.lines)) return;
  const anchor = anchorOf(map, beforeId);
  for (const id of Object.values(PIPELINE_LAYERS)) {
    if (map.getLayer(id)) map.moveLayer(id, anchor);
  }
}

export function syncPipelines(map: MapboxMap, view: PipelinesView | null, beforeId?: string) {
  if (view === null) {
    for (const id of Object.values(PIPELINE_LAYERS)) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    drawn.delete(map);
    return;
  }
  const source = map.getSource<GeoJSONSource>(SOURCE);
  if (source && drawn.get(map) !== view.lines) source.setData(view.lines);
  else if (!source) map.addSource(SOURCE, { type: 'geojson', data: view.lines });
  drawn.set(map, view.lines);

  if (!map.getLayer(PIPELINE_LAYERS.lines)) {
    const anchor = anchorOf(map, beforeId);
    const common = {
      source: SOURCE,
      minzoom: PIPELINES_FROM,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    } as const;
    map.addLayer(
      {
        id: PIPELINE_LAYERS.lines,
        type: 'line',
        ...common,
        filter: ['!', ['get', 'permitted']],
        paint: { 'line-color': ['get', 'colour'], 'line-width': WIDTH, 'line-opacity': OPACITY },
      },
      anchor,
    );
    map.addLayer(
      {
        id: PIPELINE_LAYERS.permitted,
        type: 'line',
        ...common,
        layout: { 'line-join': 'round', 'line-cap': 'butt' },
        filter: ['get', 'permitted'],
        paint: {
          'line-color': ['get', 'colour'],
          'line-width': WIDTH,
          'line-opacity': OPACITY,
          'line-dasharray': [2, 1.5],
        },
      },
      anchor,
    );
    // Unseen, wider than the line: the pointer finds a thin line within a few pixels.
    map.addLayer(
      {
        id: PIPELINE_LAYERS.hit,
        type: 'line',
        ...common,
        paint: { 'line-color': '#000000', 'line-width': 9, 'line-opacity': 0 },
      },
      anchor,
    );
    map.addLayer(
      {
        id: PIPELINE_LAYERS.picked,
        type: 'line',
        source: SOURCE,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'colour'],
          'line-width': ['+', 3, ['/', diameter, 150]],
          'line-opacity': 1,
        },
      },
      anchor,
    );
  }
  map.setFilter(PIPELINE_LAYERS.picked, ['in', ['get', 'key'], ['literal', [...view.picked]]]);
  placePipelines(map, beforeId);
}
