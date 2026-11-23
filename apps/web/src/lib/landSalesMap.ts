import type { ExpressionSpecification, GeoJSONSource, Map as MapboxMap } from 'mapbox-gl';

import type { LandShape } from './landMap';
import { ST37_LAYERS } from './st37Map';

/**
 * Crown land sales on the oil and gas map (F-242): the parcels of the province's public
 * offerings, sold ones in blues by the bonus paid per hectare, those with no offers in grey,
 * those of a sale not held yet with a dashed orange edge. Drawn over the land held today and
 * under the wells. Zoomed out, each parcel becomes one dot in its colour (F-262). Data from
 * Alberta Energy and Minerals (docs/DECISIONS.md, 2026-11-21).
 */

/**
 * How the parcels give way to dots as the map is zoomed out (F-262, F-264; the owner,
 * 2026-11-21, by the distance bar and the mouse wheel, from pictures of another map): the
 * parcels start to fade as the bar turns to 20 km (SALE_AREAS_FULL) and are gone by the second
 * scroll after it reads 30 km (SALE_AREAS_GONE), steadily over those six scrolls; the dots come
 * in as steadily over the first four, whole as the bar turns to 30 km (SALE_DOTS_FULL). A dot
 * first shows as a pale ring on its own parcel, which then fades away around it, so a square
 * flows into a circle. At first the dots were whole within one scroll, the parcels dropping to
 * half with it: "from square to circle almost instantly". The bar's readings as in
 * `mapDetail.ts`.
 */
export const SALE_AREAS_FULL = 8.1;
export const SALE_DOTS_FULL = 7.5;
export const SALE_AREAS_GONE = 7.2;

/** A parcel's opacity: `full` close in, steadily less from SALE_AREAS_FULL out, then nothing. */
function areaFade(full: number | ExpressionSpecification): ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], SALE_AREAS_GONE, 0, SALE_AREAS_FULL, full];
}
/** A dot's opacity: nothing while the parcels are whole, `full` from SALE_DOTS_FULL out. */
function dotFade(full: number): ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], SALE_DOTS_FULL, full, SALE_AREAS_FULL, 0];
}

export interface LandSaleParcel {
  id: string;
  saleDate: string;
  contractNo: string;
  contractType: string | null;
  region: string | null;
  hectares: string | null;
  zone: string | null;
  land: string;
  inexact: boolean;
  /** The result as published (ACCEPTED, NO OFFERS ...); null until the sale has results. */
  status: string | null;
  bonus: string | null;
  dollarsPerHectare: string | null;
  buyers: string | null;
  /** The restriction codes that apply to it, separated by spaces (F-265); none until loaded. */
  restrictions?: string | null;
  /** Its deeper rights reversion zone codes, the same way. */
  reversionZones?: string | null;
  /**
   * Its rights tract by tract, as the notice writes them, each tract's lines joined by `; `
   * (F-276); none until loaded.
   */
  tractRights?: string[] | null;
  /**
   * The agreement the province issued from it and who holds it today (F-276), found by the
   * database among the land held that is loaded; none when it was not sold or none is loaded.
   */
  heldAgreement?: string | null;
  heldBy?: string | null;
  shape: LandShape;
}

/** A sale's notice and results as PDF files on the department's site (F-265); null for none. */
export interface LandSaleDocuments {
  notice: string | null;
  results: string | null;
}

/** How a parcel stands: sold, offered with no taker (or any other result), or not sold yet. */
export type LandSaleState = 'sold' | 'no_offers' | 'upcoming';
/**
 * A parcel with no result is upcoming only while its sale is still to come (`today` as
 * YYYY-MM-DD): one of a past sale that the results do not list counts with the unsold.
 */
export function landSaleState(
  parcel: Pick<LandSaleParcel, 'status' | 'saleDate'>,
  today: string,
): LandSaleState {
  if (parcel.status === 'ACCEPTED') return 'sold';
  return parcel.status === null && parcel.saleDate >= today ? 'upcoming' : 'no_offers';
}

/**
 * The steps of the bonus per hectare, in dollars, and the blue of each: under the first step
 * the lightest, from the last step up the darkest. Fixed steps, so a colour means the same
 * wherever the map is.
 */
export const SALE_STEPS = [25, 50, 100, 200, 400, 800] as const;
export const SALE_BLUES = [
  '#bcd5f4',
  '#93bbee',
  '#6a9fe3',
  '#4583d6',
  '#2c68bd',
  '#1d4e96',
  '#14356b',
] as const;
export const SALE_NO_OFFERS = '#c9c1b2';
export const SALE_UPCOMING = '#e2622f';

/** The colour of a parcel: its blue by dollars per hectare when sold. */
export function landSaleColour(
  parcel: Pick<LandSaleParcel, 'status' | 'saleDate' | 'dollarsPerHectare'>,
  today: string,
) {
  const state = landSaleState(parcel, today);
  if (state === 'upcoming') return SALE_UPCOMING;
  const price = parcel.dollarsPerHectare === null ? Number.NaN : Number(parcel.dollarsPerHectare);
  if (state === 'no_offers' || !Number.isFinite(price)) return SALE_NO_OFFERS;
  const step = SALE_STEPS.findIndex((limit) => price < limit);
  return SALE_BLUES[step === -1 ? SALE_BLUES.length - 1 : step] ?? SALE_NO_OFFERS;
}

/** One parcel on the map, as a click reports it. */
export const landSaleKey = (id: string) => `sale:${id}`;

/** What each map's source was last given. */
const drawn = new WeakMap<MapboxMap, GeoJSON.FeatureCollection>();
const SOURCE = 'land-sales';
export const SALE_LAYERS = {
  fill: 'land-sale-fill',
  line: 'land-sale-line',
  upcoming: 'land-sale-upcoming',
  dots: 'land-sale-dots',
  picked: 'land-sale-picked',
} as const;
/** The layers a click can find a parcel on: its area close in, its dot far out. */
export const SALE_PICKABLE = [SALE_LAYERS.dots, SALE_LAYERS.fill];

export interface LandSalesView {
  parcels: GeoJSON.FeatureCollection;
  /** The keys of the parcels whose card is open, outlined bold. */
  picked: readonly string[];
}

/** Twice the signed area of a ring, and the sums its centre is made of (the shoelace sums). */
function ringSums(ring: readonly number[][]) {
  let area = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i + 1 < ring.length; i += 1) {
    const [x0 = 0, y0 = 0] = ring[i] ?? [];
    const [x1 = 0, y1 = 0] = ring[i + 1] ?? [];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    x += (x0 + x1) * cross;
    y += (y0 + y1) * cross;
  }
  return { area, x, y };
}

/**
 * Where a parcel's dot goes: the middle of its largest piece (a parcel can be several pieces
 * apart, whose common middle may lie on none of them); null for a shape with no ground.
 */
export function landSaleCentre(shape: LandShape): [number, number] | null {
  const kept = centres.get(shape);
  if (kept !== undefined) return kept;
  const centre = centreOf(shape);
  centres.set(shape, centre);
  return centre;
}
/** Worked out once a shape: the features are made again on every change of a filter. */
const centres = new WeakMap<LandShape, [number, number] | null>();
function centreOf(shape: LandShape): [number, number] | null {
  let best: { area: number; x: number; y: number } | null = null;
  for (const polygon of shape) {
    const outer = polygon[0];
    if (!outer) continue;
    const sums = ringSums(outer);
    if (best === null || Math.abs(sums.area) > Math.abs(best.area)) best = sums;
  }
  if (best === null || best.area === 0) return null;
  return [best.x / (3 * best.area), best.y / (3 * best.area)];
}

/**
 * The parcels as map features: older sales first, so the newest is drawn on top. Each parcel
 * twice: its area (`part` "area") and the dot it becomes zoomed out (`part` "dot").
 */
export function landSaleFeatures(
  parcels: readonly LandSaleParcel[],
  today: string,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const p of [...parcels].sort((a, b) => a.saleDate.localeCompare(b.saleDate))) {
    const properties = {
      key: landSaleKey(p.id),
      state: landSaleState(p, today),
      colour: landSaleColour(p, today),
    };
    features.push({
      type: 'Feature',
      geometry: { type: 'MultiPolygon', coordinates: p.shape },
      properties: { ...properties, part: 'area' },
    });
    const centre = landSaleCentre(p.shape);
    if (centre) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: centre },
        properties: { ...properties, part: 'dot' },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Brings the map in line with the parcels: adds their source and layers the first time (under
 * the wells when they are drawn, else under `beforeId`, the pins), updates the data after;
 * removes them all when `view` is null.
 */
export function syncLandSales(
  map: MapboxMap,
  view: LandSalesView | null,
  tone: 'light' | 'dark',
  beforeId?: string,
) {
  if (view === null) {
    for (const id of Object.values(SALE_LAYERS)) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    drawn.delete(map);
    return;
  }
  const existing = map.getSource<GeoJSONSource>(SOURCE);
  // The same shapes again (a card opened, the map moved) are not read again by the map (F-263).
  if (existing && drawn.get(map) !== view.parcels) existing.setData(view.parcels);
  else if (!existing) map.addSource(SOURCE, { type: 'geojson', data: view.parcels });
  drawn.set(map, view.parcels);

  if (!map.getLayer(SALE_LAYERS.fill)) {
    const under =
      [ST37_LAYERS.outlineFill, ST37_LAYERS.zones, ST37_LAYERS.density].find((id) =>
        map.getLayer(id),
      ) ?? (beforeId && map.getLayer(beforeId) ? beforeId : undefined);
    const area = (...more: unknown[]) =>
      ['all', ['==', ['get', 'part'], 'area'], ...more] as ExpressionSpecification;
    map.addLayer(
      {
        id: SALE_LAYERS.fill,
        type: 'fill',
        source: SOURCE,
        // Gives way to the dots as the map is zoomed out (F-262), as the lines below.
        minzoom: SALE_AREAS_GONE,
        filter: area(),
        paint: {
          'fill-color': ['get', 'colour'],
          'fill-opacity': areaFade([
            'match',
            ['get', 'state'],
            'upcoming',
            0.35,
            'no_offers',
            0.75,
            0.9,
          ]),
        },
      },
      under,
    );
    map.addLayer(
      {
        id: SALE_LAYERS.line,
        type: 'line',
        source: SOURCE,
        minzoom: SALE_AREAS_GONE,
        filter: area(['!=', ['get', 'state'], 'upcoming']),
        paint: {
          'line-color': '#f8f6f0',
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.2, 12, 0.8],
          'line-opacity': areaFade(0.7),
        },
      },
      under,
    );
    map.addLayer(
      {
        id: SALE_LAYERS.upcoming,
        type: 'line',
        source: SOURCE,
        minzoom: SALE_AREAS_GONE,
        filter: area(['==', ['get', 'state'], 'upcoming']),
        paint: {
          'line-color': SALE_UPCOMING,
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1, 12, 1.8],
          'line-dasharray': [2, 1.5],
          'line-opacity': areaFade(1),
        },
      },
      under,
    );
    // One dot a parcel, the same size on screen at every zoom, so far out the sales read as a
    // field of dots in their colours (F-262).
    map.addLayer(
      {
        id: SALE_LAYERS.dots,
        type: 'circle',
        source: SOURCE,
        maxzoom: SALE_AREAS_FULL,
        filter: ['==', ['get', 'part'], 'dot'],
        paint: {
          'circle-color': ['get', 'colour'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2, 6, 3.2, 8, 4.2],
          'circle-opacity': dotFade(1),
          'circle-stroke-color': '#f8f6f0',
          'circle-stroke-width': 0.5,
          'circle-stroke-opacity': dotFade(0.6),
        },
      },
      under,
    );
    map.addLayer(
      {
        id: SALE_LAYERS.picked,
        type: 'line',
        source: SOURCE,
        filter: area(),
        layout: { 'line-join': 'round' },
        paint: { 'line-width': 2.5 },
      },
      under,
    );
  }
  map.setPaintProperty(SALE_LAYERS.picked, 'line-color', tone === 'light' ? '#1c1917' : '#fafaf9');
  map.setFilter(SALE_LAYERS.picked, [
    'all',
    ['==', ['get', 'part'], 'area'],
    ['in', ['get', 'key'], ['literal', [...view.picked]]],
  ]);
}
