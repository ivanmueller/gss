import type { Bbox } from '@grain/domain';

// The range and township numbers along the oil and gas map's edges (F-271; the owner, 2026-11-22,
// with a picture of another map: "R16 W4" across the top and "T10" down the right side, from the
// last scroll of the 10 km distance bar towards 5 km, and no number in every square, which crowds
// the screen). Worked out from the township file kept with the app (gridMap.ts), at each move.

/** A township: meridian, range, township, then its box: west, south, east, north. */
export type GridTownship = readonly [number, number, number, number, number, number, number];

/** The zoom the numbers show from: the last scroll before the bar turns from 10 km to 5 km. */
export const EDGE_LABELS_FROM = 8.95;

export interface EdgeLabel {
  text: string;
  side: 'top' | 'right';
  /** Pixels from the map's left (top) or top (right). */
  at: number;
}

/** Labels at least this far apart; a later one too close to the one before is left out. */
const GAP = 58;

/**
 * The labels for a view: each range whose column crosses the top of the map, at the middle of
 * the part shown, and each township whose row crosses its right side, at the middle of its row.
 */
export function gridEdgeLabels(
  townships: readonly GridTownship[],
  view: Bbox,
  project: (lon: number, lat: number) => { x: number; y: number },
  size: { width: number; height: number },
): EdgeLabel[] {
  const top = view.north - (view.north - view.south) * 0.02;
  const right = view.east - (view.east - view.west) * 0.02;
  const columns = new Map<string, { west: number; east: number }>();
  const rows = new Map<number, { south: number; north: number }>();
  for (const [m, r, t, w, s, e, n] of townships) {
    if (e < view.west || w > view.east || n < view.south || s > view.north) continue;
    if (s <= top && top <= n) {
      const key = `R${String(r)} W${String(m)}`;
      const was = columns.get(key);
      columns.set(key, {
        west: Math.min(was?.west ?? w, w),
        east: Math.max(was?.east ?? e, e),
      });
    }
    if (w <= right && right <= e) {
      const was = rows.get(t);
      rows.set(t, { south: Math.min(was?.south ?? s, s), north: Math.max(was?.north ?? n, n) });
    }
  }
  const spaced = (labels: EdgeLabel[], length: number) => {
    const kept: EdgeLabel[] = [];
    for (const label of labels.sort((a, b) => a.at - b.at)) {
      if (label.at < 24 || label.at > length - 24) continue;
      const last = kept.at(-1);
      if (!last || label.at - last.at >= GAP) kept.push(label);
    }
    return kept;
  };
  const tops: EdgeLabel[] = [];
  for (const [text, { west, east }] of columns) {
    const middle = (Math.max(west, view.west) + Math.min(east, view.east)) / 2;
    tops.push({ text, side: 'top', at: project(middle, top).x });
  }
  const sides: EdgeLabel[] = [];
  for (const [t, { south, north }] of rows) {
    const middle = (Math.max(south, view.south) + Math.min(north, view.north)) / 2;
    sides.push({ text: `T${String(t)}`, side: 'right', at: project(right, middle).y });
  }
  return [...spaced(tops, size.width), ...spaced(sides, size.height)];
}
