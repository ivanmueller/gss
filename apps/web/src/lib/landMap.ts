import type { ExpressionSpecification, GeoJSONSource, Map as MapboxMap } from 'mapbox-gl';

import { ST37_LAYERS } from './st37Map';

/**
 * Land held today on the oil and gas map (F-241): Crown petroleum and natural gas and oil sands
 * agreements coloured by who holds them, hatched when they expire within 12 months; active
 * offset notices outlined in orange; land whose petroleum and natural gas is not the Crown's
 * hatched. Drawn under the wells. Data from Alberta Energy and Minerals, Government of Alberta
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

/** How a shape is drawn. */
export type LandLook = 'agreement' | 'offset' | 'offset_passed' | 'freehold' | 'reserve';

/**
 * Soft colours for holders, told apart side by side under the wells. A holder always gets the
 * same one (from its name), so the map does not change colours as it moves; two holders can
 * share one.
 */
export const LAND_HOLDER_COLOURS = [
  '#b9c7a0',
  '#e08f98',
  '#8f9bbf',
  '#cdb89f',
  '#c7b2cc',
  '#a8b7c2',
  '#c6c794',
  '#dba7b3',
  '#9dbba6',
  '#b1a6cb',
  '#d6b58b',
  '#91b1b7',
] as const;
/** Agreements when they are not coloured by holder, and a holder with no name. */
export const LAND_PLAIN = '#b9c7a0';
export const LAND_OFFSET = '#e2622f';
export const LAND_FREEHOLD = '#c9a66b';
export const LAND_RESERVE = '#8a8f98';
const INK = '#44403c';

/** The colour of a holder: the same for the same name, whatever else is on the map. */
export function landHolderColour(holder: string | null): string {
  if (!holder) return LAND_PLAIN;
  let hash = 0;
  for (let i = 0; i < holder.length; i += 1) hash = (hash * 31 + holder.charCodeAt(i)) >>> 0;
  return LAND_HOLDER_COLOURS[hash % LAND_HOLDER_COLOURS.length] ?? LAND_PLAIN;
}

/** `2027/01/28` as `2027-01-28`; null for a word such as INDEFINITE. */
function expiryDate(text: string | null): string | null {
  const m = text ? /^(\d{4})[/-](\d{2})[/-](\d{2})$/.exec(text.trim()) : null;
  return m ? `${String(m[1])}-${String(m[2])}-${String(m[3])}` : null;
}

/**
 * Whether an agreement's expiry, as published, falls within 12 months after `today`
 * (YYYY-MM-DD). One already past, or with no date (INDEFINITE, MULTIPLE), does not.
 */
export function landExpiring(expiryText: string | null, today: string): boolean {
  const date = expiryDate(expiryText);
  if (!date || date < today) return false;
  const limit = `${String(Number(today.slice(0, 4)) + 1)}${today.slice(4)}`;
  return date <= limit;
}

/** One shape on the map: `${class}:${id}`, as a click reports it. */
export type LandClass = 'png' | 'oil_sands' | 'offset' | 'freehold';
export const landKey = (of: LandClass, id: string) => `${of}:${id}`;

const SOURCE = 'land-held';
export const LAND_LAYERS = {
  freeholdFill: 'land-freehold-fill',
  freeholdLine: 'land-freehold-line',
  agreementFill: 'land-agreement-fill',
  agreementLine: 'land-agreement-line',
  expiring: 'land-agreement-expiring',
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
const HATCH = {
  ink: 'land-hatch-ink',
  freehold: 'land-hatch-freehold',
  reserve: 'land-hatch-reserve',
};

export interface LandView {
  land: GeoJSON.FeatureCollection;
  /** The keys of the shapes whose card is open, outlined bold. */
  picked: readonly string[];
}

/**
 * The land as map features. Each carries its key, how it is drawn and, for an agreement, its
 * colour (its holder's when `byHolder`) and whether it expires within 12 months of `today`.
 */
export function landFeatures(
  land: {
    agreements: readonly LandMapAgreement[];
    offsets: readonly LandMapOffset[];
    freehold: readonly LandMapFreehold[];
  },
  { byHolder = true, today }: { byHolder?: boolean; today: string },
): GeoJSON.FeatureCollection {
  const feature = (
    key: string,
    look: LandLook,
    shape: LandShape,
    extra: Record<string, unknown> = {},
  ): GeoJSON.Feature => ({
    type: 'Feature',
    geometry: { type: 'MultiPolygon', coordinates: shape },
    properties: { key, look, ...extra },
  });
  return {
    type: 'FeatureCollection',
    features: [
      ...land.freehold.map((f) =>
        feature(
          landKey('freehold', f.id),
          f.nationalPark || f.reserveName || f.reserveNumber ? 'reserve' : 'freehold',
          f.shape,
        ),
      ),
      ...land.agreements.map((a) =>
        feature(landKey(a.rights, a.id), 'agreement', a.shape, {
          colour: byHolder ? landHolderColour(a.holder) : LAND_PLAIN,
          expiring: landExpiring(a.expiryText, today),
        }),
      ),
      ...land.offsets.map((o) =>
        feature(
          landKey('offset', o.id),
          o.expiryDate !== null && o.expiryDate < today ? 'offset_passed' : 'offset',
          o.shape,
        ),
      ),
    ],
  };
}

/** Thin diagonal lines on nothing, as a pattern that repeats, drawn without a canvas. */
function hatchImage(colour: string, alpha: number) {
  const size = 12;
  const data = new Uint8Array(size * size * 4);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // A line from bottom left to top right, two pixels thick, wrapping at the edges.
      const on = (x + y) % size < 2;
      const i = (y * size + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = on ? alpha : 0;
    }
  }
  return { width: size, height: size, data };
}

const looks = (...list: LandLook[]): ExpressionSpecification => [
  'match',
  ['get', 'look'],
  list,
  true,
  false,
];

/**
 * Brings the map in line with the land: adds its source and layers the first time (under the
 * wells when they are drawn, else under `beforeId`, the pins), updates the data after; removes
 * them all when `view` is null.
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

  for (const [id, colour, alpha] of [
    [HATCH.ink, INK, 150],
    [HATCH.freehold, LAND_FREEHOLD, 220],
    [HATCH.reserve, LAND_RESERVE, 200],
  ] as const) {
    if (!map.hasImage(id)) map.addImage(id, hatchImage(colour, alpha), { pixelRatio: 2 });
  }

  if (!map.getLayer(LAND_LAYERS.agreementFill)) {
    // Under the wells' lowest layer when they are on the map, so a well is never covered.
    const under =
      [ST37_LAYERS.outlineFill, ST37_LAYERS.zones, ST37_LAYERS.density].find((id) =>
        map.getLayer(id),
      ) ?? (beforeId && map.getLayer(beforeId) ? beforeId : undefined);
    const thin: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 7, 0.3, 12, 0.9];
    // Land that is not the Crown's: hatched, sand for freehold and grey for parks and reserves.
    map.addLayer(
      {
        id: LAND_LAYERS.freeholdFill,
        type: 'fill',
        source: SOURCE,
        filter: looks('freehold', 'reserve'),
        paint: {
          'fill-pattern': ['match', ['get', 'look'], 'reserve', HATCH.reserve, HATCH.freehold],
        },
      },
      under,
    );
    map.addLayer(
      {
        id: LAND_LAYERS.freeholdLine,
        type: 'line',
        source: SOURCE,
        filter: looks('freehold', 'reserve'),
        paint: {
          'line-color': ['match', ['get', 'look'], 'reserve', LAND_RESERVE, LAND_FREEHOLD],
          'line-width': thin,
          'line-opacity': 0.6,
        },
      },
      under,
    );
    // Crown agreements: each in its colour, a faint edge between tracts.
    map.addLayer(
      {
        id: LAND_LAYERS.agreementFill,
        type: 'fill',
        source: SOURCE,
        filter: looks('agreement'),
        paint: { 'fill-color': ['get', 'colour'], 'fill-opacity': 0.7 },
      },
      under,
    );
    map.addLayer(
      {
        id: LAND_LAYERS.agreementLine,
        type: 'line',
        source: SOURCE,
        filter: looks('agreement'),
        paint: { 'line-color': INK, 'line-width': thin, 'line-opacity': 0.28 },
      },
      under,
    );
    map.addLayer(
      {
        id: LAND_LAYERS.expiring,
        type: 'fill',
        source: SOURCE,
        filter: ['all', looks('agreement'), ['==', ['get', 'expiring'], true]],
        paint: { 'fill-pattern': HATCH.ink },
      },
      under,
    );
    // Offset notices: an orange edge, fainter once the deadline has passed.
    map.addLayer(
      {
        id: LAND_LAYERS.offsetFill,
        type: 'fill',
        source: SOURCE,
        filter: looks('offset', 'offset_passed'),
        paint: {
          'fill-color': LAND_OFFSET,
          'fill-opacity': ['match', ['get', 'look'], 'offset_passed', 0.1, 0.25],
        },
      },
      under,
    );
    map.addLayer(
      {
        id: LAND_LAYERS.offsetLine,
        type: 'line',
        source: SOURCE,
        filter: looks('offset', 'offset_passed'),
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': LAND_OFFSET,
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.2, 12, 2],
          'line-opacity': ['match', ['get', 'look'], 'offset_passed', 0.5, 1],
        },
      },
      under,
    );
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
  map.setPaintProperty(LAND_LAYERS.picked, 'line-color', tone === 'light' ? '#1c1917' : '#fafaf9');
  map.setFilter(LAND_LAYERS.picked, ['in', ['get', 'key'], ['literal', [...view.picked]]]);
}
