import type { ExpressionSpecification, GeoJSONSource, Map as MapboxMap } from 'mapbox-gl';

import { ST37_LAYERS } from './st37Map';

/**
 * Land held today on the oil and gas map (F-241): Crown petroleum and natural gas and oil sands
 * agreements, active offset notices and land whose petroleum and natural gas is not the
 * Crown's, drawn under the wells. Data from Alberta Energy and Minerals, Government of Alberta
 * (docs/DECISIONS.md, 2026-11-21).
 */

/** A GeoJSON MultiPolygon's coordinates. */
export type LandShape = number[][][][];

export interface LandMapAgreement {
  id: string;
  rights: 'png' | 'oil_sands';
  agreementType: string;
  agreementNumber: string;
  tract: string | null;
  group: string | null;
  status: string | null;
  vintage: string | null;
  holder: string | null;
  parties: string | null;
  zone: string | null;
  areaHa: number | null;
  termDate: string | null;
  continuationDate: string | null;
  expiryText: string | null;
  shape: LandShape;
}

export interface LandMapOffset {
  id: string;
  offsetType: string | null;
  offsetNumber: string;
  tract: string | null;
  holder: string | null;
  expiryDate: string | null;
  zone: string | null;
  shape: LandShape;
}

export interface LandMapFreehold {
  id: string;
  substances: string | null;
  nationalPark: string | null;
  reserveNumber: string | null;
  reserveName: string | null;
  shape: LandShape;
}

/** What the map colours land by, in the legend's order. */
export const LAND_CLASSES = ['png', 'oil_sands', 'offset', 'freehold'] as const;
export type LandClass = (typeof LAND_CLASSES)[number];

export const LAND_LABELS: Record<LandClass, string> = {
  png: 'Petroleum and natural gas agreements',
  oil_sands: 'Oil sands agreements',
  offset: 'Offset notices',
  freehold: 'Not the Crown’s (freehold, parks, reserves)',
};

/** Quiet colours that sit under the wells: one a class, told apart without the legend open. */
export const LAND_COLOURS: Record<'light' | 'dark', Record<LandClass, string>> = {
  light: { png: '#0f766e', oil_sands: '#b45309', offset: '#be123c', freehold: '#6d5fa8' },
  dark: { png: '#5eead4', oil_sands: '#fbbf24', offset: '#fda4af', freehold: '#c4b5fd' },
};

/** One shape on the map: `${class}:${id}`, as a click reports it. */
export const landKey = (of: LandClass, id: string) => `${of}:${id}`;

const SOURCE = 'land-held';
export const LAND_LAYERS = {
  freeholdFill: 'land-freehold-fill',
  freeholdLine: 'land-freehold-line',
  agreementFill: 'land-agreement-fill',
  agreementLine: 'land-agreement-line',
  offsetFill: 'land-offset-fill',
  offsetLine: 'land-offset-line',
  picked: 'land-picked',
} as const;
/** The layers a click can find land on. */
export const LAND_PICKABLE = [
  LAND_LAYERS.agreementFill,
  LAND_LAYERS.offsetFill,
  LAND_LAYERS.freeholdFill,
];

export interface LandView {
  land: GeoJSON.FeatureCollection;
  /** The keys of the shapes whose card is open, outlined bold. */
  picked: readonly string[];
}

/** The land as map features: each carries its class and its key. */
export function landFeatures(land: {
  agreements: readonly LandMapAgreement[];
  offsets: readonly LandMapOffset[];
  freehold: readonly LandMapFreehold[];
}): GeoJSON.FeatureCollection {
  const feature = (of: LandClass, id: string, shape: LandShape): GeoJSON.Feature => ({
    type: 'Feature',
    geometry: { type: 'MultiPolygon', coordinates: shape },
    properties: { class: of, key: landKey(of, id) },
  });
  return {
    type: 'FeatureCollection',
    features: [
      ...land.freehold.map((f) => feature('freehold', f.id, f.shape)),
      ...land.agreements.map((a) => feature(a.rights, a.id, a.shape)),
      ...land.offsets.map((o) => feature('offset', o.id, o.shape)),
    ],
  };
}

const isClass = (...classes: LandClass[]): ExpressionSpecification => [
  'match',
  ['get', 'class'],
  classes,
  true,
  false,
];

/**
 * Brings the map in line with the land: adds its source and layers the first time (under the
 * wells when they are drawn, else under `beforeId`, the pins), updates the data and colours
 * after; removes them all when `view` is null.
 */
export function syncLand(
  map: MapboxMap,
  view: LandView | null,
  tone: 'light' | 'dark',
  beforeId?: string,
) {
  if (view === null) {
    for (const id of Object.values(LAND_LAYERS)) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    return;
  }
  const existing = map.getSource<GeoJSONSource>(SOURCE);
  if (existing) existing.setData(view.land);
  else map.addSource(SOURCE, { type: 'geojson', data: view.land });

  if (!map.getLayer(LAND_LAYERS.agreementFill)) {
    // Under the wells' lowest layer when they are on the map, so a well is never covered.
    const under =
      [ST37_LAYERS.outlineFill, ST37_LAYERS.zones, ST37_LAYERS.density].find((id) =>
        map.getLayer(id),
      ) ?? (beforeId && map.getLayer(beforeId) ? beforeId : undefined);
    const width: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 9, 0.4, 13, 1.2];
    const add = (
      fill: string,
      line: string,
      classes: LandClass[],
      opacity: number,
      dashed = false,
    ) => {
      map.addLayer(
        {
          id: fill,
          type: 'fill',
          source: SOURCE,
          filter: isClass(...classes),
          // Agreements for different zones lie over one another: the fill deepens with each.
          paint: { 'fill-opacity': opacity },
        },
        under,
      );
      map.addLayer(
        {
          id: line,
          type: 'line',
          source: SOURCE,
          filter: isClass(...classes),
          layout: { 'line-join': 'round' },
          paint: {
            'line-width': width,
            'line-opacity': 0.7,
            ...(dashed && { 'line-dasharray': [3, 2] }),
          },
        },
        under,
      );
    };
    add(LAND_LAYERS.freeholdFill, LAND_LAYERS.freeholdLine, ['freehold'], 0.12);
    add(LAND_LAYERS.agreementFill, LAND_LAYERS.agreementLine, ['png', 'oil_sands'], 0.14);
    add(LAND_LAYERS.offsetFill, LAND_LAYERS.offsetLine, ['offset'], 0.1, true);
    map.addLayer(
      {
        id: LAND_LAYERS.picked,
        type: 'line',
        source: SOURCE,
        layout: { 'line-join': 'round' },
        paint: { 'line-width': 2.5 },
      },
      under,
    );
  }
  const colours = LAND_COLOURS[tone];
  const colour: ExpressionSpecification = [
    'match',
    ['get', 'class'],
    'png',
    colours.png,
    'oil_sands',
    colours.oil_sands,
    'offset',
    colours.offset,
    colours.freehold,
  ];
  for (const id of [LAND_LAYERS.freeholdFill, LAND_LAYERS.agreementFill, LAND_LAYERS.offsetFill]) {
    map.setPaintProperty(id, 'fill-color', colour);
  }
  for (const id of [LAND_LAYERS.freeholdLine, LAND_LAYERS.agreementLine, LAND_LAYERS.offsetLine]) {
    map.setPaintProperty(id, 'line-color', colour);
  }
  map.setPaintProperty(LAND_LAYERS.picked, 'line-color', tone === 'light' ? '#1c1917' : '#fafaf9');
  map.setFilter(LAND_LAYERS.picked, ['in', ['get', 'key'], ['literal', [...view.picked]]]);
}
