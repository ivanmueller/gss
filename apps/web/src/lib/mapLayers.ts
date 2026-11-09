import {
  FILE_COLOUR_FIELDS,
  normalizeFeatureCollection,
  OVERVIEW_BELOW_ZOOM,
  cleanValue,
  groupingOf,
  type LayerGrouping,
  valuesOf,
  VALUES_PROPERTY,
  tilesForView,
  type Bbox,
  type FeatureCollectionResult,
  type MapLayerView,
  type Tile,
} from '@grain/domain';
import type { ExpressionSpecification, FilterSpecification } from 'mapbox-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { apiFetch } from './api';
import { signedInAs } from './useApiResource';

// Map layers in the browser (F-107): reading a file an admin adds, the colours a layer is
// drawn in, which layers each person has switched on, and the features of the layers that are
// on, fetched from the API (a file once, a live layer one map square at a time).

/** The largest file read in the browser, before it is turned into GeoJSON and checked. */
export const MAX_RAW_FILE_BYTES = 50 * 1024 * 1024;

export type LayerFileResult = FeatureCollectionResult | { ok: false; message: string };

/** The features of a whole shapefile (shpjs gives one collection per layer in a zip). */
function mergeCollections(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return {
    type: 'FeatureCollection',
    features: value.flatMap((part: { features?: unknown }) =>
      Array.isArray(part.features) ? (part.features as unknown[]) : [],
    ),
  };
}

/**
 * A file chosen by an admin, read as GeoJSON and checked: GeoJSON (.geojson, .json), KML
 * (.kml) or a zipped shapefile (.zip, with its .prj so it is turned into longitude and
 * latitude). The readers are fetched only when needed.
 */
export async function readLayerFile(file: File): Promise<LayerFileResult> {
  if (file.size > MAX_RAW_FILE_BYTES) {
    return {
      ok: false,
      message:
        'This file is larger than 50 MB. Add a big national dataset by its web address instead.',
    };
  }
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith('.geojson') || name.endsWith('.json')) {
      return normalizeFeatureCollection(JSON.parse(await file.text()) as unknown);
    }
    if (name.endsWith('.kml')) {
      const { kml } = await import('@tmcw/togeojson');
      const doc = new DOMParser().parseFromString(await file.text(), 'text/xml');
      if (doc.getElementsByTagName('parsererror').length > 0) {
        return { ok: false, message: 'This KML file could not be read.' };
      }
      return normalizeFeatureCollection(kml(doc));
    }
    if (name.endsWith('.zip')) {
      const { default: shp } = await import('shpjs');
      return normalizeFeatureCollection(mergeCollections(await shp(await file.arrayBuffer())));
    }
    if (name.endsWith('.kmz')) {
      return { ok: false, message: 'Unzip the .kmz file and choose the .kml file inside it.' };
    }
  } catch {
    return { ok: false, message: 'This file could not be read. Check it opens in a map program.' };
  }
  return {
    ok: false,
    message: 'Choose a GeoJSON (.geojson), KML (.kml) or zipped shapefile (.zip) file.',
  };
}

/** Whether a file gives its own colours (KML styles, or stroke, fill and marker-color). */
export function hasFileColours(result: LayerFileResult): boolean {
  return (
    result.ok &&
    result.collection.features.some((f) => FILE_COLOUR_FIELDS.some((key) => key in f.properties))
  );
}

/**
 * The colour of each feature: by the layer's field, a colour per value (each railroad its own),
 * else the colour the file gives it, else the layer's colour.
 */
export function colourExpression(
  layer: Pick<MapLayerView, 'colour' | 'colourField' | 'colours' | 'kind'> & {
    alsoFields?: readonly string[];
  },
  choice?: ValueChoice,
): ExpressionSpecification | string {
  if (layer.colourField !== null && layer.colours.length > 0) {
    const byOwner: ExpressionSpecification = [
      'match',
      ['to-string', ['get', layer.colourField]],
      ...layer.colours.flat(),
      layer.colour,
    ] as ExpressionSpecification;
    // With only some values shown, a line shared with one of them (CPKC on Union Pacific
    // track) takes the shown value's colour, so a railroad's route is one colour as on ArcGIS
    // (the owner's answer of 2026-11-08, F-137).
    if ((layer.alsoFields?.length ?? 0) > 0 && choice?.shown) {
      const shown = new Set(choice.shown);
      const cases = layer.colours
        .filter(([value]) => shown.has(value))
        .flatMap(([value, colour]) => [
          ['in', `|${value}|`, ['to-string', ['get', VALUES_PROPERTY]]],
          colour,
        ]);
      if (cases.length > 0) return ['case', ...cases, byOwner] as ExpressionSpecification;
    }
    return byOwner;
  }
  if (layer.kind === 'file') {
    return [
      'case',
      ['has', 'stroke'],
      ['to-color', ['get', 'stroke'], layer.colour],
      ['has', 'fill'],
      ['to-color', ['get', 'fill'], layer.colour],
      ['has', 'marker-color'],
      ['to-color', ['get', 'marker-color'], layer.colour],
      layer.colour,
    ];
  }
  return layer.colour;
}

/**
 * How a layer is drawn as ArcGIS presents it (F-138): its line width in screen pixels (null:
 * GSS's usual, widening with the zoom), opacity and the zooms it shows between.
 */
export interface OverlayLook {
  lineWidth: number | null;
  opacity: number;
  minZoom: number | null;
  maxZoom: number | null;
}

/** GSS's usual look, for layers added by hand. */
export const USUAL_LOOK: OverlayLook = {
  lineWidth: null,
  opacity: 1,
  minZoom: null,
  maxZoom: null,
};

/** A layer's look: ArcGIS's line width is in points, 4/3 of a pixel each. */
export function lookOf(
  layer: Pick<MapLayerView, 'lineWidth' | 'opacity' | 'minZoom' | 'maxZoom' | 'map'>,
): OverlayLook {
  if (
    layer.map === null &&
    layer.lineWidth === null &&
    layer.opacity === 1 &&
    layer.minZoom === null &&
    layer.maxZoom === null
  ) {
    return USUAL_LOOK;
  }
  return {
    lineWidth: layer.lineWidth === null ? null : Math.round(layer.lineWidth * (4 / 3) * 100) / 100,
    opacity: layer.opacity,
    minZoom: layer.minZoom,
    maxZoom: layer.maxZoom,
  };
}

/** A layer as FacilityMap draws it. */
export type MapOverlay =
  | {
      id: string;
      kind: 'features';
      data: GeoJSON.FeatureCollection;
      colour: ExpressionSpecification | string;
      /** The values the person shows (F-133); null: all. */
      filter?: FilterSpecification | null;
      look?: OverlayLook;
    }
  | {
      id: string;
      kind: 'pictures';
      tiles: string;
      look?: OverlayLook;
      /** A pre-drawn layer's levels: no squares asked below, the last enlarged above (F-141). */
      levels?: { min: number; max: number } | null;
    };

/** The property FacilityMap reads to say which feature of a live layer was clicked. */
export const OBJECT_ID = '__gss_object_id';

/** A feature clicked on a layer. */
export interface PickedFeature {
  layerId: string;
  properties: Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------------
// Which layers each person has on

const STORAGE_PREFIX = 'gss.mapLayers.';

function readChoice(key: string): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The layers this person has switched on, remembered in this browser only (a convenience:
 * without it, every layer starts off).
 */
export function useLayerChoice(
  token: string,
): [ReadonlySet<string>, (id: string) => void, (ids: readonly string[], on: boolean) => void] {
  const key = `${STORAGE_PREFIX}${signedInAs(token)}`;
  const [chosen, setChosen] = useState<{ key: string; ids: string[] }>(() => ({
    key,
    ids: readChoice(key),
  }));
  const ids = chosen.key === key ? chosen.ids : readChoice(key);
  const toggle = useCallback(
    (id: string) => {
      setChosen((current) => {
        const before = current.key === key ? current.ids : readChoice(key);
        const next = before.includes(id) ? before.filter((v) => v !== id) : [...before, id];
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // Storage refused (private window): the choice lasts until the page is closed.
        }
        return { key, ids: next };
      });
    },
    [key],
  );
  /** Switches several layers on or off at once (a map's layers, F-138). */
  const setMany = useCallback(
    (many: readonly string[], on: boolean) => {
      setChosen((current) => {
        const before = current.key === key ? current.ids : readChoice(key);
        const next = on
          ? [...before, ...many.filter((id) => !before.includes(id))]
          : before.filter((id) => !many.includes(id));
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // Storage refused (private window): the choice lasts until the page is closed.
        }
        return { key, ids: next };
      });
    },
    [key],
  );
  return [useMemo(() => new Set(ids), [ids]), toggle, setMany];
}

// ---------------------------------------------------------------------------------------------
// Fetching the features of the layers that are on

export interface MapView {
  bbox: Bbox;
  zoom: number;
}

type Square = { features: GeoJSON.Feature[]; exceeded: boolean } | 'failed';

/** The most map squares kept in memory, across layers and zooms. */
const MAX_KEPT_SQUARES = 600;

function picturesUrl(id: string): string {
  return `${window.location.origin}/api/v1/map-layers/${id}/tiles/{z}/{x}/{y}.png`;
}

/** Whether a request to this address carries the person's sign-in (FacilityMap's pictures). */
export function isLayerPictureUrl(url: string): boolean {
  return url.startsWith(`${window.location.origin}/api/v1/map-layers/`);
}

function asCollection(value: unknown): { features: GeoJSON.Feature[]; exceeded: boolean } | null {
  if (typeof value !== 'object' || value === null) return null;
  const body = value as {
    features?: unknown;
    properties?: { exceededTransferLimit?: unknown };
    exceededTransferLimit?: unknown;
  };
  if (!Array.isArray(body.features)) return null;
  return {
    features: body.features as GeoJSON.Feature[],
    exceeded:
      body.properties?.exceededTransferLimit === true || body.exceededTransferLimit === true,
  };
}

/** A live feature with its values from every field that counts (F-137), as views carry them. */
function withValues(
  feature: GeoJSON.Feature,
  colourField: string | null,
  fields: readonly string[] | null,
): GeoJSON.Feature {
  const original = feature.properties ?? {};
  const properties: Record<string, unknown> = { ...original };
  // The colour field's value tidied as in a checked view, so it colours and filters the same at
  // every zoom; its values from the original properties, as a view builds them (Codex's review
  // of 2693859).
  if (colourField !== null && colourField in properties) {
    properties[colourField] = cleanValue(original[colourField]) || null;
  }
  if (fields !== null) properties[VALUES_PROPERTY] = valuesOf(original, fields);
  return { ...feature, properties };
}

/** A live feature, marked with its id (ArcGIS's object id) to ask for its details. */
function withObjectId(feature: GeoJSON.Feature): GeoJSON.Feature {
  const id = feature.id;
  return typeof id === 'number' || typeof id === 'string'
    ? { ...feature, properties: { ...feature.properties, [OBJECT_ID]: id } }
    : feature;
}

// ---------------------------------------------------------------------------------------------
// Which values of a layer each person shows (each railroad on or off, F-133)

/** The values of a layer a person shows: null shows every value. */
export interface ValueChoice {
  /** The values shown; null: all of them. */
  shown: string[] | null;
  /** Whether values without a colour of their own (rare ones, or none) are shown. */
  others: boolean;
}

export const ALL_VALUES: ValueChoice = { shown: null, others: true };

/**
 * A person's choice of a layer's values, or the layer's own until they choose: every value, and
 * values without a colour of their own only when the layer draws them (ArcGIS draws none when
 * its symbols have no default, F-138).
 */
export function choiceOf(
  layer: Pick<MapLayerView, 'id' | 'othersShown'>,
  choices: Readonly<Record<string, ValueChoice>>,
): ValueChoice {
  return choices[layer.id] ?? (layer.othersShown ? ALL_VALUES : { shown: null, others: false });
}

const VALUES_PREFIX = 'gss.mapLayerValues.';

function readValues(key: string): Record<string, ValueChoice> {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? '{}');
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    const out: Record<string, ValueChoice> = {};
    for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
      const choice = raw as { shown?: unknown; others?: unknown };
      const shown = Array.isArray(choice.shown)
        ? choice.shown.filter((v): v is string => typeof v === 'string')
        : null;
      out[id] = { shown, others: choice.others !== false };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Each layer's values this person shows, remembered in this browser only (a convenience:
 * without it, every value is shown).
 */
export function useValueChoices(
  token: string,
): [
  Readonly<Record<string, ValueChoice>>,
  (id: string, choice: ValueChoice, layerDefault?: ValueChoice) => void,
] {
  const key = `${VALUES_PREFIX}${signedInAs(token)}`;
  const [state, setState] = useState<{ key: string; choices: Record<string, ValueChoice> }>(() => ({
    key,
    choices: readValues(key),
  }));
  const choices = state.key === key ? state.choices : readValues(key);
  const set = useCallback(
    (id: string, choice: ValueChoice, layerDefault: ValueChoice = ALL_VALUES) => {
      setState((current) => {
        const before = current.key === key ? current.choices : readValues(key);
        // Forgotten only when it is the layer's own choice: "every value and other values" is
        // kept for a layer that hides other values by default (Codex's review of 1f328f9).
        const all =
          choice.shown === null &&
          layerDefault.shown === null &&
          choice.others === layerDefault.others;
        const next = Object.fromEntries(
          Object.entries(before).filter(([layer]) => layer !== id || !all),
        );
        if (!all) next[id] = choice;
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // Storage refused (private window): the choice lasts until the page is closed.
        }
        return { key, choices: next };
      });
    },
    [key],
  );
  return [choices, set];
}

/** Whether a value is shown under a person's choice. */
export function valueShown(choice: ValueChoice, value: string): boolean {
  return choice.shown === null || choice.shown.includes(value);
}

/**
 * The map filter for a person's choice of a layer's values; null shows everything. Values with a
 * colour of their own are shown when chosen; the rest when "Other values" is on.
 */
export function valueFilter(
  layer: Pick<MapLayerView, 'colourField' | 'colours'> & { alsoFields?: readonly string[] },
  choice: ValueChoice | undefined,
): FilterSpecification | null {
  if (!choice || layer.colourField === null || layer.colours.length === 0) return null;
  if (choice.shown === null && choice.others) return null;
  const value: ExpressionSpecification = ['to-string', ['get', layer.colourField]];
  const listed = layer.colours.map(([v]) => v);
  const shown = choice.shown ?? listed;
  const parts: ExpressionSpecification[] = [];
  if (shown.length > 0 && (layer.alsoFields?.length ?? 0) > 0) {
    // A line counts for every value of its fields: owners and trackage rights (F-137).
    const values: ExpressionSpecification = ['to-string', ['get', VALUES_PROPERTY]];
    parts.push(['any', ...shown.map((v): ExpressionSpecification => ['in', `|${v}|`, values])]);
  } else if (shown.length > 0) parts.push(['in', value, ['literal', shown]]);
  if (choice.others) parts.push(['!', ['in', value, ['literal', listed]]]);
  const [only, ...more] = parts;
  if (!only) return ['boolean', false];
  return more.length === 0 ? only : ['any', only, ...more];
}

// ---------------------------------------------------------------------------------------------
// The features of the layers that are on

/**
 * A short tag of the settings a live layer's squares are fetched under (groupingOf: colour field,
 * fields that also count, limit): squares fetched under other settings are never reused (Codex's
 * review of bb488a9).
 */
export function settingsTag(layer: LayerGrouping): string {
  // The settings themselves, not a hash of them: two different filters could share a short hash
  // and reuse each other's squares (Codex's review of da6c543). A few hundred characters at most.
  return encodeURIComponent(groupingOf(layer));
}

/** Where a live layer's square is kept: the layer, its settings and the square. */
function squareKey(layer: MapLayerView, tile: { z: number; x: number; y: number }): string {
  return `${layer.id}@${settingsTag(layer)}/${String(tile.z)}/${String(tile.x)}/${String(tile.y)}`;
}

/** Whether a live layer has a zoomed-out view prepared under its current settings (F-134). */
export function hasOverview(layer: MapLayerView): boolean {
  return (
    layer.kind === 'arcgis_features' &&
    layer.overview !== null &&
    layer.overview.grouping === groupingOf(layer)
  );
}

/** Whether a live layer is drawn from its zoomed-out view at this zoom (F-134). */
export function usesOverview(layer: MapLayerView, zoom: number | null): boolean {
  return hasOverview(layer) && zoom !== null && zoom < OVERVIEW_BELOW_ZOOM;
}

/**
 * Below this zoom a live layer whose squares the service cut short (too many pieces in one
 * square) is drawn whole from its zoomed-out view, so no lines go missing (F-140).
 */
export const OVERVIEW_WHEN_CUT_BELOW_ZOOM = 10;

/** Whether two map squares overlap: one holds the other, whatever their zooms. */
export function squaresOverlap(a: Tile, b: Tile): boolean {
  const z = Math.min(a.z, b.z);
  const up = (tile: Tile, axis: number) => Math.floor(axis / 2 ** (tile.z - z));
  return up(a, a.x) === up(b, b.x) && up(a, a.y) === up(b, b.y);
}

/**
 * Whether loaded squares (as "z/x/y") cover all of a square: it or a wider square holding it is
 * loaded, or each of its four quarters is covered, down to four levels finer.
 */
export function squareCovered(tile: Tile, loaded: ReadonlySet<string>, depth = 0): boolean {
  for (let z = tile.z; z >= 0; z -= 1) {
    const up = 2 ** (tile.z - z);
    if (
      loaded.has(
        `${String(z)}/${String(Math.floor(tile.x / up))}/${String(Math.floor(tile.y / up))}`,
      )
    ) {
      return true;
    }
  }
  if (depth >= 4) return false;
  const z = tile.z + 1;
  return [0, 1].every((dx) =>
    [0, 1].every((dy) =>
      squareCovered({ z, x: tile.x * 2 + dx, y: tile.y * 2 + dy }, loaded, depth + 1),
    ),
  );
}

/** A square's place from its key (layer@settings/z/x/y). */
function tileOfKey(key: string): Tile | null {
  const parts = key.split('/').slice(-3).map(Number);
  const [z, x, y] = parts;
  return z !== undefined && x !== undefined && y !== undefined && parts.every(Number.isInteger)
    ? { z, x, y }
    : null;
}

/** Whether a layer shows at this zoom (its ArcGIS scale range, F-138); unknown zoom: yes. */
export function shownAtZoom(
  layer: Pick<MapLayerView, 'minZoom' | 'maxZoom'>,
  zoom: number | null,
): boolean {
  if (zoom === null) return true;
  return (
    (layer.minZoom === null || zoom >= layer.minZoom) &&
    (layer.maxZoom === null || zoom < layer.maxZoom)
  );
}

/**
 * The overlays for the layers that are on, in the list's order, each with the person's choice of
 * its values, and a note per layer when part of it could not be shown. A live layer is drawn
 * from its zoomed-out view below zoom 7 when it has one, else one map square at a time.
 */
export function useLayerOverlays(
  layers: readonly MapLayerView[],
  view: MapView | null,
  token: string,
  choices: Readonly<Record<string, ValueChoice>> = {},
): { overlays: MapOverlay[]; notes: Map<string, string> } {
  const [files, setFiles] = useState<Map<string, GeoJSON.FeatureCollection | 'failed'>>(
    () => new Map(),
  );
  const [squares, setSquares] = useState<Map<string, Square>>(() => new Map());
  const asked = useRef(new Set<string>());

  const tiles = useMemo(() => (view ? tilesForView(view.bbox, view.zoom) : []), [view]);
  const zoom = view?.zoom ?? null;

  useEffect(() => {
    /** A whole GeoJSON document, fetched once per version and kept under `id`. */
    const fetchWhole = (id: string, key: string, path: string) => {
      if (asked.current.has(key)) return;
      asked.current.add(key);
      apiFetch(path, token)
        .then((res) => res.json())
        .then((body: unknown) => {
          const collection = asCollection(body);
          // Numbered afresh: a view sent in parts repeats its parts' numbers, and the map tells
          // lines apart by them.
          const features = collection?.features.map((feature, i) => ({ ...feature, id: i + 1 }));
          setFiles((current) =>
            new Map(current).set(id, features ? { type: 'FeatureCollection', features } : 'failed'),
          );
        })
        .catch(() => {
          asked.current.delete(key);
          setFiles((current) => new Map(current).set(id, 'failed'));
        });
    };
    for (const layer of layers) {
      // Nothing is fetched for a layer out of its zoom range (F-138).
      if (!shownAtZoom(layer, zoom)) continue;
      if (layer.kind === 'file') {
        fetchWhole(layer.id, `${layer.id}@${layer.version}`, `/map-layers/${layer.id}/file`);
      } else if (layer.kind === 'arcgis_features') {
        // The zoomed-out view is fetched once, at any zoom, so it is ready to fill in while
        // squares load and when zooming out (F-140: no blank map between zooms).
        if (hasOverview(layer)) {
          fetchWhole(
            `${layer.id}#overview`,
            `${layer.id}#overview@${layer.overview?.version ?? ''}`,
            `/map-layers/${layer.id}/overview`,
          );
        }
        if (usesOverview(layer, zoom)) continue;
        for (const tile of tiles) {
          const key = squareKey(layer, tile);
          if (asked.current.has(key)) continue;
          asked.current.add(key);
          // The settings in the address too, so the browser's cached square (an hour) is not
          // reused after they change (Codex's review of bb488a9).
          const path = `/map-layers/${layer.id}/features/${String(tile.z)}/${String(tile.x)}/${String(tile.y)}?g=${settingsTag(layer)}`;
          apiFetch(path, token)
            .then((res) => res.json())
            .then((body: unknown) => {
              const collection = asCollection(body);
              setSquares((current) => {
                const next = new Map(current).set(key, collection ?? 'failed');
                // Keeps memory in check: the oldest squares go first.
                while (next.size > MAX_KEPT_SQUARES) {
                  const oldest = next.keys().next().value;
                  if (oldest === undefined) break;
                  next.delete(oldest);
                  asked.current.delete(oldest);
                }
                return next;
              });
            })
            .catch(() => {
              // Asked again at the next move of the map.
              asked.current.delete(key);
              setSquares((current) => new Map(current).set(key, 'failed'));
            });
        }
      }
    }
  }, [layers, tiles, zoom, token]);

  return useMemo(() => {
    const overlays: MapOverlay[] = [];
    const notes = new Map<string, string>();
    for (const layer of layers) {
      if (layer.kind === 'arcgis_image' || layer.kind === 'arcgis_tiles' || layer.kind === 'wms') {
        overlays.push({
          id: layer.id,
          kind: 'pictures',
          tiles: picturesUrl(layer.id),
          look: lookOf(layer),
          levels: layer.tileLevels,
        });
        continue;
      }
      const choice = choiceOf(layer, choices);
      const colour = colourExpression(layer, choice);
      const filter = valueFilter(layer, choice);
      const look = lookOf(layer);
      const fields = [layer.colourField ?? '', ...layer.alsoFields];
      const whole = (data: GeoJSON.FeatureCollection | 'failed' | undefined) => {
        if (data === 'failed') notes.set(layer.id, 'This layer could not be loaded.');
        else if (data)
          overlays.push({ id: layer.id, kind: 'features', data, colour, filter, look });
      };
      if (layer.kind === 'file') {
        whole(files.get(layer.id));
        continue;
      }
      // What a live layer draws (F-140, the owner's report of 2026-11-08: lines came and went
      // while zooming, unlike ArcGIS). Never a blank while squares load: a square not yet here is
      // filled in by squares already loaded at other zooms over the same place; where none is,
      // or below zoom 7, or below zoom 10 where the service cut squares short, the zoomed-out
      // view is drawn whole when it is ready.
      const overview = hasOverview(layer) ? files.get(`${layer.id}#overview`) : undefined;
      const overviewReady = overview !== undefined && overview !== 'failed';
      if (overviewReady && usesOverview(layer, zoom)) {
        whole(overview);
        continue;
      }
      const prefix = `${layer.id}@${settingsTag(layer)}/`;
      const seen = new Set<string | number>();
      const features: GeoJSON.Feature[] = [];
      let exceeded = false;
      let failed = false;
      let uncovered = 0;
      const add = (square: { features: GeoJSON.Feature[] }) => {
        for (const feature of square.features) {
          const marked = withValues(
            withObjectId(feature),
            layer.colourField,
            layer.alsoFields.length > 0 ? fields : null,
          );
          const id = marked.properties?.[OBJECT_ID] as string | number | undefined;
          if (id !== undefined) {
            if (seen.has(id)) continue;
            seen.add(id);
          }
          features.push(marked);
        }
      };
      // The squares of this zoom first: finer, and each feature taken once.
      const missing: Tile[] = [];
      for (const tile of tiles) {
        const square = usesOverview(layer, zoom) ? undefined : squares.get(squareKey(layer, tile));
        if (square === undefined) {
          missing.push(tile);
          continue;
        }
        if (square === 'failed') {
          // Filled in like one still loading (Codex's review of 4026e22: a failed square blanked
          // its place though other lines were loaded).
          failed = true;
          missing.push(tile);
          continue;
        }
        exceeded ||= square.exceeded;
        add(square);
      }
      // Then, for the squares still loading, those already loaded at the nearest other zooms.
      if (missing.length > 0) {
        const loaded: { tile: Tile; square: { features: GeoJSON.Feature[] } }[] = [];
        for (const [key, square] of squares) {
          if (!key.startsWith(prefix) || square === 'failed') continue;
          const tile = tileOfKey(key);
          if (tile) loaded.push({ tile, square });
        }
        const near = (tile: Tile) => Math.abs(tile.z - (missing[0]?.z ?? tile.z));
        loaded.sort((a, b) => near(a.tile) - near(b.tile));
        const have = new Set(
          loaded.map((l) => `${String(l.tile.z)}/${String(l.tile.x)}/${String(l.tile.y)}`),
        );
        for (const tile of missing) {
          const over = loaded.filter((l) => squaresOverlap(l.tile, tile));
          // Covered only when the loaded squares cover all of it, not just a part (Codex's review
          // of 4026e22: zooming out from one square left three quarters of the wider one empty).
          if (!squareCovered(tile, have)) uncovered += 1;
          for (const l of over) add(l.square);
        }
      }
      if (
        overviewReady &&
        (uncovered > 0 || (exceeded && zoom !== null && zoom < OVERVIEW_WHEN_CUT_BELOW_ZOOM))
      ) {
        whole(overview);
        continue;
      }
      overlays.push({
        id: layer.id,
        kind: 'features',
        data: { type: 'FeatureCollection', features },
        colour,
        filter,
        look,
      });
      if (failed)
        notes.set(layer.id, 'Part of this layer could not be loaded. Move the map to try again.');
      else if (exceeded) {
        notes.set(
          layer.id,
          layer.overview === null
            ? 'Zoom in to see every line here. An admin can prepare its zoomed-out view on Team → Map layers.'
            : 'Zoom in to see every line here.',
        );
      }
    }
    return { overlays, notes };
  }, [layers, files, squares, tiles, zoom, choices]);
}
