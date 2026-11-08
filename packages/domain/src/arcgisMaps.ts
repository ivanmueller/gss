import { z } from 'zod';

import {
  DEFAULT_LAYER_COLOUR,
  MAX_LAYER_COLOURS,
  MAX_LAYER_URL_LENGTH,
  OTHER_VALUES_COLOUR,
  cleanValue,
  parseLayerSource,
  safeFilter,
  type MapLayerKind,
} from './mapLayers';
import { websiteProblem, writtenAddressProblem, type WebAddress } from './website';

// Layers from an ArcGIS map, presented as ArcGIS presents them (the owner's request and answers
// of 2026-11-08, F-138). An admin pastes a map's link; the Worker reads the map's item from
// www.arcgis.com and passes it on; these functions, shared by the web app and the API, find the
// map's id in the link, list its layers bottom to top, and turn ArcGIS's drawing (its
// "renderer": colours, widths, see-through, zoom range) into a GSS layer's.

declare const URL: new (input: string) => WebAddress & { searchParams: SearchParamsLike };
interface SearchParamsLike {
  forEach(callback: (value: string, key: string) => void): void;
}

/** An ArcGIS item's id: 32 hexadecimal digits. */
export const ARCGIS_ITEM_ID = /^[0-9a-f]{32}$/;

/** POST /api/v1/map-layers/arcgis-item: an ArcGIS item's description ('info') or its data. */
export const arcgisItemSchema = z.strictObject({
  itemId: z.string().regex(ARCGIS_ITEM_ID),
  part: z.enum(['info', 'data']),
});

/** Where an ArcGIS item's page is: its terms of use and description are read there. */
export function arcgisItemPage(itemId: string): string {
  return `https://www.arcgis.com/home/item.html?id=${itemId}`;
}

export type MapLinkResult = { ok: true; itemId: string } | { ok: false; message: string };

const NOT_A_MAP =
  'Paste the link of an ArcGIS map, as its Share button or the address bar gives it (on arcgis.com, with webmap= or id= in it).';

/**
 * The map's id in a link as pasted: an ArcGIS Online map viewer (…/apps/mapviewer/index.html?
 * webmap=…), an item page (…/home/item.html?id=…), an app built on a map (…?appid=…, or
 * experience.arcgis.com/experience/…), or the id alone. Only arcgis.com addresses are taken; the
 * Worker reads the item from www.arcgis.com whatever the link's address.
 */
export function parseArcgisMapLink(text: string): MapLinkResult {
  const value = text.trim();
  if (value === '') return { ok: false, message: 'Paste the map’s link.' };
  if (ARCGIS_ITEM_ID.test(value.toLowerCase())) return { ok: true, itemId: value.toLowerCase() };
  if (!/^https:\/\//i.test(value)) return { ok: false, message: NOT_A_MAP };
  if (value.length > MAX_LAYER_URL_LENGTH * 2 || writtenAddressProblem(value) !== null) {
    return { ok: false, message: NOT_A_MAP };
  }
  let url: WebAddress & { searchParams: SearchParamsLike };
  try {
    url = new URL(value);
  } catch {
    return { ok: false, message: 'This is not a web address.' };
  }
  const host = url.hostname.toLowerCase();
  if (websiteProblem(url) !== null || (host !== 'arcgis.com' && !host.endsWith('.arcgis.com'))) {
    return { ok: false, message: NOT_A_MAP };
  }
  const params = new Map<string, string>();
  url.searchParams.forEach((v, k) => params.set(k.toLowerCase(), v.trim().toLowerCase()));
  for (const name of ['webmap', 'appid', 'id', 'itemid']) {
    const id = params.get(name);
    if (id !== undefined && ARCGIS_ITEM_ID.test(id)) return { ok: true, itemId: id };
  }
  // An Experience Builder or StoryMap link: the id in the path.
  const inPath = url.pathname
    .split('/')
    .map((part) => part.toLowerCase())
    .find((part) => ARCGIS_ITEM_ID.test(part));
  if (inPath !== undefined) return { ok: true, itemId: inPath };
  return { ok: false, message: NOT_A_MAP };
}

// ---------------------------------------------------------------------------------------------
// An item's description and its terms

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The most of a description read: enough for any text kept, after its markup. */
const MAX_DESCRIPTION_READ = 100_000;

/**
 * Text without its markup, in one pass: a tag (from < to the next >) becomes a space; a < with no
 * > after it, and the rest, are kept. A regular expression took time growing with the square of
 * the length on many <s without >s (Codex's review of 1f328f9).
 */
export function withoutTags(text: string): string {
  let out = '';
  let at = 0;
  for (;;) {
    const open = text.indexOf('<', at);
    if (open === -1) return out + text.slice(at);
    const close = text.indexOf('>', open + 1);
    // No > after it: none after any later < either.
    if (close === -1) return out + text.slice(at);
    out += `${text.slice(at, open)} `;
    at = close + 1;
  }
}

/** Plain text from ArcGIS's descriptions: no markup, no control characters, cut short. */
export function arcgisPlainText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = withoutTags(value.slice(0, MAX_DESCRIPTION_READ))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim();
  if (text === '') return null;
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** What an ArcGIS item says about itself (sharing/rest/content/items/{id}?f=json). */
export interface ArcgisItemInfo {
  id: string;
  title: string;
  /** "Web Map", "Web Mapping Application", "Feature Service"… */
  type: string;
  /** Its credits (ArcGIS's "accessInformation"), if it states them. */
  credits: string | null;
  /** Its terms of use (ArcGIS's "licenseInfo"), as plain text. */
  licence: string | null;
}

export function readItemInfo(value: unknown): ArcgisItemInfo | null {
  const body = record(value);
  if (!body || record(body.error)) return null;
  const id = typeof body.id === 'string' ? body.id.toLowerCase() : '';
  if (!ARCGIS_ITEM_ID.test(id) || typeof body.type !== 'string') return null;
  return {
    id,
    title: arcgisPlainText(body.title, 200) ?? 'ArcGIS map',
    type: body.type,
    credits: arcgisPlainText(body.accessInformation, 200),
    licence: arcgisPlainText(body.licenseInfo, 2000),
  };
}

/** The source and terms a map's layers are added with, from its item (the admin can change them). */
export function itemTerms(info: ArcgisItemInfo): {
  sourceName: string;
  termsUrl: string;
  termsNote: string;
} {
  return {
    sourceName: info.credits ?? `${info.title.slice(0, 180)} (ArcGIS Online)`,
    termsUrl: arcgisItemPage(info.id),
    termsNote: info.licence ?? 'No terms are stated on the map’s ArcGIS page.',
  };
}

/** The map an app item shows (a classic app's webmap, a dashboard's or an experience's map). */
export function mapOfApp(data: unknown): string | null {
  const body = record(data);
  if (!body) return null;
  const candidates: unknown[] = [];
  const values = record(body.values);
  if (values) {
    candidates.push(Array.isArray(values.webmap) ? values.webmap[0] : values.webmap);
  }
  candidates.push(record(body.map)?.itemId);
  const sources = record(body.dataSources);
  if (sources) {
    for (const source of Object.values(sources)) {
      const s = record(source);
      if (s?.type === 'WEB_MAP') candidates.push(s.itemId);
    }
  }
  if (Array.isArray(body.widgets)) {
    for (const widget of body.widgets) {
      const w = record(widget);
      if (w?.type === 'mapWidget') candidates.push(w.itemId);
    }
  }
  const found = candidates.find(
    (c): c is string => typeof c === 'string' && ARCGIS_ITEM_ID.test(c.toLowerCase()),
  );
  return found?.toLowerCase() ?? null;
}

// ---------------------------------------------------------------------------------------------
// Drawing: ArcGIS's renderer as a GSS layer's colours

/** How a layer is drawn, as GSS keeps it. */
export interface LayerStyle {
  colour: string;
  colourField: string | null;
  colours: [string, string][];
  /** Whether values without a colour of their own are drawn. */
  othersShown: boolean;
  /** Line width in points; null: GSS's usual width. */
  lineWidth: number | null;
  /** 1 is solid. */
  opacity: number;
  /** True when ArcGIS draws it in a way GSS shows only roughly (classes, pictures, several fields). */
  approximate: boolean;
}

interface Paint {
  colour: string;
  /** 0 to 1. */
  alpha: number;
  /** Points; null when the symbol has none. */
  width: number | null;
}

const hex2 = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0');

/** ArcGIS's [r, g, b, a] (a from 0 to 255), or a CIM colour, as a colour and its alpha. */
function esriColour(value: unknown): { colour: string; alpha: number } | null {
  let rgba: unknown[] | null = Array.isArray(value) ? value : null;
  let alphaScale = 255;
  const cim = record(value);
  if (cim && Array.isArray(cim.values)) {
    // CIMRGBColor: values [r, g, b, a] with a from 0 to 100.
    rgba = cim.values;
    alphaScale = 100;
  }
  if (!rgba || rgba.length < 3 || !rgba.slice(0, 3).every((n) => typeof n === 'number')) {
    return null;
  }
  const [r, g, b, a] = rgba as number[];
  const alpha = typeof a === 'number' ? Math.max(0, Math.min(1, a / alphaScale)) : 1;
  return { colour: `#${hex2(r ?? 0)}${hex2(g ?? 0)}${hex2(b ?? 0)}`, alpha };
}

function positiveWidth(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(value, 50)
    : null;
}

/** The paint of a CIM symbol's layers: the first enabled solid stroke or fill, else one inside. */
function cimPaint(symbol: unknown, depth = 0): Paint | null {
  const s = record(symbol);
  if (!s || depth > 4) return null;
  const layers = Array.isArray(s.symbolLayers) ? s.symbolLayers.map(record) : [];
  const enabled = layers.filter(
    (l): l is Record<string, unknown> => l !== null && l.enable !== false,
  );
  for (const type of ['CIMSolidStroke', 'CIMSolidFill']) {
    for (const layer of enabled) {
      if (layer.type !== type) continue;
      const colour = esriColour(layer.color);
      if (colour && colour.alpha > 0) {
        return { ...colour, width: type === 'CIMSolidStroke' ? positiveWidth(layer.width) : null };
      }
    }
  }
  for (const layer of enabled) {
    const graphics = Array.isArray(layer.markerGraphics) ? layer.markerGraphics : [];
    for (const graphic of graphics) {
      const inner = cimPaint(record(graphic)?.symbol, depth + 1);
      if (inner) return inner;
    }
  }
  return null;
}

/** A symbol's paint: a line's colour and width, an area's fill (else outline), a point's colour. */
function symbolPaint(symbol: unknown): Paint | null {
  const s = record(symbol);
  if (!s) return null;
  if (s.type === 'CIMSymbolReference') return cimPaint(record(s.symbol));
  if (typeof s.type === 'string' && s.type.startsWith('CIM')) return cimPaint(s);
  const colour = esriColour(s.color);
  if (s.type === 'esriSLS') {
    return colour ? { ...colour, width: positiveWidth(s.width) } : null;
  }
  if (s.type === 'esriSFS') {
    const outline = record(s.outline);
    const line = esriColour(outline?.color);
    if (colour && colour.alpha > 0 && s.style !== 'esriSFSNull') {
      return { ...colour, width: positiveWidth(outline?.width) };
    }
    return line ? { ...line, width: positiveWidth(outline?.width) } : null;
  }
  if (s.type === 'esriSMS') return colour ? { ...colour, width: null } : null;
  return null;
}

/** A unique-value renderer's values and their symbols (as uniqueValueInfos or in groups). */
function uniqueValueInfos(
  renderer: Record<string, unknown>,
): { value: unknown; symbol: unknown }[] {
  const infos: { value: unknown; symbol: unknown }[] = [];
  if (Array.isArray(renderer.uniqueValueInfos)) {
    for (const info of renderer.uniqueValueInfos) {
      const i = record(info);
      if (i) infos.push({ value: i.value, symbol: i.symbol });
    }
  } else if (Array.isArray(renderer.uniqueValueGroups)) {
    for (const group of renderer.uniqueValueGroups) {
      const classes = record(group)?.classes;
      if (!Array.isArray(classes)) continue;
      for (const cls of classes) {
        const c = record(cls);
        const values = Array.isArray(c?.values) ? c.values : [];
        for (const v of values) {
          infos.push({ value: Array.isArray(v) ? v[0] : v, symbol: c?.symbol });
        }
      }
    }
  }
  return infos;
}

const FIELD = /^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,63}$/;

/**
 * ArcGIS's drawing of a layer as GSS draws it: one colour (simple), a colour per value of a field
 * (unique values), or, for kinds GSS does not draw the same way (class breaks, several fields,
 * pictures, heat maps), the closest single colour, marked approximate. `transparency` is the
 * layer's (0 to 100), `layerOpacity` the map's setting for it (0 to 1).
 */
export function styleOfRenderer(
  renderer: unknown,
  transparency: unknown = 0,
  layerOpacity: unknown = 1,
): LayerStyle {
  const r = record(renderer);
  const seeThrough =
    (typeof layerOpacity === 'number' && layerOpacity >= 0 && layerOpacity <= 1
      ? layerOpacity
      : 1) *
    (typeof transparency === 'number' && transparency >= 0 && transparency <= 100
      ? 1 - transparency / 100
      : 1);
  const style = (paint: Paint | null, approximate: boolean): LayerStyle => ({
    colour: paint?.colour ?? DEFAULT_LAYER_COLOUR,
    colourField: null,
    colours: [],
    othersShown: true,
    lineWidth: paint?.width ?? null,
    opacity: opacityOf(seeThrough * (paint?.alpha ?? 1)),
    approximate: approximate || paint === null,
  });
  if (!r) return style(null, true);
  // Colours that vary with a value, size or rotation are not followed (shown in the base colour).
  const varies = Array.isArray(r.visualVariables) && r.visualVariables.length > 0;
  if (r.type === 'simple') return style(symbolPaint(r.symbol), varies);
  if (r.type === 'uniqueValue') {
    const field = r.field1;
    const infos = uniqueValueInfos(r);
    const byOneField =
      typeof field === 'string' && FIELD.test(field) && !r.field2 && !r.valueExpression;
    const fallback = symbolPaint(r.defaultSymbol);
    if (!byOneField || infos.length === 0) {
      return style(fallback ?? symbolPaint(infos[0]?.symbol), true);
    }
    const colours: [string, string][] = [];
    const seen = new Set<string>();
    let width: number | null = null;
    let approximate = varies;
    for (const info of infos) {
      const value = cleanValue(info.value);
      const paint = symbolPaint(info.symbol);
      if (value === '' || seen.has(value)) continue;
      if (!paint) {
        approximate = true;
        continue;
      }
      if (colours.length >= MAX_LAYER_COLOURS) {
        approximate = true;
        break;
      }
      seen.add(value);
      colours.push([value, paint.colour]);
      width ??= paint.width;
    }
    return {
      colour: fallback?.colour ?? OTHER_VALUES_COLOUR,
      colourField: colours.length > 0 ? field : null,
      colours,
      // ArcGIS draws values without a symbol only when there is a default symbol.
      othersShown: fallback !== null || colours.length === 0,
      lineWidth: width ?? fallback?.width ?? null,
      opacity: opacityOf(seeThrough),
      approximate,
    };
  }
  if (r.type === 'classBreaks') {
    const first = Array.isArray(r.classBreakInfos) ? record(r.classBreakInfos[0])?.symbol : null;
    return style(symbolPaint(r.defaultSymbol) ?? symbolPaint(first), true);
  }
  return style(symbolPaint(r.symbol) ?? symbolPaint(r.defaultSymbol), true);
}

/** An opacity GSS keeps: above 0 (a layer never wholly vanishes), at most 1, to 3 places. */
function opacityOf(value: number): number {
  return Math.min(1, Math.max(0.05, Math.round(value * 1000) / 1000));
}

// ---------------------------------------------------------------------------------------------
// Zoom ranges

/** ArcGIS's scale at its zoom 0 (256-pixel squares at 96 dots per inch). */
const SCALE_AT_ZOOM_0 = 591_657_527.591555;

/**
 * The Mapbox zoom at an ArcGIS scale (1 : scale), to two places; null for no limit (0). Mapbox's
 * squares are 512 pixels, so its zoom is ArcGIS's less one.
 */
export function scaleToZoom(scale: unknown): number | null {
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return null;
  const zoom = Math.log2(SCALE_AT_ZOOM_0 / scale) - 1;
  return Math.round(Math.min(24, Math.max(0, zoom)) * 100) / 100;
}

/**
 * The zooms a layer shows between: its minScale (the farthest out it shows) as the lowest zoom,
 * its maxScale (the closest in) as the highest. Null for no limit.
 */
/**
 * Whether ArcGIS never draws a layer: its farthest-out scale is not beyond its closest-in one
 * (a group's range and its own that do not overlap; Codex's re-review of 1a5f81c).
 */
export function neverShown(minScale: number | null, maxScale: number | null): boolean {
  return (
    minScale !== null && maxScale !== null && minScale > 0 && maxScale > 0 && minScale <= maxScale
  );
}

export function zoomRange(
  minScale: unknown,
  maxScale: unknown,
): { minZoom: number | null; maxZoom: number | null } {
  const minZoom = scaleToZoom(minScale);
  const maxZoom = scaleToZoom(maxScale);
  // A range narrower than the zooms' rounding is kept narrow, never widened to every zoom
  // (Codex's re-review of 813c5b6); a range ArcGIS never draws is refused by neverShown.
  if (minZoom !== null && maxZoom !== null && minZoom >= maxZoom) {
    const narrow = Math.round((minZoom + 0.01) * 100) / 100;
    return { minZoom: minZoom === 0 ? null : minZoom, maxZoom: narrow > 24 ? null : narrow };
  }
  return { minZoom: minZoom === 0 ? null : minZoom, maxZoom: maxZoom === 24 ? null : maxZoom };
}

// ---------------------------------------------------------------------------------------------
// Features kept in the map itself (ArcGIS's "feature collections") as GeoJSON

const EARTH_RADIUS = 6_378_137;
const MERCATOR = new Set([102100, 3857, 102113, 900913]);

type Position = [number, number];

function toLonLat(mercator: boolean): (p: unknown) => Position | null {
  return (p) => {
    if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number') return null;
    const [x, y] = p as [number, number];
    if (!mercator) return [x, y];
    const lon = (x / EARTH_RADIUS) * (180 / Math.PI);
    const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * (180 / Math.PI);
    return [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
  };
}

function path(points: unknown, convert: (p: unknown) => Position | null): Position[] {
  return Array.isArray(points) ? points.map(convert).filter((p): p is Position => p !== null) : [];
}

/** Twice a ring's signed area with y up: positive when it runs clockwise (ArcGIS's outer rings). */
function ringArea(ring: readonly Position[]): number {
  let sum = 0;
  ring.forEach(([x2, y2], i) => {
    const before = ring[i - 1];
    if (before) sum += (x2 - before[0]) * (y2 + before[1]);
  });
  return Math.abs(sum);
}

function clockwise(ring: readonly Position[]): boolean {
  let sum = 0;
  ring.forEach(([x2, y2], i) => {
    const before = ring[i - 1];
    if (before) sum += (x2 - before[0]) * (y2 + before[1]);
  });
  return sum > 0;
}

/** Whether a point is inside a ring (crossings of a ray to its right). */
/** Where a point is against a ring: inside, outside, or on its edge. */
function whereIs(ring: readonly Position[], [x, y]: Position): 'in' | 'out' | 'on' {
  let inside = false;
  for (let i = 1; i < ring.length; i += 1) {
    const before = ring[i - 1];
    const after = ring[i];
    if (!before || !after) continue;
    const [x1, y1] = before;
    const [x2, y2] = after;
    const cross = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1);
    const scale = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1e-12);
    if (
      Math.abs(cross) <= scale * 1e-9 &&
      x >= Math.min(x1, x2) - 1e-12 &&
      x <= Math.max(x1, x2) + 1e-12 &&
      y >= Math.min(y1, y2) - 1e-12 &&
      y <= Math.max(y1, y2) + 1e-12
    ) {
      return 'on';
    }
    if (y1 > y !== y2 > y && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside ? 'in' : 'out';
}

/**
 * Whether a hole lies within an outer ring: none of its corners outside, and one corner (or, when
 * all touch the edge, the middle of one side) inside. A hole may touch its outer ring at a corner,
 * so one corner alone does not tell (Codex's re-review of 813c5b6).
 */
function ringHolds(shell: readonly Position[], hole: readonly Position[]): boolean {
  const places = hole.map((p) => whereIs(shell, p));
  if (places.includes('out')) return false;
  if (places.includes('in')) return true;
  return hole.some((p, i) => {
    const next = hole[i + 1];
    return (
      next !== undefined && whereIs(shell, [(p[0] + next[0]) / 2, (p[1] + next[1]) / 2]) === 'in'
    );
  });
}

function geometryOf(
  geometry: unknown,
  geometryType: string,
  convert: (p: unknown) => Position | null,
): GeoJSONGeometry | null {
  const g = record(geometry);
  if (!g) return null;
  if (geometryType === 'esriGeometryPoint') {
    const point = convert([g.x, g.y]);
    return point ? { type: 'Point', coordinates: point } : null;
  }
  if (geometryType === 'esriGeometryMultipoint') {
    const points = path(g.points, convert);
    return points.length > 0 ? { type: 'MultiPoint', coordinates: points } : null;
  }
  if (geometryType === 'esriGeometryPolyline') {
    const lines = (Array.isArray(g.paths) ? g.paths : [])
      .map((p) => path(p, convert))
      .filter((p) => p.length >= 2);
    const [only, ...more] = lines;
    if (!only) return null;
    return more.length === 0
      ? { type: 'LineString', coordinates: only }
      : { type: 'MultiLineString', coordinates: lines };
  }
  if (geometryType === 'esriGeometryPolygon') {
    const rings = (Array.isArray(g.rings) ? g.rings : [])
      .map((p) => path(p, convert))
      .filter((p) => p.length >= 4);
    // An outer ring runs clockwise and a hole the other way, in any order; each hole goes with
    // the outer ring around it (Codex's review of 1f328f9: not merely the last one before it).
    const outer = rings.filter((ring) => clockwise(ring));
    const polygons: Position[][][] = (outer.length > 0 ? outer : rings.slice(0, 1)).map((r) => [r]);
    for (const ring of rings) {
      if (polygons.some(([o]) => o === ring)) continue;
      // The innermost outer ring around it: an island inside a hole has its own holes (Codex's
      // re-review of 1a5f81c).
      const containing = polygons.filter(([o]) => o !== undefined && ringHolds(o, ring));
      const around =
        containing.reduce<Position[][] | undefined>(
          (best, candidate) =>
            best?.[0] === undefined ||
            (candidate[0] !== undefined && ringArea(candidate[0]) < ringArea(best[0]))
              ? candidate
              : best,
          undefined,
        ) ?? polygons[polygons.length - 1];
      around?.push(ring);
    }
    const [only, ...more] = polygons;
    if (!only) return null;
    return more.length === 0
      ? { type: 'Polygon', coordinates: only }
      : { type: 'MultiPolygon', coordinates: polygons };
  }
  return null;
}

type GeoJSONGeometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'MultiPoint'; coordinates: Position[] }
  | { type: 'LineString'; coordinates: Position[] }
  | { type: 'MultiLineString'; coordinates: Position[][] }
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] };

/**
 * A feature collection layer kept in the map, as GeoJSON in longitude and latitude (to be checked
 * by normalizeFeatureCollection); null when its coordinates are in a system GSS does not convert
 * (only web Mercator and longitude and latitude are).
 */
export function featureSetToGeoJSON(
  featureSet: unknown,
  spatialReference: unknown,
): { type: 'FeatureCollection'; features: unknown[] } | null {
  const set = record(featureSet);
  const sr = record(spatialReference);
  const wkid = typeof sr?.latestWkid === 'number' ? sr.latestWkid : sr?.wkid;
  if (!set || typeof wkid !== 'number') return null;
  const mercator = MERCATOR.has(wkid) || (typeof sr?.wkid === 'number' && MERCATOR.has(sr.wkid));
  if (!mercator && wkid !== 4326) return null;
  const geometryType = typeof set.geometryType === 'string' ? set.geometryType : '';
  const convert = toLonLat(mercator);
  const features: unknown[] = [];
  for (const raw of Array.isArray(set.features) ? set.features : []) {
    const feature = record(raw);
    const geometry = geometryOf(feature?.geometry, geometryType, convert);
    if (!geometry) continue;
    features.push({ type: 'Feature', geometry, properties: record(feature?.attributes) ?? {} });
  }
  return { type: 'FeatureCollection', features };
}

// ---------------------------------------------------------------------------------------------
// A map's layers

/** One of a map's layers, as GSS would add it. */
export interface WebMapLayer {
  title: string;
  /** What GSS adds it as; null when GSS does not take this kind (`problem` says why). */
  kind: MapLayerKind | null;
  /** A web service's address, as the map gives it. */
  url: string | null;
  /** WMS layer names. */
  wmsLayers: string | null;
  /** The layer's own item, whose drawing applies when the map gives none. */
  itemId: string | null;
  /** The layer's number in its service (the 0 in …/FeatureServer/0). */
  layerIndex: number | null;
  /** ArcGIS's drawing in the map; null when the map gives none. */
  renderer: unknown;
  transparency: number;
  /** The map's opacity for it, including its group's. */
  opacity: number;
  definitionExpression: string | null;
  minScale: number | null;
  maxScale: number | null;
  /** The features of a layer kept in the map itself, as GeoJSON. */
  collection: { type: 'FeatureCollection'; features: unknown[] } | null;
  problem: string | null;
}

const LAYER_KIND_NAMES: Record<string, string> = {
  VectorTileLayer: 'vector tile',
  ArcGISSceneServiceLayer: 'scene',
  IntegratedMeshLayer: '3D mesh',
  PointCloudLayer: 'point cloud',
  BuildingSceneLayer: 'building',
  CSV: 'CSV',
  GeoJSON: 'GeoJSON link',
  GeoRSS: 'GeoRSS',
  KML: 'KML link',
  WFS: 'WFS',
  WebTiledLayer: 'tiled picture',
  OGCFeatureLayer: 'OGC feature',
  ArcGISStreamLayer: 'live stream',
  SubtypeGroupLayer: 'subtype group',
  ArcGISImageServiceVectorLayer: 'image vector',
};

function numberOr<T>(value: unknown, fallback: T): number | T {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * The map's filter on a layer: none, one GSS sends (safeFilter, as the API and the database
 * check it), or refused, so a layer whose filter cannot be kept is never added unfiltered
 * (Codex's review of 1f328f9).
 */
function filterOf(value: unknown): { filter: string | null; refused: boolean } {
  if (typeof value !== 'string' || value.trim() === '') return { filter: null, refused: false };
  const text = value.trim();
  return safeFilter(text) ? { filter: text, refused: false } : { filter: null, refused: true };
}

/** The narrower of two ArcGIS scale limits (0 or none: no limit). */
function narrower(a: number | null, b: number | null, pick: (x: number, y: number) => number) {
  const ok = (v: number | null): v is number => v !== null && v > 0;
  if (ok(a) && ok(b)) return pick(a, b);
  return ok(a) ? a : ok(b) ? b : null;
}

export const FILTER_REFUSED = 'Its filter on ArcGIS is not one GSS can send.';

/**
 * A map's layers, bottom to top (the order ArcGIS draws them in): from its data
 * (sharing/rest/content/items/{id}/data), groups opened, each with the drawing the map gives it.
 */
export function webMapLayers(data: unknown): WebMapLayer[] {
  const body = record(data);
  const out: WebMapLayer[] = [];
  /** A group's opacity and scale range apply to its layers too. */
  interface Group {
    opacity: number;
    minScale: number | null;
    maxScale: number | null;
  }
  const visit = (layers: unknown, group: Group, depth: number) => {
    if (!Array.isArray(layers) || depth > 4) return;
    for (const raw of layers) {
      const layer = record(raw);
      if (!layer) continue;
      const title = arcgisPlainText(layer.title, 200) ?? 'Untitled layer';
      const opacity = group.opacity * Math.min(1, Math.max(0, numberOr(layer.opacity, 1)));
      const definition = record(layer.layerDefinition);
      // The farthest out it shows is the nearer of its own and its group's; likewise inwards
      // (Codex's review of 1f328f9: a group's range was dropped).
      const minScale = narrower(
        numberOr(layer.minScale ?? definition?.minScale, null),
        group.minScale,
        Math.min,
      );
      const maxScale = narrower(
        numberOr(layer.maxScale ?? definition?.maxScale, null),
        group.maxScale,
        Math.max,
      );
      const type = typeof layer.layerType === 'string' ? layer.layerType : '';
      if (type === 'GroupLayer') {
        visit(layer.layers, { opacity, minScale, maxScale }, depth + 1);
        continue;
      }
      const filter = filterOf(definition?.definitionExpression);
      const drawing = record(definition?.drawingInfo);
      const base: WebMapLayer = {
        title,
        kind: null,
        url: typeof layer.url === 'string' ? layer.url : null,
        wmsLayers: null,
        itemId:
          typeof layer.itemId === 'string' && ARCGIS_ITEM_ID.test(layer.itemId)
            ? layer.itemId
            : null,
        layerIndex: null,
        renderer: drawing?.renderer ?? null,
        transparency: numberOr(drawing?.transparency, 0),
        opacity,
        definitionExpression: filter.filter,
        minScale,
        maxScale,
        collection: null,
        problem: null,
      };
      if (filter.refused) {
        out.push({ ...base, problem: FILTER_REFUSED });
        continue;
      }
      const collection = record(layer.featureCollection);
      if (type === 'ArcGISFeatureLayer' && collection) {
        const inner = Array.isArray(collection.layers) ? collection.layers : [];
        for (const rawInner of inner) {
          const innerLayer = record(rawInner);
          const innerDefinition = record(innerLayer?.layerDefinition);
          const innerDrawing = record(innerDefinition?.drawingInfo);
          const set = record(innerLayer?.featureSet);
          const sr =
            record(set?.spatialReference) ??
            record(innerDefinition?.spatialReference) ??
            record(record(innerDefinition?.extent)?.spatialReference);
          const geojson = featureSetToGeoJSON(
            { ...set, geometryType: set?.geometryType ?? innerDefinition?.geometryType },
            sr,
          );
          const name = arcgisPlainText(innerDefinition?.name, 200);
          // GSS cannot filter features kept in the map as ArcGIS does, so a filtered one is not
          // added with all of them (Codex's review of 1f328f9).
          const filtered =
            base.definitionExpression !== null ||
            filterOf(innerDefinition?.definitionExpression).filter !== null ||
            filterOf(innerDefinition?.definitionExpression).refused;
          out.push({
            ...base,
            title: inner.length > 1 && name ? `${title}: ${name}` : title,
            url: null,
            renderer: innerDrawing?.renderer ?? base.renderer,
            transparency: numberOr(innerDrawing?.transparency, base.transparency),
            minScale: narrower(numberOr(innerDefinition?.minScale, null), base.minScale, Math.min),
            maxScale: narrower(numberOr(innerDefinition?.maxScale, null), base.maxScale, Math.max),
            definitionExpression: null,
            kind: geojson && !filtered ? 'file' : null,
            collection: filtered ? null : geojson,
            problem: filtered
              ? 'Its features are kept in the map with a filter GSS cannot apply to them.'
              : geojson
                ? null
                : 'Its features are in a coordinate system GSS does not convert.',
          });
        }
        if (inner.length === 0) {
          out.push({ ...base, problem: 'It holds no features.' });
        }
        continue;
      }
      if (
        type === 'ArcGISFeatureLayer' ||
        type === 'ArcGISMapServiceLayer' ||
        type === 'ArcGISImageServiceLayer' ||
        type === 'ArcGISTiledMapServiceLayer' ||
        type === 'ArcGISTiledImageServiceLayer' ||
        type === 'WMS'
      ) {
        const source = base.url ? parseLayerSource(base.url) : null;
        if (!source?.ok) {
          out.push({ ...base, problem: 'Its web address is not one GSS takes.' });
          continue;
        }
        if (type === 'WMS') {
          const names = (Array.isArray(layer.layers) ? layer.layers : [])
            .map((l) => record(l)?.name)
            .filter(
              (n): n is string => typeof n === 'string' && /^[A-Za-z0-9_.:/ -]{1,100}$/.test(n),
            );
          const wmsLayers = names.join(',').slice(0, 500) || source.wmsLayers;
          out.push({
            ...base,
            kind: source.kind === 'wms' && wmsLayers ? 'wms' : null,
            url: source.url,
            wmsLayers: wmsLayers ?? null,
            problem: source.kind === 'wms' && wmsLayers ? null : 'Its WMS layers are not named.',
          });
          continue;
        }
        const index = /\/(\d+)$/.exec(source.url)?.[1];
        const layerIndex = index !== undefined ? Number(index) : null;
        if (type === 'ArcGISFeatureLayer') {
          const features = source.kind === 'arcgis_features';
          out.push({
            ...base,
            kind: features ? 'arcgis_features' : null,
            url: source.url,
            layerIndex,
            problem: features ? null : 'Its web address is not one of a layer of features.',
          });
          continue;
        }
        // A map or image service is drawn as pictures of the whole service.
        out.push({
          ...base,
          kind: source.kind === 'wms' ? null : 'arcgis_image',
          url: source.url.replace(/\/(FeatureServer|MapServer)\/\d+$/i, '/MapServer'),
          layerIndex,
          problem: source.kind === 'wms' ? 'Its web address is not an ArcGIS service.' : null,
        });
        continue;
      }
      out.push({
        ...base,
        problem: `GSS does not take ArcGIS’s ${LAYER_KIND_NAMES[type] ?? (type || 'unnamed')} layers yet.`,
      });
    }
  };
  visit(body?.operationalLayers, { opacity: 1, minScale: null, maxScale: null }, 0);
  return out;
}

/**
 * A layer's drawing in its own item (sharing/rest/content/items/{id}/data), for a layer the map
 * gives none: the item's entry for the layer's number, else its only one.
 */
export function itemLayerDrawing(
  data: unknown,
  layerIndex: number | null,
): {
  renderer: unknown;
  transparency: number;
  definitionExpression: string | null;
  /** The item has a filter GSS cannot send: the layer is not added (Codex's review of 1f328f9). */
  definitionRefused: boolean;
  minScale: number | null;
  maxScale: number | null;
} | null {
  const layers = record(data)?.layers;
  if (!Array.isArray(layers)) return null;
  const entries = layers.map(record).filter((l): l is Record<string, unknown> => l !== null);
  const entry =
    entries.find((l) => l.id === layerIndex) ?? (entries.length === 1 ? entries[0] : undefined);
  const definition = record(entry?.layerDefinition);
  const drawing = record(definition?.drawingInfo);
  if (!entry || !definition) return null;
  return {
    renderer: drawing?.renderer ?? null,
    transparency: numberOr(drawing?.transparency, 0),
    definitionExpression: filterOf(definition.definitionExpression).filter,
    definitionRefused: filterOf(definition.definitionExpression).refused,
    minScale: numberOr(definition.minScale ?? entry.minScale, null),
    maxScale: numberOr(definition.maxScale ?? entry.maxScale, null),
  };
}
