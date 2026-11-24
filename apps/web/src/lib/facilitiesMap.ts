import type { FacilityGroup } from '@grain/domain';
import type { ExpressionSpecification, GeoJSONSource, Map as MapboxMap } from 'mapbox-gl';

import { SALE_LAYERS } from './landSalesMap';
import { operatorColourExpression, type OperatorColour } from './operatorColours';
import { ST37_LAYERS } from './st37Map';

// Facilities on the oil and gas map (F-278): the AER's batteries, plants, compressor stations
// and the rest, each a small square in its kind's colour, from close enough in to tell them
// apart; faint when the AER lists it suspended, abandoned or retired. Over the land, the sale
// parcels and the township grid; under the sales' dots and the wells.

/** Each kind's colour, the same in the legend, the chips and on the map. */
export const FACILITY_COLOURS: Record<FacilityGroup, string> = {
  oil_battery: '#2e7d32',
  gas_battery: '#c62828',
  bitumen: '#6d4c41',
  gas_plant: '#ad1457',
  compressor: '#ef6c00',
  gathering: '#c49000',
  meter: '#1565c0',
  injection: '#5e35b1',
  terminal: '#00838f',
  water: '#0288d1',
  other: '#757575',
};

/** The zoom facilities are drawn from: about a 5 km distance bar. */
export const FACILITIES_FROM = 9;

export interface FacilitiesView {
  /** One point a facility, with its `key` ("facility:ID"), `colour` and `faint`. */
  points: GeoJSON.FeatureCollection;
  /** The keys of the facility whose panel is open, drawn larger with an edge. */
  picked: readonly string[];
  /** Coloured by operator (each point's `op`): the ten and their colours (F-302); else by kind. */
  byOperator?: readonly OperatorColour[] | null;
}

const SOURCE = 'facilities';
const SQUARE = 'facility-square';
export const FACILITY_LAYERS = {
  squares: 'facility-squares',
  picked: 'facility-picked',
} as const;
/** The layers a pointer can find a facility on. */
export const FACILITY_PICKABLE = [FACILITY_LAYERS.squares];

/** What each map's source was last given. */
const drawn = new WeakMap<MapboxMap, GeoJSON.FeatureCollection>();

/**
 * A square as a signed distance field, so the map can colour it (`icon-color`): each pixel's
 * alpha is its distance from the square's edge, 191 on the edge, as Mapbox reads such images
 * (a radius of 8 pixels and a cutoff of a quarter).
 */
export function squareImage(
  size = 24,
  half = 6,
): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(size * size * 4);
  const centre = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.max(Math.abs(x - centre), Math.abs(y - centre)) - half;
      const alpha = Math.round(255 - 255 * (d / 8 + 0.25));
      const at = (y * size + x) * 4;
      data[at] = 0;
      data[at + 1] = 0;
      data[at + 2] = 0;
      data[at + 3] = Math.max(0, Math.min(255, alpha));
    }
  }
  return { width: size, height: size, data };
}

/** The layer facilities go under: the sales' dots, else the wells, else the pins. */
function anchorOf(map: MapboxMap, beforeId?: string): string | undefined {
  const first = [
    SALE_LAYERS.dots,
    ST37_LAYERS.paths,
    ST37_LAYERS.planned,
    ST37_LAYERS.dots,
    ST37_LAYERS.pending,
    ST37_LAYERS.wells,
  ].find((id) => map.getLayer(id));
  return first ?? (beforeId && map.getLayer(beforeId) ? beforeId : undefined);
}

/** Keeps the facilities over the land and under the wells after either is drawn again. */
export function placeFacilities(map: MapboxMap, beforeId?: string) {
  if (!map.getLayer(FACILITY_LAYERS.squares)) return;
  const anchor = anchorOf(map, beforeId);
  for (const id of Object.values(FACILITY_LAYERS)) {
    if (map.getLayer(id)) map.moveLayer(id, anchor);
  }
}

export function syncFacilities(
  map: MapboxMap,
  view: FacilitiesView | null,
  tone: 'light' | 'dark',
  beforeId?: string,
) {
  if (view === null) {
    for (const id of Object.values(FACILITY_LAYERS)) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    drawn.delete(map);
    return;
  }
  const source = map.getSource<GeoJSONSource>(SOURCE);
  if (source && drawn.get(map) !== view.points) source.setData(view.points);
  else if (!source) map.addSource(SOURCE, { type: 'geojson', data: view.points });
  drawn.set(map, view.points);
  if (!map.hasImage(SQUARE)) map.addImage(SQUARE, squareImage(), { sdf: true, pixelRatio: 2 });

  if (!map.getLayer(FACILITY_LAYERS.squares)) {
    const anchor = anchorOf(map, beforeId);
    map.addLayer(
      {
        id: FACILITY_LAYERS.squares,
        type: 'symbol',
        source: SOURCE,
        minzoom: FACILITIES_FROM,
        layout: {
          'icon-image': SQUARE,
          'icon-size': ['interpolate', ['linear'], ['zoom'], FACILITIES_FROM, 0.55, 14, 1.1],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-color': ['get', 'colour'],
          'icon-halo-width': 1,
          'icon-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            FACILITIES_FROM,
            ['case', ['get', 'faint'], 0.25, 0.6],
            FACILITIES_FROM + 1.5,
            ['case', ['get', 'faint'], 0.45, 1],
          ],
        },
      },
      anchor,
    );
    map.addLayer(
      {
        id: FACILITY_LAYERS.picked,
        type: 'symbol',
        source: SOURCE,
        layout: {
          'icon-image': SQUARE,
          'icon-size': 1.6,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: { 'icon-color': ['get', 'colour'], 'icon-halo-width': 2 },
      },
      anchor,
    );
  }
  const own: ExpressionSpecification = ['get', 'colour'];
  const colour = view.byOperator ? operatorColourExpression(view.byOperator) : own;
  map.setPaintProperty(FACILITY_LAYERS.squares, 'icon-color', colour);
  map.setPaintProperty(FACILITY_LAYERS.picked, 'icon-color', colour);
  const halo = tone === 'light' ? '#fafaf9' : '#1c1917';
  map.setPaintProperty(FACILITY_LAYERS.squares, 'icon-halo-color', halo);
  map.setPaintProperty(
    FACILITY_LAYERS.picked,
    'icon-halo-color',
    tone === 'light' ? '#1c1917' : '#fafaf9',
  );
  map.setFilter(FACILITY_LAYERS.picked, ['in', ['get', 'key'], ['literal', [...view.picked]]]);
  placeFacilities(map, beforeId);
}
