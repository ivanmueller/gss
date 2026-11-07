import { z } from 'zod';

import { websiteProblem, writtenAddressProblem, type WebAddress } from './website';

// Map layers from ArcGIS, the Government of Canada and files (the owner's request and answers
// of 2026-11-07, docs/DECISIONS.md, F-107). Shared by the API and the web app: which web
// addresses are taken and as what, the checks a file passes before it is kept, the colours a
// layer is drawn in, and the map squares ("tiles") a live layer is fetched by. The database
// keeps layers in 20261107040000_map_layers.sql.

declare const URL: new (input: string) => WebAddress & { searchParams: URLSearchParamsLike };
interface URLSearchParamsLike {
  get(name: string): string | null;
  forEach(callback: (value: string, key: string) => void): void;
}

export const MAP_LAYER_KINDS = ['arcgis_features', 'arcgis_image', 'wms', 'file'] as const;
export type MapLayerKind = (typeof MAP_LAYER_KINDS)[number];

export const MAP_LAYER_KIND_LABELS: Record<MapLayerKind, string> = {
  arcgis_features: 'ArcGIS layer (lines, areas or points)',
  arcgis_image: 'ArcGIS map (pictures)',
  wms: 'WMS map (pictures)',
  file: 'File',
};

/** The largest file kept, as GeoJSON text after its checks (the database has the same limit). */
export const MAX_LAYER_FILE_BYTES = 5 * 1024 * 1024;
/** The most features a file may hold. */
export const MAX_LAYER_FEATURES = 50_000;
/** The most values coloured one by one; others take the layer's own colour. */
export const MAX_LAYER_COLOURS = 2_000;
/** The most fields kept for each feature of a file, shown when it is clicked. */
export const MAX_FEATURE_FIELDS = 40;
/** The longest text kept in one field of a file. */
export const MAX_FIELD_TEXT = 500;
/** The longest web address kept. */
export const MAX_LAYER_URL_LENGTH = 2000;

// ---------------------------------------------------------------------------------------------
// Web addresses

export type LayerSourceResult =
  | {
      ok: true;
      kind: Exclude<MapLayerKind, 'file'>;
      /** The address kept: https, without its query, without a trailing slash. */
      url: string;
      /** For WMS: the layer names found in the address as pasted (its LAYERS), if any. */
      wmsLayers: string | null;
    }
  | { ok: false; message: string };

const NOT_A_SERVICE =
  'Paste the address of an ArcGIS layer (it ends in /FeatureServer, /MapServer or /ImageServer, often followed by a number) or of a WMS map service.';

/**
 * A layer's web address as pasted, tidied and recognized: an ArcGIS FeatureServer or MapServer
 * layer (…/FeatureServer/0, …/MapServer/3) is drawn as lines, areas or points; a whole
 * FeatureServer is taken as its first layer; a whole MapServer or an ImageServer is drawn as
 * pictures; an address asking for WMS (SERVICE=WMS, or ending in /wms or /ows) is drawn as
 * pictures of the layers it names. Only public https addresses by name are taken.
 */
export function parseLayerSource(text: string): LayerSourceResult {
  const value = text.trim();
  if (value === '') return { ok: false, message: 'Paste the layer’s web address.' };
  if (!/^https:\/\//i.test(value)) {
    return { ok: false, message: 'The address must start with https://' };
  }
  const written = writtenAddressProblem(value);
  if (written !== null) return { ok: false, message: `The address ${written}.` };
  let url: WebAddress & { searchParams: URLSearchParamsLike };
  try {
    url = new URL(value);
  } catch {
    return { ok: false, message: 'This is not a web address.' };
  }
  const problem = websiteProblem(url);
  if (problem !== null) return { ok: false, message: `The address ${problem}.` };
  const params = new Map<string, string>();
  url.searchParams.forEach((v, k) => params.set(k.toLowerCase(), v));
  const path = url.pathname.replace(/\/+$/, '');
  if (/[\s?#]/.test(path)) return { ok: false, message: NOT_A_SERVICE };
  const base = `https://${url.hostname}${path}`;
  const found = (
    kind: Exclude<MapLayerKind, 'file'>,
    address: string,
    wms: string | null = null,
  ) =>
    address.length > MAX_LAYER_URL_LENGTH
      ? ({ ok: false, message: 'The address is too long.' } as const)
      : ({ ok: true, kind, url: address, wmsLayers: wms } as const);

  if (/\/(FeatureServer|MapServer)\/\d+$/i.test(path)) return found('arcgis_features', base);
  if (/\/FeatureServer$/i.test(path)) return found('arcgis_features', `${base}/0`);
  if (/\/(MapServer|ImageServer)$/i.test(path)) return found('arcgis_image', base);
  if (params.get('service')?.toUpperCase() === 'WMS' || /\/(wms|ows)$/i.test(path)) {
    const layers = params.get('layers') ?? null;
    return found('wms', base, layers && WMS_LAYERS.test(layers) ? layers : null);
  }
  return { ok: false, message: NOT_A_SERVICE };
}

/** WMS layer names: letters, digits and _ . : - / and spaces, comma separated. */
export const WMS_LAYERS = /^[A-Za-z0-9_.:,/ -]{1,500}$/;

// ---------------------------------------------------------------------------------------------
// Colours

/**
 * Colours that stay apart from each other on a light or dark map, most distinct first: the
 * most common values (the big railroads) get these.
 */
export const LAYER_PALETTE = [
  '#e6194b',
  '#3cb44b',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#42d4f4',
  '#f032e6',
  '#bfef45',
  '#9a6324',
  '#469990',
  '#800000',
  '#808000',
  '#000075',
  '#ffe119',
  '#dcbeff',
  '#aaffc3',
  '#fabed4',
  '#ffd8b1',
  '#a9a9a9',
  '#e6beff',
] as const;

/** The colour a layer takes by default, before an admin chooses another. */
export const DEFAULT_LAYER_COLOUR = '#2f6baa';

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/**
 * `count` colours, each different from all the others: the palette first, then hues spread by
 * the golden angle at three lightnesses, so neighbours in the list are far apart.
 */
export function distinctColours(count: number): string[] {
  const colours: string[] = [];
  const seen = new Set<string>();
  for (const colour of LAYER_PALETTE) {
    if (colours.length >= count) return colours;
    colours.push(colour);
    seen.add(colour);
  }
  const lightness = [0.45, 0.62, 0.32];
  for (let i = 0; colours.length < count; i += 1) {
    const hue = (i * 137.508) % 360;
    const l = lightness[i % lightness.length] ?? 0.45;
    const s = i % 2 === 0 ? 0.7 : 0.55;
    let colour = hslToHex(hue, s, l);
    // Rounding can make two the same; nudge until it is new.
    for (let nudge = 1; seen.has(colour); nudge += 1) colour = hslToHex(hue + nudge, s, l);
    seen.add(colour);
    colours.push(colour);
  }
  return colours;
}

export interface ValueCount {
  value: string;
  count: number;
}

/**
 * A colour for each value, the most common value first (ties by value), each colour different;
 * at most MAX_LAYER_COLOURS values, the rarest left out (they take the layer's colour).
 */
export function assignColours(values: readonly ValueCount[]): [string, string][] {
  const sorted = [...values]
    .filter((v) => v.value !== '')
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, MAX_LAYER_COLOURS);
  const colours = distinctColours(sorted.length);
  return sorted.map((v, i) => [v.value, colours[i] ?? DEFAULT_LAYER_COLOUR]);
}

// ---------------------------------------------------------------------------------------------
// Requests

const HEX = /^#[0-9a-f]{6}$/;
const FIELD = /^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,63}$/;
const label = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !/\p{Cc}/u.test(v), 'must not contain control characters');

const colourList = z
  .array(z.tuple([z.string().max(MAX_FIELD_TEXT), z.string().regex(HEX)]))
  .max(MAX_LAYER_COLOURS)
  .refine((pairs) => new Set(pairs.map(([v]) => v)).size === pairs.length, 'values repeat');

const layerDetails = {
  name: label(200),
  sourceName: label(200),
  /** A link to the source's terms of use (http or https). */
  termsUrl: z
    .string()
    .trim()
    .max(MAX_LAYER_URL_LENGTH)
    .regex(/^https?:\/\/[a-z0-9.-]+\.[a-z]{2,63}(\/\S*)?$/i, 'must be a web address'),
  /** What the terms allow, in a few words. */
  termsNote: label(2000),
  colour: z.string().regex(HEX),
  colourField: z.string().regex(FIELD).nullable(),
  colours: colourList,
};

/** POST /api/v1/map-layers?organization_id=… : a web service. */
export const createServiceLayerSchema = z.strictObject({
  ...layerDetails,
  source: z.literal('web'),
  url: z.string().max(MAX_LAYER_URL_LENGTH * 2),
  wmsLayers: z.string().regex(WMS_LAYERS).nullable(),
});

/** POST /api/v1/map-layers?organization_id=… : a file, already turned into GeoJSON. */
export const createFileLayerSchema = z.strictObject({
  ...layerDetails,
  source: z.literal('file'),
  fileName: label(200),
  /** A GeoJSON FeatureCollection; checked again by normalizeFeatureCollection. */
  geojson: z.unknown(),
});

export const createMapLayerSchema = z.discriminatedUnion('source', [
  createServiceLayerSchema,
  createFileLayerSchema,
]);
export type CreateMapLayer = z.infer<typeof createMapLayerSchema>;

/** PATCH /api/v1/map-layers/{id}: its name, source, terms and colours. */
export const updateMapLayerSchema = z.strictObject({
  version: z.string().min(1).max(100),
  ...layerDetails,
  wmsLayers: z.string().regex(WMS_LAYERS).nullable(),
});
export type UpdateMapLayer = z.infer<typeof updateMapLayerSchema>;

/** POST /api/v1/map-layers/inspect?organization_id=…: what a web address offers. */
export const inspectLayerSchema = z.strictObject({
  url: z.string().max(MAX_LAYER_URL_LENGTH * 2),
  /** Count this field's values, to colour by it. */
  field: z.string().regex(FIELD).nullable(),
});

// ---------------------------------------------------------------------------------------------
// Answers

/** A layer as the list gives it (GET /api/v1/map-layers). */
export interface MapLayerView {
  id: string;
  name: string;
  kind: MapLayerKind;
  /** A web service's address; null for a file. */
  url: string | null;
  wmsLayers: string | null;
  sourceName: string;
  termsUrl: string;
  termsNote: string;
  colour: string;
  colourField: string | null;
  colours: [string, string][];
  /** A file's name and number of features; null for a web service. */
  fileName: string | null;
  featureCount: number | null;
  createdByName: string;
  /** UTC instant. */
  createdAt: string;
  /** Sent back with a change; a change to a layer changed since is refused. */
  version: string;
}

export interface MapLayerList {
  layers: MapLayerView[];
}

/** What a web address offers (POST /api/v1/map-layers/inspect). */
export interface LayerInspection {
  kind: Exclude<MapLayerKind, 'file'>;
  url: string;
  wmsLayers: string | null;
  /** The service's own name for it, if it gives one. */
  title: string | null;
  /** Its copyright or terms text, as the service states it (to read, not to trust blindly). */
  copyright: string | null;
  /** Fields whose values can colour it (text and whole numbers); empty for pictures. */
  fields: string[];
  /** The field's values and how often each occurs, most common first, when one was asked for. */
  values: ValueCount[] | null;
}

// ---------------------------------------------------------------------------------------------
// Files

export type FieldValue = string | number | boolean | null;

export interface LayerFeature {
  type: 'Feature';
  id: number;
  geometry: { type: GeometryType; coordinates: unknown };
  properties: Record<string, FieldValue>;
}

export interface LayerFeatureCollection {
  type: 'FeatureCollection';
  features: LayerFeature[];
}

const GEOMETRY_TYPES = [
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
] as const;
type GeometryType = (typeof GEOMETRY_TYPES)[number];
const DEPTH: Record<GeometryType, number> = {
  Point: 0,
  MultiPoint: 1,
  LineString: 1,
  MultiLineString: 2,
  Polygon: 2,
  MultiPolygon: 3,
};

/** The coordinates rounded to 6 places (about 10 cm), or why they cannot be kept. */
function cleanCoordinates(value: unknown, depth: number): unknown {
  if (!Array.isArray(value)) return 'bad';
  if (depth === 0) {
    const [lon, lat] = value as unknown[];
    if (typeof lon !== 'number' || typeof lat !== 'number') return 'bad';
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return 'bad';
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return 'outside';
    return [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
  }
  if (value.length === 0) return 'bad';
  const out: unknown[] = [];
  for (const part of value) {
    const cleaned = cleanCoordinates(part, depth - 1);
    if (cleaned === 'bad' || cleaned === 'outside') return cleaned;
    out.push(cleaned);
  }
  return out;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanProperties(value: unknown): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  const props = record(value);
  if (!props) return out;
  let kept = 0;
  for (const [key, raw] of Object.entries(props)) {
    if (kept >= MAX_FEATURE_FIELDS) break;
    const name = key.trim();
    if (name === '' || name.length > 64 || /\p{Cc}/u.test(name) || name === '__proto__') continue;
    let v: FieldValue;
    if (raw === null || typeof raw === 'boolean') v = raw;
    else if (typeof raw === 'number') v = Number.isFinite(raw) ? raw : null;
    else if (typeof raw === 'string') v = raw.replace(/\p{Cc}/gu, ' ').slice(0, MAX_FIELD_TEXT);
    else continue;
    out[name] = v;
    kept += 1;
  }
  return out;
}

export type FeatureCollectionResult =
  | { ok: true; collection: LayerFeatureCollection; skipped: number }
  | { ok: false; message: string };

/**
 * A file's GeoJSON, checked and tidied before it is kept: a FeatureCollection (or one Feature)
 * of points, lines and areas in longitude and latitude, up to MAX_LAYER_FEATURES; coordinates
 * rounded to 6 places; up to MAX_FEATURE_FIELDS plain fields per feature, text cut at
 * MAX_FIELD_TEXT; each feature numbered. Features without a usable shape are left out and
 * counted; a file whose shapes are not in longitude and latitude is refused.
 */
export function normalizeFeatureCollection(value: unknown): FeatureCollectionResult {
  const root = record(value);
  const raw =
    root?.type === 'FeatureCollection' && Array.isArray(root.features)
      ? (root.features as unknown[])
      : root?.type === 'Feature'
        ? [root]
        : null;
  if (raw === null) {
    return { ok: false, message: 'This file is not GeoJSON (a FeatureCollection).' };
  }
  if (raw.length > MAX_LAYER_FEATURES) {
    return {
      ok: false,
      message: `This file has ${String(raw.length)} shapes; at most ${String(MAX_LAYER_FEATURES)} are taken. Add a big national dataset by its web address instead.`,
    };
  }
  const features: LayerFeature[] = [];
  let skipped = 0;
  let outside = 0;
  for (const item of raw) {
    const feature = record(item);
    const geometry = record(feature?.geometry);
    const type = geometry?.type;
    if (!feature || !geometry || !GEOMETRY_TYPES.includes(type as GeometryType)) {
      skipped += 1;
      continue;
    }
    const geometryType = type as GeometryType;
    const coordinates = cleanCoordinates(geometry.coordinates, DEPTH[geometryType]);
    if (coordinates === 'outside') outside += 1;
    if (coordinates === 'bad' || coordinates === 'outside') {
      skipped += 1;
      continue;
    }
    features.push({
      type: 'Feature',
      id: features.length + 1,
      geometry: { type: geometryType, coordinates },
      properties: cleanProperties(feature.properties),
    });
  }
  if (features.length === 0) {
    return {
      ok: false,
      message:
        outside > 0
          ? 'This file’s shapes are not in longitude and latitude. Export it as GeoJSON or KML in WGS 84 (EPSG:4326), or as a zipped shapefile with its .prj file.'
          : 'This file has no points, lines or areas.',
    };
  }
  return { ok: true, collection: { type: 'FeatureCollection', features }, skipped };
}

/** The fields of a file's features that can colour it, most often filled first. */
export function featureFields(collection: LayerFeatureCollection): string[] {
  const counts = new Map<string, number>();
  for (const feature of collection.features) {
    for (const [key, value] of Object.entries(feature.properties)) {
      if (typeof value === 'string' || typeof value === 'number') {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return [...counts]
    .filter(([key]) => FIELD.test(key))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key);
}

/** How often each value of a field occurs in a file, most common first. */
export function featureValueCounts(
  collection: LayerFeatureCollection,
  field: string,
): ValueCount[] {
  const counts = new Map<string, number>();
  for (const feature of collection.features) {
    const value = feature.properties[field];
    if (value === null || value === undefined || typeof value === 'boolean') continue;
    const text = String(value);
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** A colour given by the file itself (KML styles, or GeoJSON's stroke, fill and marker-color). */
export const FILE_COLOUR_FIELDS = ['stroke', 'fill', 'marker-color'] as const;

// ---------------------------------------------------------------------------------------------
// Map squares

/** A square of the map at a zoom, as on web maps (x from the west, y from the north). */
export interface Tile {
  z: number;
  x: number;
  y: number;
}

/** The lowest and highest zoom a live layer is fetched at. */
export const MIN_TILE_ZOOM = 2;
export const MAX_TILE_ZOOM = 14;
/** The most squares fetched for one view; a wider view uses fewer, bigger squares. */
export const MAX_TILES_PER_VIEW = 24;

function lonToX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

function latToY(lat: number, z: number): number {
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  const rad = (clamped * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
}

/** A square's bounds in degrees. */
export function tileBounds(tile: Tile): {
  west: number;
  south: number;
  east: number;
  north: number;
} {
  const n = 2 ** tile.z;
  const lat = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return {
    west: (tile.x / n) * 360 - 180,
    east: ((tile.x + 1) / n) * 360 - 180,
    north: lat(tile.y),
    south: lat(tile.y + 1),
  };
}

/** A square's bounds in web Mercator metres (EPSG:3857), for pictures. */
export function tileBoundsMercator(tile: Tile): [number, number, number, number] {
  const size = (2 * Math.PI * 6378137) / 2 ** tile.z;
  const origin = Math.PI * 6378137;
  const west = tile.x * size - origin;
  const north = origin - tile.y * size;
  return [west, north - size, west + size, north];
}

export function isTile(tile: Tile): boolean {
  const { z, x, y } = tile;
  return (
    Number.isInteger(z) &&
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    z >= 0 &&
    z <= 22 &&
    x >= 0 &&
    y >= 0 &&
    x < 2 ** z &&
    y < 2 ** z
  );
}

/**
 * The squares covering a view at the map's zoom: the map's own zoom, made coarser until the
 * view needs at most MAX_TILES_PER_VIEW squares.
 */
export function tilesForView(
  bbox: { west: number; south: number; east: number; north: number },
  mapZoom: number,
): Tile[] {
  let z = Math.max(MIN_TILE_ZOOM, Math.min(MAX_TILE_ZOOM, Math.floor(mapZoom)));
  for (;;) {
    const west = Math.max(-180, bbox.west);
    const east = Math.min(180 - 1e-9, bbox.east);
    const x0 = lonToX(west, z);
    const x1 = lonToX(east, z);
    const y0 = latToY(bbox.north, z);
    const y1 = latToY(bbox.south, z);
    const count = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (count <= MAX_TILES_PER_VIEW || z <= 0) {
      const tiles: Tile[] = [];
      for (let x = x0; x <= x1; x += 1) {
        for (let y = y0; y <= y1; y += 1) {
          if (tiles.length < MAX_TILES_PER_VIEW) tiles.push({ z, x, y });
        }
      }
      return tiles;
    }
    z -= 1;
  }
}

/** How much a live layer's lines may be simplified at a zoom: about a pixel, in degrees. */
export function simplifyDegrees(z: number): number {
  return 360 / 2 ** z / 512;
}
