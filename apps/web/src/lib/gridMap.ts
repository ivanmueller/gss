import type { ExpressionSpecification, GeoJSONSource, Map as MapboxMap } from 'mapbox-gl';

import { FACILITY_LAYERS } from './facilitiesMap';
import { SALE_LAYERS } from './landSalesMap';
import { ST37_LAYERS } from './st37Map';

// The township grid on the oil and gas map (F-240, F-271): the province's township, section,
// quarter section and legal subdivision lines, each from its own zoom, with their numbers, and
// the three meridians the land is counted from. Above the land and the sale parcels, so a parcel
// reads against its squares, and under the wells and the sales' dots.

export interface GridView {
  /** The grid's shapes, each with its `level`. */
  shapes: GeoJSON.FeatureCollection;
  /** One point a shape, in its middle, with its `level` and `label`. */
  labels: GeoJSON.FeatureCollection;
  /** The meridians as lines, each with its `label`. */
  meridians: GeoJSON.FeatureCollection;
}

const SOURCE = 'ats-grid';
const LABELS = 'ats-grid-labels';
const MERIDIANS = 'ats-grid-meridians';

export const GRID_LAYERS = {
  lsd: 'ats-grid-lsd',
  quarter: 'ats-grid-quarter',
  section: 'ats-grid-section',
  township: 'ats-grid-township',
  meridian: 'ats-grid-meridian',
  lsdLabels: 'ats-grid-lsd-labels',
  quarterLabels: 'ats-grid-quarter-labels',
  sectionLabels: 'ats-grid-section-labels',
  townshipLabels: 'ats-grid-township-labels',
  meridianLabels: 'ats-grid-meridian-labels',
} as const;
const ORDER = Object.values(GRID_LAYERS);

/** What each map's sources were last given, so unchanged data is not read again. */
const drawn = new WeakMap<MapboxMap, GridView>();

const level = (name: string): ExpressionSpecification => ['==', ['get', 'level'], name];

/** The layer the grid goes under: the facilities, the sales' dots, the wells, else the pins. */
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
    for (const id of [SOURCE, LABELS, MERIDIANS]) if (map.getSource(id)) map.removeSource(id);
    drawn.delete(map);
    return;
  }
  const before = drawn.get(map);
  if (!map.getSource(SOURCE) || before?.shapes !== view.shapes) setData(map, SOURCE, view.shapes);
  if (!map.getSource(LABELS) || before?.labels !== view.labels) setData(map, LABELS, view.labels);
  if (!map.getSource(MERIDIANS) || before?.meridians !== view.meridians) {
    setData(map, MERIDIANS, view.meridians);
  }
  drawn.set(map, view);

  const ink = tone === 'light' ? '#44403c' : '#e7e5e4';
  const halo = tone === 'light' ? 'rgba(250,250,249,0.9)' : 'rgba(28,25,23,0.85)';
  if (!map.getLayer(GRID_LAYERS.township)) {
    const anchor = anchorOf(map, beforeId);
    // Finest first, so the coarser lines are drawn over them.
    const lines: [string, string, number, number, number, number][] = [
      // [layer, level, from zoom, width, opacity near, opacity at its first zoom]
      [GRID_LAYERS.lsd, 'lsd', 14, 0.5, 0.22, 0.1],
      [GRID_LAYERS.quarter, 'quarter', 13, 0.6, 0.3, 0.12],
      [GRID_LAYERS.section, 'section', 11, 0.7, 0.4, 0.15],
      [GRID_LAYERS.township, 'township', 7, 1.1, 0.6, 0.25],
    ];
    for (const [id, name, from, width, near, first] of lines) {
      map.addLayer(
        {
          id,
          type: 'line',
          source: SOURCE,
          minzoom: from,
          filter: level(name),
          layout: { 'line-join': 'round' },
          paint: {
            'line-width': ['interpolate', ['linear'], ['zoom'], from, width, from + 4, width * 1.4],
            // Faint as a level comes in, firmer as the map is zoomed in on it.
            'line-opacity': ['interpolate', ['linear'], ['zoom'], from, first, from + 1.5, near],
          },
        },
        anchor,
      );
    }
    map.addLayer(
      {
        id: GRID_LAYERS.meridian,
        type: 'line',
        source: MERIDIANS,
        paint: { 'line-width': 1.2, 'line-opacity': 0.55, 'line-dasharray': [6, 3] },
      },
      anchor,
    );
    const labels: [string, string, number, number, number][] = [
      // [layer, level, from zoom, to zoom, text size]
      [GRID_LAYERS.lsdLabels, 'lsd', 14.5, 24, 10],
      [GRID_LAYERS.quarterLabels, 'quarter', 13.5, 15.5, 10],
      [GRID_LAYERS.sectionLabels, 'section', 12, 15, 11],
      [GRID_LAYERS.townshipLabels, 'township', 8.5, 12, 11],
    ];
    for (const [id, name, from, to, size] of labels) {
      map.addLayer(
        {
          id,
          type: 'symbol',
          source: LABELS,
          minzoom: from,
          maxzoom: to,
          filter: level(name),
          layout: {
            'text-field': ['get', 'label'],
            'text-size': size,
            'text-padding': 4,
          },
          paint: { 'text-halo-width': 1.2, 'text-opacity': 0.75 },
        },
        anchor,
      );
    }
    map.addLayer(
      {
        id: GRID_LAYERS.meridianLabels,
        type: 'symbol',
        source: MERIDIANS,
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 400,
          'text-field': ['get', 'label'],
          'text-size': 11,
          'text-letter-spacing': 0.05,
        },
        paint: { 'text-halo-width': 1.4, 'text-opacity': 0.8 },
      },
      anchor,
    );
  }
  for (const id of ORDER) {
    const layer = map.getLayer(id);
    if (!layer) continue;
    if (layer.type === 'line') map.setPaintProperty(id, 'line-color', ink);
    else {
      map.setPaintProperty(id, 'text-color', ink);
      map.setPaintProperty(id, 'text-halo-color', halo);
    }
  }
  placeGrid(map, beforeId);
}
