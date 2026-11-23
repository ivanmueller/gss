import {
  GRID_LEVELS,
  GRID_MERIDIANS,
  gridKey,
  gridLabel,
  gridSquares,
  gridSquareZoom,
  type Bbox,
  type GridLevel,
  type GridShapeFields,
  type Tile,
} from '@grain/domain';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { apiJson } from '../lib/api';
import type { GridView } from '../lib/gridMap';

// The township grid (F-240, F-271): the squares of the view asked of the Worker, which asks the
// province's township grid service; kept in the page while it is open (and by the browser for a
// week, asked again with its tag), drawn above the land and under the wells, on by default with
// a switch in the legend.

/** Squares kept in the page at most; the oldest go first. */
const KEPT = 600;
/** Requests at once: the province's servers are production servers. */
const AT_ONCE = 4;

export interface Square {
  level: GridLevel;
  tile: Tile;
}
const keyOf = ({ level, tile }: Square) =>
  `${level}/${String(tile.z)}/${String(tile.x)}/${String(tile.y)}`;

/** The squares a view needs at its zoom, the coarsest level first. */
export function squaresFor(view: Bbox, zoom: number): Square[] {
  const out: Square[] = [];
  for (const level of GRID_LEVELS) {
    const z = gridSquareZoom(level, zoom);
    if (z === null) continue;
    for (const tile of gridSquares(view, z)) out.push({ level, tile });
  }
  return out;
}

type Shape = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;

/** The middle of a shape's box: grid squares are near enough to rectangles for a label. */
function middleOf(shape: Shape): [number, number] | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const rings =
    shape.geometry.type === 'Polygon'
      ? [shape.geometry.coordinates[0]]
      : shape.geometry.coordinates.map((polygon) => polygon[0]);
  for (const ring of rings) {
    for (const [x, y] of ring ?? []) {
      if (x === undefined || y === undefined) continue;
      west = Math.min(west, x);
      east = Math.max(east, x);
      south = Math.min(south, y);
      north = Math.max(north, y);
    }
  }
  return Number.isFinite(west) ? [(west + east) / 2, (south + north) / 2] : null;
}

/** A square's answer as the map takes it: each shape once, named, with its label point. */
export function readSquare(
  level: GridLevel,
  answer: unknown,
): { key: string; shape: GeoJSON.Feature; label: GeoJSON.Feature | null }[] {
  const features: unknown =
    typeof answer === 'object' && answer !== null
      ? (answer as { features?: unknown }).features
      : null;
  if (!Array.isArray(features)) return [];
  const out: { key: string; shape: GeoJSON.Feature; label: GeoJSON.Feature | null }[] = [];
  for (const raw of features as unknown[]) {
    const feature = raw as Partial<Shape> | null;
    const type = feature?.geometry?.type;
    if (!feature?.geometry || (type !== 'Polygon' && type !== 'MultiPolygon')) continue;
    const fields = (feature.properties ?? {}) as GridShapeFields;
    const key = gridKey(level, fields);
    const label = gridLabel(level, fields);
    if (key === null || label === null) continue;
    const shape: Shape = {
      type: 'Feature',
      geometry: feature.geometry,
      properties: { level },
    };
    const middle = middleOf(shape);
    out.push({
      key,
      shape,
      label: middle && {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: middle },
        properties: { level, label },
      },
    });
  }
  return out;
}

/** The meridians from the border to 60°N, named as on the reference: "W5 · 114°W". */
const MERIDIAN_LINES: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: GRID_MERIDIANS.map(({ meridian, longitude }) => ({
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [longitude, 49],
        [longitude, 60],
      ],
    },
    properties: { label: `W${String(meridian)} · ${String(-longitude)}°W` },
  })),
};

type SquareItems = ReturnType<typeof readSquare>;

/**
 * One queue of squares for the page: a square on its way is never dropped by a move of the map;
 * one still waiting is skipped once the view no longer needs it; a few at once; every request
 * stops when the page closes.
 */
export class GridLoader {
  private member = { organizationId: '', token: '' };
  private queue: Square[] = [];
  private wanted = new Set<string>();
  private readonly asking = new Set<string>();
  private controller = new AbortController();

  constructor(
    private readonly loaded: (key: string, items: SquareItems) => void,
    private readonly failed: () => void,
    private readonly ask: (path: string, token: string, signal: AbortSignal) => Promise<unknown> = (
      path,
      token,
      signal,
    ) => apiJson<unknown>(path, token, { signal }),
  ) {}

  /** Who is asking: their organization and sign-in, for the next requests. */
  signIn(organizationId: string, token: string) {
    this.member = { organizationId, token };
  }

  open() {
    this.controller = new AbortController();
  }

  close() {
    this.controller.abort();
    this.asking.clear();
    this.queue = [];
  }

  /** The squares the view needs now; those not kept or on their way are asked for. */
  want(needed: readonly Square[], kept: ReadonlyMap<string, SquareItems>) {
    this.wanted = new Set(needed.map(keyOf));
    this.queue = needed.filter((s) => !kept.has(keyOf(s)) && !this.asking.has(keyOf(s)));
    this.pump();
  }

  private pump() {
    while (this.asking.size < AT_ONCE) {
      const square = this.queue.shift();
      if (!square) return;
      const key = keyOf(square);
      if (!this.wanted.has(key) || this.asking.has(key)) continue;
      this.asking.add(key);
      const signal = this.controller.signal;
      const { organizationId, token } = this.member;
      this.ask(
        `/petroleum/grid/${key}?organization_id=${encodeURIComponent(organizationId)}`,
        token,
        signal,
      )
        .then((answer) => {
          if (!signal.aborted) this.loaded(key, readSquare(square.level, answer));
        })
        .catch((error: unknown) => {
          if (!signal.aborted && !(error instanceof DOMException && error.name === 'AbortError')) {
            this.failed();
          }
        })
        .finally(() => {
          this.asking.delete(key);
          if (!signal.aborted) this.pump();
        });
    }
  }
}

/** What the map draws for the squares of the view: each shape once, whichever square held it. */
export function gridView(
  needed: readonly Square[],
  squares: ReadonlyMap<string, SquareItems>,
): GridView {
  const seen = new Set<string>();
  const shapes: GeoJSON.Feature[] = [];
  const labels: GeoJSON.Feature[] = [];
  for (const square of needed) {
    for (const item of squares.get(keyOf(square)) ?? []) {
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      shapes.push(item.shape);
      if (item.label) labels.push(item.label);
    }
  }
  return {
    shapes: { type: 'FeatureCollection', features: shapes },
    labels: { type: 'FeatureCollection', features: labels },
    meridians: MERIDIAN_LINES,
  };
}

export interface TownshipGrid {
  /** What the map draws; null while switched off. */
  view: GridView | null;
  on: boolean;
  setOn: (on: boolean) => void;
  onViewChange: (bbox: Bbox | null, zoom: number) => void;
  legend: () => React.ReactNode;
  about: () => React.ReactNode;
}

export function useTownshipGrid(organizationId: string, token: string): TownshipGrid {
  const [on, setOn] = useState(true);
  const [at, setAt] = useState<{ view: Bbox; zoom: number } | null>(null);
  // The squares read, by key, oldest first.
  const [squares, setSquares] = useState<ReadonlyMap<string, SquareItems>>(new Map());
  const [failed, setFailed] = useState(false);
  const [loader] = useState(
    () =>
      new GridLoader(
        (key, items) => {
          setFailed(false);
          setSquares((before) => {
            const next = new Map(before);
            next.set(key, items);
            for (const oldest of next.keys()) {
              if (next.size <= KEPT) break;
              next.delete(oldest);
            }
            return next;
          });
        },
        () => {
          setFailed(true);
        },
      ),
  );
  useEffect(() => {
    loader.signIn(organizationId, token);
  }, [loader, organizationId, token]);
  useEffect(() => {
    loader.open();
    return () => {
      loader.close();
    };
  }, [loader]);

  const needed = useMemo(() => (on && at ? squaresFor(at.view, at.zoom) : []), [on, at]);
  useEffect(() => {
    loader.want(needed, squares);
  }, [loader, needed, squares]);

  const view = useMemo(
    (): GridView | null => (on ? gridView(needed, squares) : null),
    [on, needed, squares],
  );

  const onViewChange = useCallback((bbox: Bbox | null, zoom: number) => {
    setAt((before) => {
      if (bbox === null) return null;
      // A move within the same squares asks nothing new: the same answer is kept.
      if (before?.zoom === zoom && sameBox(before.view, bbox)) return before;
      return { view: bbox, zoom };
    });
  }, []);

  const zoom = at?.zoom ?? 0;
  const legend = () => (
    <label className="flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={on}
        onChange={(event) => {
          setOn(event.target.checked);
        }}
        className="size-3.5 accent-foreground"
      />
      <span className="grow font-medium text-foreground">Township grid</span>
      <span className="text-muted-foreground">
        {!on
          ? ''
          : failed
            ? 'not answering'
            : zoom < 7
              ? 'zoom in to see'
              : zoom < 11
                ? 'townships'
                : zoom < 13
                  ? 'sections'
                  : zoom < 14
                    ? 'quarters'
                    : 'LSDs'}
      </span>
    </label>
  );

  const about = () => (
    <p>
      <strong className="font-medium text-foreground">Township grid.</strong> The Alberta Township
      System from the Government of Alberta’s township grid service (Open Government Licence –
      Alberta), shown as the province publishes it, nothing stored: townships from a 30 km distance
      bar, sections, quarter sections and legal subdivisions as the map is zoomed in, with the 4th,
      5th and 6th meridians the ranges are counted from.
    </p>
  );

  return { view, on, setOn, onViewChange, legend, about };
}

function sameBox(a: Bbox, b: Bbox) {
  return a.west === b.west && a.south === b.south && a.east === b.east && a.north === b.north;
}
