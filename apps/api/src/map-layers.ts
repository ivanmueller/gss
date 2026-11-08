import {
  arcgisItemSchema,
  createMapLayerSchema,
  inspectLayerSchema,
  cleanValue,
  isTile,
  whereOf,
  MAX_OVERVIEW_SOURCE,
  OVERVIEW_PAGE_SIZE,
  OVERVIEW_TOLERANCE_METRES,
  overviewPartSchema,
  publishOverviewSchema,
  MAX_LAYER_FILE_BYTES,
  normalizeFeatureCollection,
  parseLayerSource,
  simplifyDegrees,
  tileBounds,
  tileBoundsMercator,
  updateMapLayerSchema,
  type LayerInspection,
  type MapLayerList,
  type Tile,
  type ValueCount,
} from '@grain/domain';
import { Hono } from 'hono';

import type { Database, RequestContext } from './db';
import type { MapLayerSource, MapLayerWrite } from './map-layers-db';
import {
  apiError,
  isUuid,
  readJson,
  withDatabase,
  type ApiContext,
  type ApiEnv,
  type DatabaseFactory,
} from './respond';

// Map layers (the owner's request and answers of 2026-11-07, docs/DECISIONS.md, F-107).
// Admins add a web service or a file; every member sees the list and switches layers on and
// off in the browser. A web service is fetched by the Worker, never by the browser: its
// address stays here, the app's content security policy stays as it is, and the request is
// built from the layer's stored address and a map square only, never from the browser's text.

/** ArcGIS Online's items, where a map's description and data are read (F-138). */
const ARCGIS_ITEMS = 'https://www.arcgis.com/sharing/rest/content/items';
/** The largest map read: its layers, drawing and any features kept in it. */
const MAX_ITEM_BYTES = 12 * 1024 * 1024;

/** A file arrives as checked GeoJSON inside JSON; a little over the 5 MB kept. */
const MAX_CREATE_BYTES = 6 * 1024 * 1024 + 64 * 1024;
const MAX_BODY_BYTES = 64 * 1024;
/** The most taken from a web service for one map square, one picture or one description. */
const MAX_FEATURES_BYTES = 8 * 1024 * 1024;
const MAX_PICTURE_BYTES = 3 * 1024 * 1024;
const MAX_DESCRIPTION_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
/** Pictures and squares of a live layer are kept by the browser for an hour. */
const LIVE_CACHE = 'private, max-age=3600';
const NOT_MEMBER = 'You are not an active member.';
const ADMINS_ONLY = 'Only admins add, change and remove map layers.';
const USER_AGENT = 'GSS map layers (Cloudflare Worker)';

/** A web service's answer could not be used. */
export class LayerServiceError extends Error {
  constructor(readonly status: number) {
    super(`Layer service answered ${String(status)}`);
    this.name = 'LayerServiceError';
  }
}

/**
 * Reads a body piece by piece, stopping and cancelling it as soon as it passes `maxBytes`, so a
 * service that sends more than it says (or says nothing) never fills the Worker's memory
 * (Codex's review of 11c467e).
 */
async function readLimited(res: Response, maxBytes: number): Promise<ArrayBuffer> {
  if (!res.body) return new ArrayBuffer(0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const chunk = (await reader.read()) as ReadableStreamReadResult<Uint8Array>;
    if (chunk.done) break;
    const value = chunk.value;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new LayerServiceError(413);
    }
    parts.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  return body.buffer;
}

/**
 * Fetches a web service's answer, refusing one that is too large or not what was asked for.
 * Redirects are refused, never followed: only the stored, checked address is ever fetched
 * (Codex's review of 11c467e). A failure while the body arrives is the service's failure too.
 */
async function fetchService(
  url: string,
  accept: RegExp,
  maxBytes: number,
): Promise<{ body: ArrayBuffer; type: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: '*/*', 'User-Agent': USER_AGENT },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new LayerServiceError(0);
  }
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel().catch(() => undefined);
    throw new LayerServiceError(res.status);
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new LayerServiceError(res.status);
  }
  const type = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (!accept.test(type) || declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new LayerServiceError(accept.test(type) ? 413 : 415);
  }
  try {
    return { body: await readLimited(res, maxBytes), type };
  } catch (error) {
    if (error instanceof LayerServiceError) throw error;
    throw new LayerServiceError(0);
  }
}

async function fetchJson(url: string, maxBytes = MAX_DESCRIPTION_BYTES): Promise<unknown> {
  const { body } = await fetchService(
    url,
    /^(application|text)\/(json|plain|geo\+json)$/,
    maxBytes,
  );
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    throw new LayerServiceError(422);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Plain text from a service's description: no markup, no control characters, cut short. */
function plainText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim();
  return text === '' ? null : text.slice(0, max);
}

const COLOUR_FIELD_TYPES = new Set([
  'esriFieldTypeString',
  'esriFieldTypeSmallInteger',
  'esriFieldTypeInteger',
]);

/**
 * An ArcGIS layer's own description: its name, terms text, the fields that can colour it, and
 * its own drawing and scale range (F-138), used when its map and item give none.
 */
export async function describeArcgis(url: string): Promise<{
  title: string | null;
  copyright: string | null;
  fields: string[];
  idField: string | null;
  drawing: LayerInspection['drawing'];
}> {
  const body = record(await fetchJson(`${url}?f=json`));
  if (!body || record(body.error)) throw new LayerServiceError(422);
  const fields = Array.isArray(body.fields)
    ? body.fields
        .map(record)
        .filter(
          (f): f is Record<string, unknown> =>
            f !== null &&
            typeof f.name === 'string' &&
            typeof f.type === 'string' &&
            COLOUR_FIELD_TYPES.has(f.type) &&
            /^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,63}$/.test(f.name),
        )
        .map((f) => f.name as string)
    : [];
  const oid = Array.isArray(body.fields)
    ? body.fields.map(record).find((f) => f?.type === 'esriFieldTypeOID')?.name
    : undefined;
  const idField = typeof body.objectIdField === 'string' ? body.objectIdField : oid;
  const drawingInfo = record(body.drawingInfo);
  const scale = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  return {
    drawing: {
      renderer: drawingInfo?.renderer ?? null,
      transparency: typeof drawingInfo?.transparency === 'number' ? drawingInfo.transparency : 0,
      minScale: scale(body.minScale),
      maxScale: scale(body.maxScale),
    },
    title: plainText(body.name ?? body.mapName ?? body.serviceDescription, 200),
    copyright: plainText(body.copyrightText, 2000),
    fields,
    idField:
      typeof idField === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,63}$/.test(idField)
        ? idField
        : null,
  };
}

/** How often each value of an ArcGIS layer's field occurs, most common first. */
/**
 * How often each value occurs in an ArcGIS layer's fields, most common first: the colour field and
 * those that also count (F-137), summed, within the layer's limit (where).
 */
export async function arcgisValueCounts(
  url: string,
  fields: readonly string[],
  where = '1=1',
): Promise<ValueCount[]> {
  const counts = new Map<string, number>();
  for (const field of fields) {
    const params = new URLSearchParams({
      where,
      groupByFieldsForStatistics: field,
      outStatistics: JSON.stringify([
        { statisticType: 'count', onStatisticField: field, outStatisticFieldName: 'gss_count' },
      ]),
      f: 'json',
    });
    const body = record(await fetchJson(`${url}/query?${params.toString()}`));
    if (!body || record(body.error) || !Array.isArray(body.features)) {
      throw new LayerServiceError(422);
    }
    for (const feature of body.features) {
      const attributes = record(record(feature)?.attributes);
      const value = attributes?.[field];
      const count = attributes?.gss_count;
      if (typeof count === 'number') {
        const text = cleanValue(value);
        if (text !== '') counts.set(text, (counts.get(text) ?? 0) + count);
      }
    }
  }
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** How many features an ArcGIS layer has within a limit (where). */
async function arcgisCount(url: string, where = '1=1'): Promise<number> {
  const params = new URLSearchParams({ where, returnCountOnly: 'true', f: 'json' });
  const count = record(await fetchJson(`${url}/query?${params.toString()}`))?.count;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
    throw new LayerServiceError(422);
  }
  return count;
}

/** Why a layer's shared fields and limit do not fit its fields (F-137), or null. */
function sharedProblem(
  fields: readonly string[],
  layer: { colourField: string | null; alsoFields: readonly string[]; onlyField: string | null },
): string | null {
  if (layer.alsoFields.length > 0 && layer.colourField === null) {
    return 'Choose the field it is coloured by before fields that also count.';
  }
  if (layer.alsoFields.some((f) => !fields.includes(f))) return 'This layer has no such field.';
  if (layer.onlyField !== null && !fields.includes(layer.onlyField)) {
    return 'This layer has no such field.';
  }
  return null;
}

/** The address of one map square's features from an ArcGIS layer, simplified to its zoom. */
export function arcgisSquareUrl(source: MapLayerSource, tile: Tile): string {
  const b = tileBounds(tile);
  const params = new URLSearchParams({
    f: 'geojson',
    where: whereOf(source),
    // The id, to ask for a clicked feature's details, and the field it is coloured by.
    // The id, to ask for a clicked feature's details, and the fields it is coloured by.
    outFields: [source.idField, source.colourField, ...source.alsoFields]
      .filter((f) => f !== null)
      .join(','),
    returnGeometry: 'true',
    geometry: [b.west, b.south, b.east, b.north].map((n) => n.toFixed(6)).join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    maxAllowableOffset: simplifyDegrees(tile.z).toPrecision(3),
    geometryPrecision: tile.z >= 12 ? '6' : '5',
    resultType: 'tile',
  });
  return `${source.url ?? ''}/query?${params.toString()}`;
}

/** The address of one map square's picture from an ArcGIS map or a WMS service. */
export function pictureUrl(source: MapLayerSource, tile: Tile): string {
  const bbox = tileBoundsMercator(tile)
    .map((n) => n.toFixed(2))
    .join(',');
  const url = source.url ?? '';
  if (source.kind === 'wms') {
    const params = new URLSearchParams({
      SERVICE: 'WMS',
      VERSION: '1.3.0',
      REQUEST: 'GetMap',
      LAYERS: source.wmsLayers ?? '',
      STYLES: '',
      CRS: 'EPSG:3857',
      BBOX: bbox,
      WIDTH: '256',
      HEIGHT: '256',
      FORMAT: 'image/png',
      TRANSPARENT: 'TRUE',
    });
    return `${url}?${params.toString()}`;
  }
  const image = /\/ImageServer$/i.test(url);
  const params = new URLSearchParams({
    bbox,
    bboxSR: '3857',
    imageSR: '3857',
    size: '256,256',
    format: image ? 'png' : 'png32',
    transparent: 'true',
    f: 'image',
  });
  return `${url}/${image ? 'exportImage' : 'export'}?${params.toString()}`;
}

/** ArcGIS's compact answer (PBF), for reading a whole layer for its zoomed-out view (F-134). */
const PBF = /^application\/(x-protobuf|octet-stream|vnd\.google\.protobuf)$/;
const MAX_PAGE_BYTES = 20 * 1024 * 1024;
/** A part of a zoomed-out view as sent (about 96 KB of features, with room to spare). */
const MAX_PART_BYTES = 160 * 1024;
/** A part as kept once checked (the database's limit). */
const MAX_STORED_PART_BYTES = 256 * 1024;

/**
 * A view's parts (each a JSON array of features, as checked when it arrived) put together as one
 * FeatureCollection, without reading them again.
 */
export function joinParts(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const head = encoder.encode('{"type":"FeatureCollection","features":[');
  const comma = encoder.encode(',');
  const tail = encoder.encode(']}');
  const inner = parts
    .map((part) => part.subarray(1, part.byteLength - 1))
    .filter((part) => part.byteLength > 0);
  const size =
    head.byteLength +
    tail.byteLength +
    inner.reduce((n, part) => n + part.byteLength, 0) +
    Math.max(0, inner.length - 1);
  const out = new Uint8Array(size);
  let at = 0;
  const put = (bytes: Uint8Array) => {
    out.set(bytes, at);
    at += bytes.byteLength;
  };
  put(head);
  inner.forEach((part, i) => {
    if (i > 0) put(comma);
    put(part);
  });
  put(tail);
  return out;
}

/** The whole world in web Mercator, the extent the service's simplification is measured in. */
const WORLD_MERCATOR = {
  xmin: -20037508.34,
  ymin: -20037508.34,
  xmax: 20037508.34,
  ymax: 20037508.34,
  spatialReference: { wkid: 102100 },
};

/**
 * The address of one page of a whole ArcGIS layer for its zoomed-out view: OVERVIEW_PAGE_SIZE
 * pieces from `offset`, in the order of the layer's id field, in web Mercator metres, simplified
 * by the service to about a kilometre, with only the field its lines are grouped by.
 */
export function overviewPageUrl(source: MapLayerSource, offset: number): string {
  const params = new URLSearchParams({
    f: 'pbf',
    where: whereOf(source),
    outFields: [source.colourField, ...source.alsoFields].filter((f) => f !== null).join(','),
    returnGeometry: 'true',
    outSR: '102100',
    orderByFields: source.idField ?? '',
    resultOffset: String(offset),
    resultRecordCount: String(OVERVIEW_PAGE_SIZE),
    maxRecordCountFactor: '4',
    quantizationParameters: JSON.stringify({
      mode: 'view',
      originPosition: 'upperLeft',
      tolerance: OVERVIEW_TOLERANCE_METRES,
      extent: WORLD_MERCATOR,
    }),
  });
  return `${source.url ?? ''}/query?${params.toString()}`;
}

/** A live lines layer an admin may prepare a zoomed-out view of, or the answer refusing it. */
async function overviewSource(
  c: ApiContext,
  db: Database,
  ctx: RequestContext,
  id: string,
): Promise<MapLayerSource | Response> {
  const source = await db.getMapLayerSource(ctx, id);
  if (!source) return apiError(c, 404, 'NOT_FOUND', 'No such map layer.');
  if (!(await db.isOrgAdmin(ctx, source.organizationId))) {
    return apiError(c, 403, 'FORBIDDEN', ADMINS_ONLY);
  }
  if (source.kind !== 'arcgis_features' || source.url === null || source.idField === null) {
    return apiError(
      c,
      422,
      'NO_OVERVIEW',
      'Only an ArcGIS layer of lines, areas or points with an id field takes a zoomed-out view.',
    );
  }
  return source;
}

function tileOf(c: ApiContext): Tile | null {
  const tile = {
    z: Number(c.req.param('z')),
    x: Number(c.req.param('x')),
    y: Number((c.req.param('y') ?? '').replace(/\.png$/, '')),
  };
  return isTile(tile) ? tile : null;
}

/** The person's organization: the one they belong to, or the one named when they have several. */
async function organizationOf(c: ApiContext, db: Database): Promise<string | null> {
  const memberships = await db.memberships(c.get('user').id);
  const named = c.req.query('organization_id');
  if (named !== undefined) {
    return memberships.some((m) => m.organizationId === named) ? named : null;
  }
  return memberships.length === 1 ? (memberships[0]?.organizationId ?? null) : null;
}

function written(c: ApiContext, result: MapLayerWrite) {
  switch (result.status) {
    case 'saved':
      return c.json({ id: result.id });
    case 'forbidden':
      return apiError(c, 403, 'FORBIDDEN', ADMINS_ONLY);
    case 'not_found':
      return apiError(c, 404, 'NOT_FOUND', 'This map layer was removed or is not yours.');
    case 'stale':
      return apiError(
        c,
        409,
        'STALE',
        'Someone changed this map layer meanwhile. Reload the page and try again.',
      );
  }
}

function serviceFailed(c: ApiContext, error: unknown, what: string) {
  if (!(error instanceof LayerServiceError)) throw error;
  console.warn(`Map layer ${what} not fetched: status=${String(error.status)}`);
  return apiError(
    c,
    502,
    'LAYER_SERVICE_FAILED',
    error.status === 413
      ? 'The map service sent more than the app takes at once.'
      : 'The map service could not be reached or did not answer as expected.',
  );
}

/** /api/v1/map-layers. Mounted after requireUser. */
export function mapLayerRoutes(openDatabase: DatabaseFactory) {
  const routes = new Hono<ApiEnv>();

  routes.get('/', (c) => {
    c.header('Cache-Control', 'no-store');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      const layers = await db.listMapLayers(ctx, org);
      if (layers === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      return c.json({ layers } satisfies MapLayerList);
    });
  });

  // What a web address offers, before an admin adds it: its kind, name, terms text and the
  // fields it can be coloured by, and the values of one of them.
  routes.post('/inspect', async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = await readJson(c, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const parsed = inspectLayerSchema.safeParse(body.value);
    if (!parsed.success) return apiError(c, 422, 'VALIDATION_FAILED', 'The request is malformed.');
    const source = parseLayerSource(parsed.data.url);
    if (!source.ok) return apiError(c, 422, 'NOT_A_LAYER', source.message);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      if (!(await db.isOrgAdmin(ctx, org))) return apiError(c, 403, 'FORBIDDEN', ADMINS_ONLY);
      const answer: LayerInspection = {
        kind: source.kind,
        url: source.url,
        wmsLayers: source.wmsLayers,
        title: null,
        copyright: null,
        fields: [],
        values: null,
        count: null,
        drawing: null,
      };
      if (source.kind === 'wms') return c.json(answer);
      try {
        const described = await describeArcgis(source.url);
        answer.title = described.title;
        answer.copyright = described.copyright;
        answer.drawing = described.drawing;
        if (source.kind === 'arcgis_features') {
          answer.fields = described.fields;
          const { field, alsoFields, onlyField, onlyValues } = parsed.data;
          const problem = sharedProblem(described.fields, {
            colourField: field,
            alsoFields,
            onlyField,
          });
          if (problem !== null || (field !== null && !described.fields.includes(field))) {
            return apiError(
              c,
              422,
              'VALIDATION_FAILED',
              problem ?? 'This layer has no such field.',
            );
          }
          const where = whereOf({ onlyField, onlyValues });
          // How many pieces it has, so a layer of one railroad is not taken for the whole
          // network (the owner's, 2026-11-07).
          answer.count = await arcgisCount(source.url, where);
          if (field !== null) {
            answer.values = await arcgisValueCounts(source.url, [field, ...alsoFields], where);
          }
        }
      } catch (error) {
        return serviceFailed(c, error, 'description');
      }
      return c.json(answer);
    });
  });

  // An ArcGIS map's item, for an admin adding its layers (F-138): its description or its data,
  // read from www.arcgis.com by the Worker and passed on as ArcGIS gives it. Only the item's id
  // comes from the browser; the address is always ArcGIS Online's own.
  routes.post('/arcgis-item', async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = await readJson(c, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const parsed = arcgisItemSchema.safeParse(body.value);
    if (!parsed.success) return apiError(c, 422, 'VALIDATION_FAILED', 'The request is malformed.');
    const { itemId, part } = parsed.data;
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      if (!(await db.isOrgAdmin(ctx, org))) return apiError(c, 403, 'FORBIDDEN', ADMINS_ONLY);
      try {
        const { body: json } = await fetchService(
          `${ARCGIS_ITEMS}/${itemId}${part === 'data' ? '/data' : ''}?f=json`,
          /^(application|text)\/(json|plain)$/,
          MAX_ITEM_BYTES,
        );
        return c.body(json, 200, {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        });
      } catch (error) {
        return serviceFailed(c, error, 'ArcGIS item');
      }
    });
  });

  routes.post('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = await readJson(c, MAX_CREATE_BYTES);
    if (!body.ok) return body.response;
    const parsed = createMapLayerSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiError(c, 422, 'VALIDATION_FAILED', 'Fill in the name, source, terms and colours.');
    }
    const input = parsed.data;
    const details = {
      name: input.name,
      sourceName: input.sourceName,
      termsUrl: input.termsUrl,
      termsNote: input.termsNote,
      colour: input.colour,
      colourField: input.colourField,
      colours: input.colourField === null ? [] : input.colours,
      alsoFields: input.alsoFields,
      onlyField: input.onlyField,
      onlyValues: input.onlyField === null ? [] : input.onlyValues,
      // As ArcGIS presents it (F-138); defaults for a layer added by hand.
      lineWidth: input.lineWidth,
      opacity: input.opacity,
      minZoom: input.minZoom,
      maxZoom: input.maxZoom,
      othersShown: input.othersShown,
      map: input.map,
    };
    if (
      details.minZoom !== null &&
      details.maxZoom !== null &&
      details.minZoom >= details.maxZoom
    ) {
      return apiError(c, 422, 'VALIDATION_FAILED', 'The zoom range is out of order.');
    }
    const shared = details.alsoFields.length > 0 || details.onlyField !== null;
    let layer: Parameters<Database['createMapLayer']>[2];
    if (input.source === 'web') {
      const source = parseLayerSource(input.url);
      if (!source.ok) return apiError(c, 422, 'NOT_A_LAYER', source.message);
      const wmsLayers = source.kind === 'wms' ? (input.wmsLayers ?? source.wmsLayers) : null;
      if (source.kind === 'wms' && wmsLayers === null) {
        return apiError(c, 422, 'VALIDATION_FAILED', 'Name the WMS layers to show.');
      }
      if (
        source.kind !== 'arcgis_features' &&
        (details.colourField !== null || shared || input.definitionExpression !== null)
      ) {
        return apiError(
          c,
          422,
          'VALIDATION_FAILED',
          'Only lines, areas and points take colours by field.',
        );
      }
      layer = {
        ...details,
        kind: source.kind,
        url: source.url,
        wmsLayers,
        idField: null,
        definitionExpression: input.definitionExpression,
        file: null,
      };
    } else {
      if (shared) {
        return apiError(
          c,
          422,
          'VALIDATION_FAILED',
          'Only a live ArcGIS layer takes these settings.',
        );
      }
      const checked = normalizeFeatureCollection(input.geojson);
      if (!checked.ok) return apiError(c, 422, 'NOT_A_LAYER', checked.message);
      const geojson = new TextEncoder().encode(JSON.stringify(checked.collection));
      if (geojson.byteLength > MAX_LAYER_FILE_BYTES) {
        return apiError(
          c,
          413,
          'FILE_TOO_LARGE',
          'This file is larger than 5 MB once read. Add a big national dataset by its web address instead.',
        );
      }
      layer = {
        ...details,
        kind: 'file',
        url: null,
        wmsLayers: null,
        idField: null,
        definitionExpression: null,
        file: {
          name: input.fileName,
          geojson,
          featureCount: checked.collection.features.length,
        },
      };
    }
    return withDatabase(c, openDatabase, async (db, ctx) => {
      // Who may add layers is checked before any web service is fetched (Codex's review of
      // 11c467e); the database checks it again when the layer is written.
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      if (!(await db.isOrgAdmin(ctx, org))) return apiError(c, 403, 'FORBIDDEN', ADMINS_ONLY);
      // An ArcGIS layer is read once now: it must answer, have the field it is coloured by,
      // and name its id field, which clicking a feature needs.
      if (layer.kind === 'arcgis_features' || layer.kind === 'arcgis_image') {
        try {
          const described = await describeArcgis(layer.url ?? '');
          if (layer.kind === 'arcgis_features') {
            layer = { ...layer, idField: described.idField };
            if (layer.colourField !== null && !described.fields.includes(layer.colourField)) {
              return apiError(c, 422, 'VALIDATION_FAILED', 'This layer has no such field.');
            }
            const problem = sharedProblem(described.fields, layer);
            if (problem !== null) return apiError(c, 422, 'VALIDATION_FAILED', problem);
            // The publisher's filter from its map is tried once, so one the service refuses is
            // never kept (F-138).
            if (layer.definitionExpression !== null) {
              await arcgisCount(layer.url ?? '', whereOf(layer));
            }
          }
        } catch (error) {
          return serviceFailed(c, error, 'description');
        }
      }
      const result = await db.createMapLayer(ctx, org, layer);
      return result.status === 'saved' ? c.json({ id: result.id }, 201) : written(c, result);
    });
  });

  routes.patch('/:id', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such map layer.');
    const body = await readJson(c, MAX_BODY_BYTES * 4);
    if (!body.ok) return body.response;
    const parsed = updateMapLayerSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiError(c, 422, 'VALIDATION_FAILED', 'Fill in the name, source, terms and colours.');
    }
    const { version, ...changes } = parsed.data;
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const current = await db.getMapLayerSource(ctx, id);
      if (current === null) return written(c, { status: 'not_found' });
      if ((current.kind === 'wms') !== (changes.wmsLayers !== null)) {
        return apiError(c, 422, 'VALIDATION_FAILED', 'Only a WMS layer names WMS layers.');
      }
      const onlyValues = changes.onlyField === null ? [] : changes.onlyValues;
      if (changes.alsoFields.length > 0 || changes.onlyField !== null) {
        if (current.kind !== 'arcgis_features' || current.url === null) {
          return apiError(
            c,
            422,
            'VALIDATION_FAILED',
            'Only a live ArcGIS layer takes these settings.',
          );
        }
        // The service is read only for an admin (Codex's review of 11c467e).
        if (!(await db.isOrgAdmin(ctx, current.organizationId))) {
          return apiError(c, 403, 'FORBIDDEN', ADMINS_ONLY);
        }
        try {
          const { fields } = await describeArcgis(current.url);
          const problem = sharedProblem(fields, changes);
          if (problem !== null) return apiError(c, 422, 'VALIDATION_FAILED', problem);
        } catch (error) {
          return serviceFailed(c, error, 'description');
        }
      }
      return written(
        c,
        await db.updateMapLayer(ctx, id, version, {
          ...changes,
          onlyValues,
          colours: changes.colourField === null ? [] : changes.colours,
        }),
      );
    });
  });

  // Removing keeps the layer (archived), never deletes it.
  routes.post('/:id/remove', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such map layer.');
    const body = await readJson(c, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const version = record(body.value)?.version;
    if (typeof version !== 'string' || version === '' || version.length > 100) {
      return apiError(c, 422, 'VALIDATION_FAILED', 'The request is malformed.');
    }
    return withDatabase(c, openDatabase, async (db, ctx) =>
      written(c, await db.removeMapLayer(ctx, id, version)),
    );
  });

  // A file layer's features, as kept.
  routes.get('/:id/file', (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such map layer.');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const file = await db.getMapLayerFile(ctx, id);
      if (file === null) return apiError(c, 404, 'NOT_FOUND', 'No such map layer.');
      const etag = `"${file.sha256}"`;
      c.header('Cache-Control', 'private, no-cache');
      c.header('ETag', etag);
      c.header('X-Content-Type-Options', 'nosniff');
      if (c.req.header('if-none-match') === etag) return c.body(null, 304);
      c.header('Content-Type', 'application/json');
      return c.body(file.geojson as Uint8Array<ArrayBuffer>, 200);
    });
  });

  // One map square of a live ArcGIS layer's lines, areas or points, simplified to its zoom.
  routes.get('/:id/features/:z/:x/:y', (c) => {
    const id = c.req.param('id');
    const tile = tileOf(c);
    if (!isUuid(id) || tile === null) return apiError(c, 404, 'NOT_FOUND', 'No such map square.');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const source = await db.getMapLayerSource(ctx, id);
      if (source?.kind !== 'arcgis_features' || source.url === null) {
        return apiError(c, 404, 'NOT_FOUND', 'No such map layer.');
      }
      let answer: { body: ArrayBuffer };
      try {
        answer = await fetchService(
          arcgisSquareUrl(source, tile),
          /^(application|text)\/(json|plain|geo\+json)$/,
          MAX_FEATURES_BYTES,
        );
      } catch (error) {
        return serviceFailed(c, error, 'square');
      }
      // ArcGIS reports its errors with status 200 and an "error" object.
      const start = new TextDecoder().decode(answer.body.slice(0, 64));
      if (!/^\s*\{\s*"(type|crs|features|properties)"/.test(start)) {
        return serviceFailed(c, new LayerServiceError(422), 'square');
      }
      c.header('Cache-Control', LIVE_CACHE);
      c.header('Content-Type', 'application/json');
      c.header('X-Content-Type-Options', 'nosniff');
      return c.body(answer.body, 200);
    });
  });

  // A live ArcGIS feature's own fields, when it is clicked.
  routes.get('/:id/details/:objectId', (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    const objectId = c.req.param('objectId');
    if (!isUuid(id) || !/^\d{1,12}$/.test(objectId)) {
      return apiError(c, 404, 'NOT_FOUND', 'No such feature.');
    }
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const source = await db.getMapLayerSource(ctx, id);
      if (source?.kind !== 'arcgis_features' || source.url === null) {
        return apiError(c, 404, 'NOT_FOUND', 'No such map layer.');
      }
      if (source.idField === null) return apiError(c, 404, 'NOT_FOUND', 'No such feature.');
      const params = new URLSearchParams({
        objectIds: objectId,
        outFields: '*',
        returnGeometry: 'false',
        f: 'json',
      });
      let body: Record<string, unknown> | null;
      try {
        body = record(await fetchJson(`${source.url}/query?${params.toString()}`));
      } catch (error) {
        return serviceFailed(c, error, 'details');
      }
      const first: unknown = Array.isArray(body?.features) ? body.features[0] : undefined;
      const attributes = record(record(first)?.attributes);
      if (!attributes) return apiError(c, 404, 'NOT_FOUND', 'No such feature.');
      const fields: [string, string | number | boolean][] = [];
      for (const [name, value] of Object.entries(attributes)) {
        if (fields.length >= 60) break;
        if (typeof value === 'number' || typeof value === 'boolean') fields.push([name, value]);
        else if (typeof value === 'string' && value.trim() !== '') {
          fields.push([name, value.slice(0, 500)]);
        }
      }
      return c.json({ fields });
    });
  });

  // A zoomed-out view (F-134): how many pieces the layer has, for an admin preparing one.
  routes.get('/:id/count', (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such map layer.');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const source = await overviewSource(c, db, ctx, id);
      if (source instanceof Response) return source;
      let count: number;
      try {
        count = await arcgisCount(source.url ?? '', whereOf(source));
      } catch (error) {
        return serviceFailed(c, error, 'count');
      }
      if (count > MAX_OVERVIEW_SOURCE) {
        return apiError(
          c,
          422,
          'TOO_LARGE_FOR_OVERVIEW',
          `This layer has ${count.toLocaleString('en-CA')} pieces; a zoomed-out view takes at most ${MAX_OVERVIEW_SOURCE.toLocaleString('en-CA')}.`,
        );
      }
      return c.json({ count, pageSize: OVERVIEW_PAGE_SIZE });
    });
  });

  // One page of the whole layer in ArcGIS's compact format, for an admin's browser to read.
  routes.get('/:id/pages/:offset', (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    const offset = Number(c.req.param('offset'));
    if (!isUuid(id) || !Number.isInteger(offset) || offset < 0 || offset > MAX_OVERVIEW_SOURCE) {
      return apiError(c, 404, 'NOT_FOUND', 'No such page.');
    }
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const source = await overviewSource(c, db, ctx, id);
      if (source instanceof Response) return source;
      let answer: { body: ArrayBuffer };
      try {
        answer = await fetchService(overviewPageUrl(source, offset), PBF, MAX_PAGE_BYTES);
      } catch (error) {
        return serviceFailed(c, error, 'page');
      }
      c.header('Content-Type', 'application/x-protobuf');
      c.header('X-Content-Type-Options', 'nosniff');
      return c.body(answer.body, 200);
    });
  });

  // One part of the zoomed-out view an admin's browser prepared, checked again here. The view
  // comes in parts of about 100 KB so each is checked within Cloudflare's free plan's limit on
  // computing per request (the whole view takes about 115 ms to check).
  routes.put('/:id/overview/:version/:part', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    const version = c.req.param('version');
    const partNo = Number(c.req.param('part'));
    if (!isUuid(id) || !isUuid(version) || !Number.isInteger(partNo) || partNo < 0 || partNo > 63) {
      return apiError(c, 404, 'NOT_FOUND', 'No such part.');
    }
    const body = await readJson(c, MAX_PART_BYTES);
    if (!body.ok) return body.response;
    const parsed = overviewPartSchema.safeParse(body.value);
    if (!parsed.success) return apiError(c, 422, 'VALIDATION_FAILED', 'The request is malformed.');
    const checked = normalizeFeatureCollection({
      type: 'FeatureCollection',
      features: parsed.data.features,
    });
    if (!checked.ok) return apiError(c, 422, 'NOT_A_LAYER', checked.message);
    const features = new TextEncoder().encode(JSON.stringify(checked.collection.features));
    if (features.byteLength > MAX_STORED_PART_BYTES) {
      return apiError(c, 413, 'PART_TOO_LARGE', 'This part of the zoomed-out view is too large.');
    }
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.saveMapLayerOverviewPart(ctx, id, {
        version,
        partNo,
        features,
        featureCount: checked.collection.features.length,
      });
      if (result.status === 'sealed') {
        return apiError(
          c,
          409,
          'SEALED',
          'This zoomed-out view is already published. Prepare it again to change it.',
        );
      }
      return written(c, result);
    });
  });

  // Publishes a view once every part has arrived. The layer's colour field is checked again in
  // the same transaction as the publishing (Codex's review of 8e0fd95).
  routes.post('/:id/overview/:version/publish', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    const version = c.req.param('version');
    if (!isUuid(id) || !isUuid(version)) return apiError(c, 404, 'NOT_FOUND', 'No such view.');
    const body = await readJson(c, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const parsed = publishOverviewSchema.safeParse(body.value);
    if (!parsed.success) return apiError(c, 422, 'VALIDATION_FAILED', 'The request is malformed.');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.publishMapLayerOverview(ctx, id, { version, ...parsed.data });
      if (result.status === 'incomplete') {
        return apiError(
          c,
          409,
          'INCOMPLETE',
          'Parts of the zoomed-out view did not arrive. Prepare it again.',
        );
      }
      return written(c, result);
    });
  });

  // A layer's published zoomed-out view, its parts put together as one GeoJSON document.
  routes.get('/:id/overview', (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such map layer.');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const overview = await db.getMapLayerOverview(ctx, id);
      if (overview === null) return apiError(c, 404, 'NOT_FOUND', 'No zoomed-out view.');
      const etag = `"${overview.version}"`;
      c.header('Cache-Control', 'private, no-cache');
      c.header('ETag', etag);
      c.header('X-Content-Type-Options', 'nosniff');
      if (c.req.header('if-none-match') === etag) return c.body(null, 304);
      c.header('Content-Type', 'application/json');
      return c.body(joinParts(overview.parts), 200);
    });
  });

  // One map square's picture of an ArcGIS map or a WMS service.
  routes.get('/:id/tiles/:z/:x/:y', (c) => {
    const id = c.req.param('id');
    const tile = tileOf(c);
    if (!isUuid(id) || tile === null) return apiError(c, 404, 'NOT_FOUND', 'No such map square.');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const source = await db.getMapLayerSource(ctx, id);
      if ((source?.kind !== 'arcgis_image' && source?.kind !== 'wms') || source.url === null) {
        return apiError(c, 404, 'NOT_FOUND', 'No such map layer.');
      }
      let answer: { body: ArrayBuffer; type: string };
      try {
        answer = await fetchService(
          pictureUrl(source, tile),
          /^image\/(png|jpeg)$/,
          MAX_PICTURE_BYTES,
        );
      } catch (error) {
        return serviceFailed(c, error, 'picture');
      }
      c.header('Cache-Control', LIVE_CACHE);
      c.header('Content-Type', answer.type);
      c.header('X-Content-Type-Options', 'nosniff');
      return c.body(answer.body, 200);
    });
  });

  return routes;
}
