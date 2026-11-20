import type { MapFacility } from './api';
import { cssColourToHex } from './colour';
import { countryName, facilityTypeLabel, typeLabel } from './directory';
import type { Theme } from './theme';

// Mapbox settings for the map pages (docs/DECISIONS.md, 2026-10-27 map decisions). Every
// Mapbox call lives in components/FacilityMap.tsx; this file holds what can be tested
// without a browser map.

export type MapboxToken =
  { status: 'ok'; token: string } | { status: 'missing' } | { status: 'invalid' };

/**
 * The Mapbox token built into the web app (VITE_MAPBOX_TOKEN). Only a public token (pk.)
 * is used; Mapbox restricts it to the app's addresses. The build refuses a secret token.
 */
export function mapboxToken(value = import.meta.env.VITE_MAPBOX_TOKEN): MapboxToken {
  const token = value?.trim() ?? '';
  if (token === '') return { status: 'missing' };
  return /^pk\.[A-Za-z0-9._-]+$/.test(token) ? { status: 'ok', token } : { status: 'invalid' };
}

/**
 * "Map" is Mapbox's light or dark style, repainted with the theme's map colours (white land
 * on grey water, or slate); "Satellite" is the same imagery in both themes.
 */
export const BASEMAPS = {
  map: {
    label: 'Map',
    style: {
      light: 'mapbox://styles/mapbox/light-v11',
      dark: 'mapbox://styles/mapbox/dark-v11',
    },
  },
  satellite: {
    label: 'Satellite',
    style: {
      light: 'mapbox://styles/mapbox/satellite-streets-v12',
      dark: 'mapbox://styles/mapbox/satellite-streets-v12',
    },
  },
} as const;

export type Basemap = keyof typeof BASEMAPS;

export function basemapStyle(basemap: Basemap, theme: Theme): string {
  return BASEMAPS[basemap].style[theme];
}

/** Map colours as hex, which Mapbox can read; from the design tokens (themes.css). */
export interface MapColours {
  land: string;
  water: string;
  border: string;
  road: string;
  label: string;
  labelHalo: string;
  bid: string;
  offer: string;
  /** Counterparties that both buy and sell, or neither (brokers, carriers). */
  mixed: string;
  /** Inside an approximate (hollow) pin. */
  hollow: string;
  /** The ring around the chosen pin. */
  selected: string;
}

const TOKENS: Record<keyof MapColours, string> = {
  land: '--map-land',
  water: '--map-water',
  border: '--map-border',
  road: '--map-road',
  label: '--map-label',
  labelHalo: '--map-label-halo',
  bid: '--bid',
  offer: '--offer',
  mixed: '--info',
  hollow: '--background',
  selected: '--foreground',
};

/** Used only if a token cannot be read (the light theme's values). */
const FALLBACK: MapColours = {
  land: '#ffffff',
  water: '#e5e5e5',
  border: '#d4d4d4',
  road: '#f5f5f5',
  label: '#525252',
  labelHalo: '#ffffff',
  bid: '#008236',
  offer: '#c10007',
  mixed: '#155dfc',
  hollow: '#ffffff',
  selected: '#0a0a0a',
};

/** The current theme's map colours, read from the tokens on <html>. */
export function readMapColours(element: Element = document.documentElement): MapColours {
  const style = getComputedStyle(element);
  const colours = { ...FALLBACK };
  for (const [key, token] of Object.entries(TOKENS) as [keyof MapColours, string][]) {
    colours[key] = cssColourToHex(style.getPropertyValue(token)) ?? FALLBACK[key];
  }
  return colours;
}

/**
 * The oil and gas map's light look (the owner, 2026-11-20): warm off-white land, pale
 * blue-grey water, quiet borders and roads, so wells and outlines stand out. The night theme
 * keeps its slate.
 */
export const PAPER_MAP: Pick<
  MapColours,
  'land' | 'water' | 'border' | 'road' | 'label' | 'labelHalo'
> = {
  land: '#f2f0e8',
  water: '#d3dde2',
  border: '#b9b5a8',
  road: '#e6e3d8',
  label: '#6b6a62',
  labelHalo: '#f2f0e8',
};

/** The theme's map colours, with the paper look's base map on a light map that asks for it. */
export function withPaper(colours: MapColours, paper: boolean, theme: Theme): MapColours {
  return paper && theme === 'light' ? { ...colours, ...PAPER_MAP } : colours;
}

export interface StyleLayer {
  id: string;
  type: string;
}

/**
 * Which paint properties to set on one layer of Mapbox's light or dark style so it takes the
 * theme's colours. Layers are matched by Mapbox's usual ids; anything else keeps Mapbox's look.
 */
export function mapPaint(layer: StyleLayer, colours: MapColours): [string, string][] {
  const { id, type } = layer;
  if (type === 'background') return [['background-color', colours.land]];
  if (type === 'fill') {
    if (id.includes('water')) return [['fill-color', colours.water]];
    if (/^(land|landcover|landuse|national-park)/.test(id)) return [['fill-color', colours.land]];
    return [];
  }
  if (type === 'line') {
    if (id.includes('waterway')) return [['line-color', colours.water]];
    if (id.startsWith('admin')) return [['line-color', colours.border]];
    if (/^(road|bridge|tunnel)/.test(id)) return [['line-color', colours.road]];
    return [];
  }
  if (type === 'symbol') {
    return [
      ['text-color', colours.label],
      ['text-halo-color', colours.labelHalo],
    ];
  }
  return [];
}

/**
 * Whether a layer is left out of a simple map (a counterparty's page, owner's request of
 * 2026-10-30): road names and highway numbers, points of interest, transit and airport
 * labels, and house numbers. Towns, water and borders stay, so the map still says where it is.
 */
export function isClutterLayer(layer: Pick<StyleLayer, 'id' | 'type'>): boolean {
  return (
    layer.type === 'symbol' &&
    // Whole words of the layer's id, so "natural-point-label" is not taken for a "poi".
    /(^|-)(road|shield|street|motorway|highway|path|poi|transit|airport|aerialway|ferry|housenum|building)(-|$)/.test(
      layer.id,
    )
  );
}

/** A buyer's (bid), a seller's (offer), or one that is both or neither (mixed). */
export type PinTone = 'bid' | 'offer' | 'mixed';

/** The symbol inside a pin: a company's main type (F-101). */
export type PinKind = 'buyer' | 'seller' | 'carrier' | 'broker';

/** What the box on the map says about a chosen pin (F-101): never prices or contacts. */
export interface PinDetails {
  title: string;
  /** The company's page, when there is one. */
  href?: string;
  /** Its type, then where it is and how exact. */
  lines: readonly string[];
}

/** One pin: where it is, whose it is (its tone), what it is (its kind), filled or hollow. */
export interface MapPin {
  id: string;
  latitude: number;
  longitude: number;
  tone: PinTone;
  kind: PinKind;
  /** Shown beside the pin when the map is zoomed in close. */
  name: string;
  /** Approximate locations are hollow, exact ones filled (specification section 6). */
  hollow: boolean;
  /** For the box on the map when the pin is chosen. */
  details?: PinDetails;
}

export interface PinFeatureCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: { id: string; tone: PinTone; kind: PinKind; name: string; hollow: boolean };
  }[];
}

/** Map pins as GeoJSON, carrying only an id, tone, kind, name and fill: no prices. */
export function pinFeatures(pins: readonly MapPin[]): PinFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: pins.map((pin) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [pin.longitude, pin.latitude] },
      properties: {
        id: pin.id,
        tone: pin.tone,
        kind: pin.kind,
        name: pin.name,
        hollow: pin.hollow,
      },
    })),
  };
}

/** Whose a directory location is: a buyer's, a seller's, or one that is both or neither. */
export function counterpartyTone(types: readonly string[]): PinTone {
  const buyer = types.includes('buyer');
  const seller = types.includes('seller');
  if (buyer && !seller) return 'bid';
  if (seller && !buyer) return 'offer';
  return 'mixed';
}

/**
 * The symbol of a company's main type (F-101, the owner's answer 3): buyer, then seller,
 * then broker, then carrier. A company of no known type is drawn as a broker's (two arrows).
 */
export function mainKind(types: readonly string[]): PinKind {
  for (const kind of ['buyer', 'seller', 'broker', 'carrier'] as const) {
    if (types.includes(kind)) return kind;
  }
  return 'broker';
}

/** A directory location as a pin: buyers in the bid colour, sellers in the offer colour. */
export function facilityPin(facility: MapFacility): MapPin {
  const place = [facility.city, facility.region, countryName(facility.country)]
    .filter((part) => part !== null && part !== '')
    .join(', ');
  const where = facility.name ?? facilityTypeLabel(facility.facilityType) ?? 'Location';
  return {
    id: facility.id,
    latitude: Number(facility.latitude),
    longitude: Number(facility.longitude),
    tone: counterpartyTone(facility.counterpartyTypes),
    kind: mainKind(facility.counterpartyTypes),
    name: facility.tradingName ?? facility.legalName,
    hollow: facility.locationPrecision === 'approximate',
    details: {
      title: facility.legalName,
      href: `/counterparties/${facility.counterpartyId}`,
      lines: [
        `${facility.counterpartyTypes.map(typeLabel).join(', ')} · ${where}`,
        place,
        facility.locationPrecision === 'exact'
          ? 'Exact location'
          : 'Approximate location (e.g. the town)',
      ].filter((line) => line !== ''),
    },
  };
}

/** A map area as [west, south, east, north] in degrees. */
export type MapBounds = [number, number, number, number];

/**
 * The smallest area holding every pin, for a map that starts on them; null when there are
 * none. One pin (or several at the same spot) gives a point, which the map shows at its
 * closest starting zoom.
 */
export function pinBounds(
  pins: readonly Pick<MapPin, 'latitude' | 'longitude'>[],
): MapBounds | null {
  if (pins.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const { latitude, longitude } of pins) {
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  }
  return [west, south, east, north];
}
