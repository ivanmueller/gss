import { buildOverview, type MapLayerView, type MercatorLine } from '@grain/domain';

import { apiFetch, apiJson, sendJson } from './api';

// Preparing a live layer's zoomed-out view in an admin's browser (the owner's request of
// 2026-11-07, F-134): the whole layer is read through the Worker, page by page in ArcGIS's
// compact format (about 8 MB for North American Rail Network Lines' 302,774 pieces), each
// value's pieces joined into lines and simplified (buildOverview, @grain/domain), and the result
// (a few MB) sent back to be checked and kept. Only lines are kept; areas and points are drawn
// by map squares as before.

/** How many pages are read at once. */
const AT_ONCE = 4;

export interface OverviewProgress {
  read: number;
  total: number;
}

type Decoded = ReturnType<typeof import('arcgis-pbf-parser').default>;

/** A page's lines, grouped by the value of `field`. */
function collect(
  decoded: Decoded,
  field: string | null,
  groups: Map<string | null, MercatorLine[]>,
): number {
  let pieces = 0;
  for (const feature of decoded.featureCollection.features) {
    pieces += 1;
    const geometry = feature.geometry;
    if (!geometry) continue;
    const lines =
      geometry.type === 'LineString'
        ? [geometry.coordinates as MercatorLine]
        : geometry.type === 'MultiLineString'
          ? (geometry.coordinates as MercatorLine[])
          : [];
    if (lines.length === 0) continue;
    const raw = field === null ? null : feature.properties?.[field];
    const value =
      typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() || null : null;
    let group = groups.get(value);
    if (!group) groups.set(value, (group = []));
    for (const line of lines) if (line.length >= 2) group.push(line);
  }
  return pieces;
}

/**
 * Prepares and saves a live lines layer's zoomed-out view. Reports progress as pages arrive;
 * throws with a message to show when the layer cannot have one.
 */
export async function prepareOverview(
  layer: Pick<MapLayerView, 'id' | 'colourField'>,
  token: string,
  onProgress: (progress: OverviewProgress) => void,
): Promise<{ features: number; pieces: number }> {
  const { default: decode } = await import('arcgis-pbf-parser');
  const { count } = await apiJson<{ count: number; pageSize: number }>(
    `/map-layers/${layer.id}/count`,
    token,
  );
  if (count === 0) throw new Error('This layer has nothing to draw.');
  const groups = new Map<string | null, MercatorLine[]>();
  const page = async (offset: number) => {
    const res = await apiFetch(`/map-layers/${layer.id}/pages/${String(offset)}`, token);
    return decode(new Uint8Array(await res.arrayBuffer()));
  };
  // The first page says how many pieces the service gives at once.
  let read = collect(await page(0), layer.colourField, groups);
  const step = read;
  onProgress({ read, total: count });
  if (step === 0) throw new Error('The map service gave nothing to draw.');
  const offsets: number[] = [];
  for (let offset = step; offset < count; offset += step) offsets.push(offset);
  for (let i = 0; i < offsets.length; i += AT_ONCE) {
    const pages = await Promise.all(offsets.slice(i, i + AT_ONCE).map(page));
    for (const decoded of pages) read += collect(decoded, layer.colourField, groups);
    onProgress({ read: Math.min(read, count), total: count });
  }
  const overview = buildOverview(groups, layer.colourField);
  if (overview.features.length === 0) {
    throw new Error('This layer has no lines, so it is drawn by map squares only.');
  }
  await sendJson(`/map-layers/${layer.id}/overview`, token, 'PUT', {
    colourField: layer.colourField,
    sourceCount: read,
    geojson: overview,
  });
  return { features: overview.features.length, pieces: read };
}
