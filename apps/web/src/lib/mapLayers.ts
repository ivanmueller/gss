import {
  FILE_COLOUR_FIELDS,
  normalizeFeatureCollection,
  tilesForView,
  type Bbox,
  type FeatureCollectionResult,
  type MapLayerView,
} from '@grain/domain';
import type { ExpressionSpecification } from 'mapbox-gl';
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
  layer: Pick<MapLayerView, 'colour' | 'colourField' | 'colours' | 'kind'>,
): ExpressionSpecification | string {
  if (layer.colourField !== null && layer.colours.length > 0) {
    return [
      'match',
      ['to-string', ['get', layer.colourField]],
      ...layer.colours.flat(),
      layer.colour,
    ] as ExpressionSpecification;
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

/** A layer as FacilityMap draws it. */
export type MapOverlay =
  | {
      id: string;
      kind: 'features';
      data: GeoJSON.FeatureCollection;
      colour: ExpressionSpecification | string;
    }
  | { id: string; kind: 'pictures'; tiles: string };

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
export function useLayerChoice(token: string): [ReadonlySet<string>, (id: string) => void] {
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
  return [useMemo(() => new Set(ids), [ids]), toggle];
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

/** A live feature, marked with its id (ArcGIS's object id) to ask for its details. */
function withObjectId(feature: GeoJSON.Feature): GeoJSON.Feature {
  const id = feature.id;
  return typeof id === 'number' || typeof id === 'string'
    ? { ...feature, properties: { ...feature.properties, [OBJECT_ID]: id } }
    : feature;
}

/**
 * The overlays for the layers that are on, in the list's order, and a note per layer when part
 * of it could not be shown (too many features at this zoom, or a square that failed).
 */
export function useLayerOverlays(
  layers: readonly MapLayerView[],
  view: MapView | null,
  token: string,
): { overlays: MapOverlay[]; notes: Map<string, string> } {
  const [files, setFiles] = useState<Map<string, GeoJSON.FeatureCollection | 'failed'>>(
    () => new Map(),
  );
  const [squares, setSquares] = useState<Map<string, Square>>(() => new Map());
  const asked = useRef(new Set<string>());

  const tiles = useMemo(() => (view ? tilesForView(view.bbox, view.zoom) : []), [view]);

  useEffect(() => {
    for (const layer of layers) {
      if (layer.kind === 'file') {
        const key = `${layer.id}@${layer.version}`;
        if (asked.current.has(key)) continue;
        asked.current.add(key);
        apiFetch(`/map-layers/${layer.id}/file`, token)
          .then((res) => res.json())
          .then((body: unknown) => {
            const collection = asCollection(body);
            setFiles((current) =>
              new Map(current).set(
                layer.id,
                collection
                  ? { type: 'FeatureCollection', features: collection.features }
                  : 'failed',
              ),
            );
          })
          .catch(() => {
            asked.current.delete(key);
            setFiles((current) => new Map(current).set(layer.id, 'failed'));
          });
      } else if (layer.kind === 'arcgis_features') {
        for (const tile of tiles) {
          const key = `${layer.id}/${String(tile.z)}/${String(tile.x)}/${String(tile.y)}`;
          if (asked.current.has(key)) continue;
          asked.current.add(key);
          const path = `/map-layers/${layer.id}/features/${String(tile.z)}/${String(tile.x)}/${String(tile.y)}`;
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
  }, [layers, tiles, token]);

  return useMemo(() => {
    const overlays: MapOverlay[] = [];
    const notes = new Map<string, string>();
    for (const layer of layers) {
      if (layer.kind === 'arcgis_image' || layer.kind === 'wms') {
        overlays.push({ id: layer.id, kind: 'pictures', tiles: picturesUrl(layer.id) });
        continue;
      }
      const colour = colourExpression(layer);
      if (layer.kind === 'file') {
        const file = files.get(layer.id);
        if (file === 'failed') notes.set(layer.id, 'This layer could not be loaded.');
        else if (file) overlays.push({ id: layer.id, kind: 'features', data: file, colour });
        continue;
      }
      const seen = new Set<string | number>();
      const features: GeoJSON.Feature[] = [];
      let exceeded = false;
      let failed = false;
      for (const tile of tiles) {
        const square = squares.get(
          `${layer.id}/${String(tile.z)}/${String(tile.x)}/${String(tile.y)}`,
        );
        if (square === undefined) continue;
        if (square === 'failed') {
          failed = true;
          continue;
        }
        exceeded ||= square.exceeded;
        for (const feature of square.features) {
          const marked = withObjectId(feature);
          const id = marked.properties?.[OBJECT_ID] as string | number | undefined;
          if (id !== undefined) {
            if (seen.has(id)) continue;
            seen.add(id);
          }
          features.push(marked);
        }
      }
      overlays.push({
        id: layer.id,
        kind: 'features',
        data: { type: 'FeatureCollection', features },
        colour,
      });
      if (failed)
        notes.set(layer.id, 'Part of this layer could not be loaded. Move the map to try again.');
      else if (exceeded) notes.set(layer.id, 'Zoom in to see every line here.');
    }
    return { overlays, notes };
  }, [layers, files, squares, tiles]);
}
