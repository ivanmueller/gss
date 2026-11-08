import {
  cleanValue,
  groupingOf,
  MAX_OVERVIEW_PARTS,
  valuesOf,
  VALUES_PROPERTY,
  type MapLayerView,
  type MercatorLine,
  type OverviewGroup,
} from '@grain/domain';

import { ApiError, apiFetch, apiJson } from './api';
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

/** Waits before asking a map service again, in milliseconds. */
export const RETRY_WAITS = [2_000, 6_000];

/**
 * Reads from a map service through the Worker, asking twice more after a pause when the service
 * did not answer (502: busy or slow after several layers in a row; on staging, Amtrak Routes,
 * 2026-11-08); any other refusal is final.
 */
/** Whether a read was cancelled (read afresh: it can change while waiting). */
function stopped(signal: AbortSignal): boolean {
  return signal.aborted;
}

async function withRetries<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (const wait of [...RETRY_WAITS, null]) {
    try {
      return await read();
    } catch (error) {
      const busy = error instanceof ApiError && error.status === 502;
      if (!busy || wait === null || signal.aborted) throw error;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, wait);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
      if (stopped(signal)) throw error;
    }
  }
  throw new Error('unreachable');
}

export type OverviewProgress =
  | { stage: 'reading'; done: number; total: number }
  | { stage: 'joining' }
  | { stage: 'saving'; done: number; total: number };

type Decode = (typeof import('arcgis-pbf-parser'))['default'];
type DecodedFeature = ReturnType<Decode>['featureCollection']['features'][number];

/** What a view is built from: the layer and the settings its lines are grouped and limited by. */
export type OverviewLayer = Pick<
  MapLayerView,
  'id' | 'colourField' | 'alsoFields' | 'onlyField' | 'onlyValues'
>;

/**
 * Adds pieces to their group of lines: pieces with the same value of the colour field and, when
 * other fields also count, the same values of all of them (F-137); returns how many pieces there
 * were.
 */
function collect(
  features: readonly DecodedFeature[],
  layer: OverviewLayer,
  groups: Map<string, OverviewGroup>,
): number {
  const field = layer.colourField;
  const fields = field === null ? [] : [field, ...layer.alsoFields];
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
    const props = feature.properties ?? {};
    // Tidied as everywhere else, so the view colours and filters as live squares do.
    const value = field === null ? null : cleanValue(props[field]) || null;
    const values = layer.alsoFields.length > 0 ? valuesOf(props, fields) : null;
    const key = `${value ?? ''}\u0000${values ?? ''}`;
    let group = groups.get(key);
    if (!group) {
      const properties: Record<string, string | null> = {};
      if (field !== null) properties[field] = value;
      if (values !== null) properties[VALUES_PROPERTY] = values;
      groups.set(key, (group = { properties, lines: [] }));
    }
    for (const line of lines) if (line.length >= 2) group.lines.push(line);
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
  layer: OverviewLayer,
  token: string,
  groups: Map<string, OverviewGroup>,
  onProgress: (progress: OverviewProgress) => void,
  signal: AbortSignal,
  controller: AbortController,
): Promise<number> {
  const { default: decode } = await import('arcgis-pbf-parser');
  const { count } = await withRetries(
    () =>
      apiJson<{ count: number; pageSize: number }>(`/map-layers/${layer.id}/count`, token, {
        signal,
      }),
    signal,
  );
  if (count === 0) throw new Error('This layer has nothing to draw.');
  const page = async (offset: number) => {
    const res = await withRetries(
      () => apiFetch(`/map-layers/${layer.id}/pages/${String(offset)}`, token, { signal }),
      signal,
    );
    return decode(new Uint8Array(await res.arrayBuffer())).featureCollection.features;
  };
  /** The pieces from `start` up to (not including) `end`, however many each page gives. */
  const span = async (start: number, end: number, first?: DecodedFeature[]) => {
    let at = start;
    let features = first ?? (await page(at));
    for (;;) {
      const taken = features.slice(0, end - at);
      collect(taken, layer, groups);
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
  layer: OverviewLayer,
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
  layer: OverviewLayer,
  token: string,
  onProgress: (progress: OverviewProgress) => void,
  controller: AbortController,
): Promise<{ features: number; pieces: number }> {
  const { signal } = controller;
  const groups = new Map<string, OverviewGroup>();
  const pieces = await readAll(layer, token, groups, onProgress, signal, controller);
  onProgress({ stage: 'joining' });
  const { parts, features } = await join({ groups: [...groups] });
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
    grouping: groupingOf(layer),
    partCount: parts.length,
    sourceCount: pieces,
  });
  return { features, pieces };
}
