import type { GeoJSONSource, Map as MapboxMap } from 'mapbox-gl';

import type { LandShape } from './landMap';
import { ST37_LAYERS } from './st37Map';

/**
 * Crown land sales on the oil and gas map (F-242): the parcels of the province's public
 * offerings, sold ones in blues by the bonus paid per hectare, those with no offers in grey,
 * those of a sale not held yet with a dashed orange edge. Drawn over the land held today and
 * under the wells. Data from Alberta Energy and Minerals (docs/DECISIONS.md, 2026-11-21).
 */

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
  shape: LandShape;
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

const SOURCE = 'land-sales';
export const SALE_LAYERS = {
  fill: 'land-sale-fill',
  line: 'land-sale-line',
  upcoming: 'land-sale-upcoming',
  picked: 'land-sale-picked',
} as const;
/** The layer a click can find a parcel on. */
export const SALE_PICKABLE = [SALE_LAYERS.fill];

export interface LandSalesView {
  parcels: GeoJSON.FeatureCollection;
  /** The keys of the parcels whose card is open, outlined bold. */
  picked: readonly string[];
}

/** The parcels as map features: older sales first, so the newest is drawn on top. */
export function landSaleFeatures(
  parcels: readonly LandSaleParcel[],
  today: string,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [...parcels]
      .sort((a, b) => a.saleDate.localeCompare(b.saleDate))
      .map((p) => ({
        type: 'Feature',
        geometry: { type: 'MultiPolygon', coordinates: p.shape },
        properties: {
          key: landSaleKey(p.id),
          state: landSaleState(p, today),
          colour: landSaleColour(p, today),
        },
      })),
  };
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
    return;
  }
  const existing = map.getSource<GeoJSONSource>(SOURCE);
  if (existing) existing.setData(view.parcels);
  else map.addSource(SOURCE, { type: 'geojson', data: view.parcels });

  if (!map.getLayer(SALE_LAYERS.fill)) {
    const under =
      [ST37_LAYERS.outlineFill, ST37_LAYERS.zones, ST37_LAYERS.density].find((id) =>
        map.getLayer(id),
      ) ?? (beforeId && map.getLayer(beforeId) ? beforeId : undefined);
    map.addLayer(
      {
        id: SALE_LAYERS.fill,
        type: 'fill',
        source: SOURCE,
        paint: {
          'fill-color': ['get', 'colour'],
          'fill-opacity': ['match', ['get', 'state'], 'upcoming', 0.35, 'no_offers', 0.75, 0.9],
        },
      },
      under,
    );
    map.addLayer(
      {
        id: SALE_LAYERS.line,
        type: 'line',
        source: SOURCE,
        filter: ['!=', ['get', 'state'], 'upcoming'],
        paint: {
          'line-color': '#f8f6f0',
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.2, 12, 0.8],
          'line-opacity': 0.7,
        },
      },
      under,
    );
    map.addLayer(
      {
        id: SALE_LAYERS.upcoming,
        type: 'line',
        source: SOURCE,
        filter: ['==', ['get', 'state'], 'upcoming'],
        paint: {
          'line-color': SALE_UPCOMING,
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1, 12, 1.8],
          'line-dasharray': [2, 1.5],
        },
      },
      under,
    );
    map.addLayer(
      {
        id: SALE_LAYERS.picked,
        type: 'line',
        source: SOURCE,
        layout: { 'line-join': 'round' },
        paint: { 'line-width': 2.5 },
      },
      under,
    );
  }
  map.setPaintProperty(SALE_LAYERS.picked, 'line-color', tone === 'light' ? '#1c1917' : '#fafaf9');
  map.setFilter(SALE_LAYERS.picked, ['in', ['get', 'key'], ['literal', [...view.picked]]]);
}
