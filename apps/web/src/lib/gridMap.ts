import type { ExpressionSpecification, GeoJSONSource, Map as MapboxMap } from 'mapbox-gl';

import { FACILITY_LAYERS } from './facilitiesMap';
import { SALE_LAYERS } from './landSalesMap';
import { PIPELINE_LAYERS } from './pipelinesMap';
import { ST37_LAYERS } from './st37Map';

// The township grid on the oil and gas map (F-240, F-271): every township's lines from a file
// kept with the app, drawn at once; sections, quarter sections and legal subdivisions from the
// province's service close in; the square a click identified, outlined. No numbers inside the
// squares: the range and township numbers run along the map's edges (gridEdges.ts; the owner,
// 2026-11-22). Above the land and the sale parcels, under the facilities, the sales' dots and
// the wells.

export interface GridView {
  /** Every township's lines, each edge once. */
  townships: GeoJSON.FeatureCollection;
  /** The finer levels' shapes close in, each with its `level`. */
  shapes: GeoJSON.FeatureCollection;
  /** The square a click identified; empty for none. */
  picked: GeoJSON.FeatureCollection;
}

const TOWNSHIPS = 'ats-townships';
const SOURCE = 'ats-grid';
const PICKED = 'ats-grid-picked';

export const GRID_LAYERS = {
  lsd: 'ats-grid-lsd',
  quarter: 'ats-grid-quarter',
  section: 'ats-grid-section',
  township: 'ats-grid-township',
  picked: 'ats-grid-picked-line',
} as const;
const ORDER = Object.values(GRID_LAYERS);

/**
 * The townships start to fade in as the distance bar turns to 30 km, zooming in toward 20 km
 * (the owner, 2026-11-23; zoom 7.5 and 8.1 around the Duvernay, mapDetail.ts; it was the second
 * scroll after the bar read 30 km, zoom 7.8), and darken as the map is zoomed in to the
 * strengths read from the owner's reference pictures (2026-11-22, on the warm grey land, 243 240
 * 232): about 8% darker by the second scroll (223 220 213), 19% at the 20 km bar (197 194 184),
 * 26% from the 10 km bar (179 177 169), each a 1-pixel line.
 */
export const GRID_FROM = 7.5;
const TOWNSHIP_OPACITY: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  GRID_FROM,
  0,
  7.8,
  0.08,
  8.1,
  0.19,
  9,
  0.26,
];

/** What each map's sources were last given, so unchanged data is not read again. */
const drawn = new WeakMap<MapboxMap, GridView>();

const level = (name: string): ExpressionSpecification => ['==', ['get', 'level'], name];

/**
 * The layer the grid goes under: the pipelines, the facilities, the sales' dots, the wells, else
 * the pins.
 */
function anchorOf(map: MapboxMap, beforeId?: string): string | undefined {
  const first = [
    PIPELINE_LAYERS.lines,
    PIPELINE_LAYERS.permitted,
    PIPELINE_LAYERS.hit,
    PIPELINE_LAYERS.picked,
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

/**
 * Keeps the grid above the land and under the wells: land, sales and wells drawn after it are
 * placed by their own rules, so the grid is moved back after each of them.
 */
export function placeGrid(map: MapboxMap, beforeId?: string) {
  if (!map.getLayer(GRID_LAYERS.township)) return;
  const anchor = anchorOf(map, beforeId);
  for (const id of ORDER) if (map.getLayer(id)) map.moveLayer(id, anchor);
}

function setData(map: MapboxMap, id: string, data: GeoJSON.FeatureCollection) {
  const source = map.getSource<GeoJSONSource>(id);
  if (source) source.setData(data);
  else map.addSource(id, { type: 'geojson', data });
}

export function syncGrid(
  map: MapboxMap,
  view: GridView | null,
  tone: 'light' | 'dark',
  beforeId?: string,
) {
  if (view === null) {
    for (const id of ORDER) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of [TOWNSHIPS, SOURCE, PICKED]) if (map.getSource(id)) map.removeSource(id);
    drawn.delete(map);
    return;
  }
  const before = drawn.get(map);
  const sources: [string, GeoJSON.FeatureCollection, GeoJSON.FeatureCollection | undefined][] = [
    [TOWNSHIPS, view.townships, before?.townships],
    [SOURCE, view.shapes, before?.shapes],
    [PICKED, view.picked, before?.picked],
  ];
  for (const [id, data, was] of sources) {
    if (!map.getSource(id) || was !== data) setData(map, id, data);
  }
  drawn.set(map, view);

  if (!map.getLayer(GRID_LAYERS.township)) {
    const anchor = anchorOf(map, beforeId);
    // Finest first, so the coarser lines are drawn over them; each fainter than the township.
    const finer: [string, string, number, number][] = [
      // [layer, level, from zoom, opacity close in]
      [GRID_LAYERS.lsd, 'lsd', 14, 0.1],
      [GRID_LAYERS.quarter, 'quarter', 13, 0.13],
      [GRID_LAYERS.section, 'section', 11, 0.17],
    ];
    for (const [id, name, from, near] of finer) {
      map.addLayer(
        {
          id,
          type: 'line',
          source: SOURCE,
          minzoom: from,
          filter: level(name),
          paint: {
            'line-width': 1,
            'line-opacity': ['interpolate', ['linear'], ['zoom'], from, 0, from + 0.6, near],
          },
        },
        anchor,
      );
    }
    map.addLayer(
      {
        id: GRID_LAYERS.township,
        type: 'line',
        source: TOWNSHIPS,
        minzoom: GRID_FROM,
        paint: { 'line-width': 1, 'line-opacity': TOWNSHIP_OPACITY },
      },
      anchor,
    );
    map.addLayer(
      {
        id: GRID_LAYERS.picked,
        type: 'line',
        source: PICKED,
        layout: { 'line-join': 'round' },
        paint: { 'line-width': 2.5, 'line-opacity': 0.9 },
      },
      anchor,
    );
  }
  // Black lines on the light map, white on the dark one and the satellite.
  const ink = tone === 'light' ? '#000000' : '#ffffff';
  for (const id of ORDER) {
    if (!map.getLayer(id)) continue;
    map.setPaintProperty(
      id,
      'line-color',
      id === GRID_LAYERS.picked ? (tone === 'light' ? '#1c1917' : '#fafaf9') : ink,
    );
  }
  placeGrid(map, beforeId);
}
