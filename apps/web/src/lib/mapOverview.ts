import { MAX_OVERVIEW_PARTS, type MapLayerView, type MercatorLine } from '@grain/domain';

import { apiFetch, apiJson } from './api';
import { runOverviewJob, type OverviewJob, type OverviewResult } from './overviewWorker';

// Preparing a live layer's zoomed-out view in an admin's browser (the owner's request of
// 2026-11-07, F-134): the whole layer is read through the Worker, page by page in ArcGIS's
// compact format (about 8 MB for North American Rail Network Lines' 302,774 pieces), checking
// every piece arrived; each value's pieces are joined into lines and simplified away from the
// page's thread; and the result is sent in parts of about 100 KB (so the Worker checks each
// within Cloudflare's free plan) and published once all have arrived. Only lines are kept;
// areas and points are drawn by map squares as before.

/** How many pages are read, or parts sent, at once. */
const AT_ONCE = 4;

export type OverviewProgress =
  | { stage: 'reading'; done: number; total: number }
  | { stage: 'joining' }
  | { stage: 'saving'; done: number; total: number };

type Decode = (typeof import('arcgis-pbf-parser'))['default'];
type DecodedFeature = ReturnType<Decode>['featureCollection']['features'][number];

/** Adds pieces to their value's group of lines; returns how many pieces there were. */
function collect(
  features: readonly DecodedFeature[],
  field: string | null,
  groups: Map<string | null, MercatorLine[]>,
): number {
  for (const feature of features) {
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
  return features.length;
}

/** Joins and splits in a worker where the browser has them, else in place. */
function join(job: OverviewJob): Promise<OverviewResult> {
  if (typeof Worker === 'undefined') return Promise.resolve(runOverviewJob(job));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./overviewWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<OverviewResult>) => {
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error('The lines could not be joined in this browser.'));
    };
    worker.postMessage(job);
  });
}

/**
 * Reads every piece of a layer, page by page: pages are asked for in batches at the first page's
 * size, a short page is filled in from where it stopped, and the whole read is refused unless
 * exactly the counted pieces arrived (Codex's review of 8e0fd95).
 */
async function readAll(
  layer: Pick<MapLayerView, 'id' | 'colourField'>,
  token: string,
  groups: Map<string | null, MercatorLine[]>,
  onProgress: (progress: OverviewProgress) => void,
  signal: AbortSignal,
  controller: AbortController,
): Promise<number> {
  const { default: decode } = await import('arcgis-pbf-parser');
  const { count } = await apiJson<{ count: number; pageSize: number }>(
    `/map-layers/${layer.id}/count`,
    token,
    { signal },
  );
  if (count === 0) throw new Error('This layer has nothing to draw.');
  const page = async (offset: number) => {
    const res = await apiFetch(`/map-layers/${layer.id}/pages/${String(offset)}`, token, {
      signal,
    });
    return decode(new Uint8Array(await res.arrayBuffer())).featureCollection.features;
  };
  /** The pieces from `start` up to (not including) `end`, however many each page gives. */
  const span = async (start: number, end: number, first?: DecodedFeature[]) => {
    let at = start;
    let features = first ?? (await page(at));
    for (;;) {
      const taken = features.slice(0, end - at);
      collect(taken, layer.colourField, groups);
      at += taken.length;
      if (at >= end) return;
      if (taken.length === 0) {
        throw new Error(
          `The map service stopped giving pieces at ${at.toLocaleString('en-CA')} of ${count.toLocaleString('en-CA')}. Try again.`,
        );
      }
      features = await page(at);
    }
  };
  const first = await page(0);
  const step = first.length;
  if (step === 0) throw new Error('The map service gave nothing to draw.');
  let read = 0;
  const done = (start: number, end: number) => {
    read += end - start;
    onProgress({ stage: 'reading', done: read, total: count });
  };
  await span(0, Math.min(step, count), first);
  done(0, Math.min(step, count));
  const starts: number[] = [];
  for (let start = step; start < count; start += step) starts.push(start);
  await inBatches(starts, controller, async (start) => {
    const end = Math.min(start + step, count);
    await span(start, end);
    done(start, end);
  });
  // Every counted piece, exactly once.
  if (read !== count) throw new Error('Not every piece of the layer arrived. Try again.');
  return count;
}

/**
 * Runs batches of work; the first failure cancels the rest (their requests are aborted and they
 * report no more progress) and is thrown (Codex's review of d35ac90: slower requests reported
 * progress after a failure, leaving the screen busy).
 */
async function inBatches<T>(
  items: readonly T[],
  controller: AbortController,
  run: (item: T, index: number) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += AT_ONCE) {
    try {
      await Promise.all(items.slice(i, i + AT_ONCE).map((item, k) => run(item, i + k)));
    } catch (error) {
      controller.abort();
      throw error;
    }
  }
}

/**
 * Prepares and publishes a live lines layer's zoomed-out view, reporting progress; throws with a
 * message to show when the layer cannot have one. Once it has thrown or finished, it reports
 * nothing more.
 */
export async function prepareOverview(
  layer: Pick<MapLayerView, 'id' | 'colourField'>,
  token: string,
  onProgress: (progress: OverviewProgress) => void,
): Promise<{ features: number; pieces: number }> {
  const controller = new AbortController();
  const report = (progress: OverviewProgress) => {
    if (!controller.signal.aborted) onProgress(progress);
  };
  try {
    return await prepare(layer, token, report, controller);
  } finally {
    // Nothing still running reports after this.
    controller.abort();
  }
}

async function prepare(
  layer: Pick<MapLayerView, 'id' | 'colourField'>,
  token: string,
  onProgress: (progress: OverviewProgress) => void,
  controller: AbortController,
): Promise<{ features: number; pieces: number }> {
  const { signal } = controller;
  const groups = new Map<string | null, MercatorLine[]>();
  const pieces = await readAll(layer, token, groups, onProgress, signal, controller);
  onProgress({ stage: 'joining' });
  const { parts, features } = await join({ groups: [...groups], field: layer.colourField });
  if (features === 0) {
    throw new Error('This layer has no lines, so it is drawn by map squares only.');
  }
  if (parts.length > MAX_OVERVIEW_PARTS) {
    throw new Error('Its zoomed-out view would be too large; it is drawn by map squares only.');
  }
  const version = crypto.randomUUID();
  let sent = 0;
  onProgress({ stage: 'saving', done: 0, total: parts.length });
  const send = (path: string, method: 'PUT' | 'POST', body: unknown) =>
    apiJson(path, token, {
      method,
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  await inBatches(parts, controller, async (part, i) => {
    await send(`/map-layers/${layer.id}/overview/${version}/${String(i)}`, 'PUT', {
      features: part,
    });
    sent += 1;
    onProgress({ stage: 'saving', done: sent, total: parts.length });
  });
  await send(`/map-layers/${layer.id}/overview/${version}/publish`, 'POST', {
    colourField: layer.colourField,
    partCount: parts.length,
    sourceCount: pieces,
  });
  return { features, pieces };
}
