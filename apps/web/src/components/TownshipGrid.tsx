import {
  gridKey,
  gridSquares,
  gridSquareZoom,
  type Bbox,
  type GridLevel,
  type GridSquareAt,
  type Tile,
} from '@grain/domain';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { apiJson } from '../lib/api';
import type { GridTownship } from '../lib/gridEdges';
import { GRID_FROM, type GridView } from '../lib/gridMap';
import type { MapBounds } from '../lib/mapbox';
import { MapPanel, PanelSection, PanelTiles } from './MapPanel';
import { Button } from './ui/button';

// The township grid (F-240, F-271; the owner, 2026-11-22: "much faster and be snappy and quickly
// generated once"): every township's lines from one file kept with the app
// (public/grid/alberta-townships.json, scripts/build-township-grid.js), fetched once and drawn at
// once; sections, quarter sections and legal subdivisions close in, from the province's service
// square by square through the Worker; the range and township numbers along the map's edges
// (gridEdges.ts); and a click on no land, well or facility names the square under it.

/** The township file's address, served with the app. */
export const TOWNSHIP_FILE = '/grid/alberta-townships.json';

interface TownshipFile {
  lines: number[][];
  townships: GridTownship[];
}

/** Squares kept in the page at most; the oldest go first. */
const KEPT = 600;
/** Requests at once: the province's servers are production servers. */
const AT_ONCE = 4;
/** The levels asked of the province: the townships come from the file. */
const FINER: readonly GridLevel[] = ['section', 'quarter', 'lsd'];

export interface Square {
  level: GridLevel;
  tile: Tile;
}
const keyOf = ({ level, tile }: Square) =>
  `${level}/${String(tile.z)}/${String(tile.x)}/${String(tile.y)}`;

/** The squares of the finer levels a view needs at its zoom, the coarsest first. */
export function squaresFor(view: Bbox, zoom: number): Square[] {
  const out: Square[] = [];
  for (const level of FINER) {
    const z = gridSquareZoom(level, zoom);
    if (z === null) continue;
    for (const tile of gridSquares(view, z)) out.push({ level, tile });
  }
  return out;
}

type Shape = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;

/** A square's answer as the map takes it: each shape once, by its place on the grid. */
export function readSquare(
  level: GridLevel,
  answer: unknown,
): { key: string; shape: GeoJSON.Feature }[] {
  const features: unknown =
    typeof answer === 'object' && answer !== null
      ? (answer as { features?: unknown }).features
      : null;
  if (!Array.isArray(features)) return [];
  const out: { key: string; shape: GeoJSON.Feature }[] = [];
  for (const raw of features as unknown[]) {
    const feature = raw as Partial<Shape> | null;
    const type = feature?.geometry?.type;
    if (!feature?.geometry || (type !== 'Polygon' && type !== 'MultiPolygon')) continue;
    const key = gridKey(level, feature.properties ?? {});
    if (key === null) continue;
    out.push({
      key,
      shape: { type: 'Feature', geometry: feature.geometry, properties: { level } },
    });
  }
  return out;
}

/** Every township's lines as one shape: each line its points, longitude then latitude. */
export function townshipLines(lines: readonly (readonly number[])[]): GeoJSON.FeatureCollection {
  const coordinates: [number, number][][] = [];
  for (const flat of lines) {
    const line: [number, number][] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) line.push([flat[i] ?? 0, flat[i + 1] ?? 0]);
    if (line.length >= 2) coordinates.push(line);
  }
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'MultiLineString', coordinates }, properties: {} },
    ],
  };
}

/** The township file, asked for once for the page's whole life. */
let townshipFile: Promise<TownshipFile> | null = null;
function loadTownships(): Promise<TownshipFile> {
  townshipFile ??= fetch(TOWNSHIP_FILE).then(async (res) => {
    if (!res.ok) throw new Error(`The township grid file answered ${String(res.status)}.`);
    return (await res.json()) as TownshipFile;
  });
  townshipFile.catch(() => {
    // Asked again on the next visit to the map rather than kept as a failure.
    townshipFile = null;
  });
  return townshipFile;
}

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

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** The finer levels' shapes for the squares of the view: each once, whichever square held it. */
export function finerShapes(
  needed: readonly Square[],
  squares: ReadonlyMap<string, SquareItems>,
): GeoJSON.FeatureCollection {
  const seen = new Set<string>();
  const shapes: GeoJSON.Feature[] = [];
  for (const square of needed) {
    for (const item of squares.get(keyOf(square)) ?? []) {
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      shapes.push(item.shape);
    }
  }
  return { type: 'FeatureCollection', features: shapes };
}

/** The square a click named, as the Worker answers it (GET /petroleum/grid/at). */
export interface GridSquareFound extends GridSquareAt {
  legal: string;
  shape: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
}

/** A click's square: being asked for, found, on no square (a road allowance), or not answered. */
export type GridPick =
  | { state: 'asking'; lon: number; lat: number }
  | { state: 'found'; lon: number; lat: number; square: GridSquareFound }
  | { state: 'none'; lon: number; lat: number }
  | { state: 'failed'; lon: number; lat: number };

export interface TownshipGrid {
  /** What the map draws; null while switched off or before the file has come. */
  view: GridView | null;
  /** Each township's numbers and box, for the numbers along the map's edges; null while off. */
  townships: readonly GridTownship[] | null;
  on: boolean;
  setOn: (on: boolean) => void;
  onViewChange: (bbox: Bbox | null, zoom: number) => void;
  /** Names the square under a click on no land, well or facility. */
  identify: (lon: number, lat: number) => void;
  pick: GridPick | null;
  clearPick: () => void;
  legend: () => React.ReactNode;
  about: () => React.ReactNode;
}

export function useTownshipGrid(organizationId: string, token: string): TownshipGrid {
  const [on, setOn] = useState(true);
  const [at, setAt] = useState<{ view: Bbox; zoom: number } | null>(null);
  const [file, setFile] = useState<{
    lines: GeoJSON.FeatureCollection;
    townships: GridTownship[];
  } | null>(null);
  const [fileFailed, setFileFailed] = useState(false);
  // The squares read, by key, oldest first.
  const [squares, setSquares] = useState<ReadonlyMap<string, SquareItems>>(new Map());
  const [failed, setFailed] = useState(false);
  const [pick, setPick] = useState<GridPick | null>(null);
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

  // The township file, once, and its lines made once.
  const wantFile = on && file === null;
  useEffect(() => {
    if (!wantFile) return;
    let live = true;
    loadTownships()
      .then((got) => {
        if (!live) return;
        setFile({ lines: townshipLines(got.lines), townships: got.townships });
        setFileFailed(false);
      })
      .catch(() => {
        if (live) setFileFailed(true);
      });
    return () => {
      live = false;
    };
  }, [wantFile]);

  const needed = useMemo(() => (on && at ? squaresFor(at.view, at.zoom) : []), [on, at]);
  useEffect(() => {
    loader.want(needed, squares);
  }, [loader, needed, squares]);

  const shapes = useMemo(() => finerShapes(needed, squares), [needed, squares]);
  const picked = useMemo(
    (): GeoJSON.FeatureCollection =>
      pick?.state === 'found' && pick.square.shape
        ? {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', geometry: pick.square.shape, properties: {} }],
          }
        : EMPTY,
    [pick],
  );
  const view = useMemo(
    (): GridView | null => (on && file ? { townships: file.lines, shapes, picked } : null),
    [on, file, shapes, picked],
  );

  const onViewChange = useCallback((bbox: Bbox | null, zoom: number) => {
    setAt((before) => {
      if (bbox === null) return null;
      // A move within the same squares asks nothing new: the same answer is kept.
      if (before?.zoom === zoom && sameBox(before.view, bbox)) return before;
      return { view: bbox, zoom };
    });
  }, []);

  // Only while the grid is drawn: farther out a click names nothing.
  const shown = on && (at?.zoom ?? 0) >= GRID_FROM;
  const identify = useCallback(
    (lon: number, lat: number) => {
      if (!shown) return;
      setPick({ state: 'asking', lon, lat });
      const query = new URLSearchParams({
        lon: lon.toFixed(6),
        lat: lat.toFixed(6),
        organization_id: organizationId,
      });
      apiJson<{ square: GridSquareFound | null }>(`/petroleum/grid/at?${query.toString()}`, token)
        .then(({ square }) => {
          setPick((before) =>
            before?.lon !== lon || before.lat !== lat
              ? before
              : square
                ? { state: 'found', lon, lat, square }
                : { state: 'none', lon, lat },
          );
        })
        .catch(() => {
          setPick((before) =>
            before?.lon !== lon || before.lat !== lat ? before : { state: 'failed', lon, lat },
          );
        });
    },
    [shown, organizationId, token],
  );
  const clearPick = useCallback(() => {
    setPick(null);
  }, []);

  const zoom = at?.zoom ?? 0;
  const legend = () => (
    <label className="flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={on}
        onChange={(event) => {
          setOn(event.target.checked);
          if (!event.target.checked) setPick(null);
        }}
        className="size-3.5 accent-foreground"
      />
      <span className="grow font-medium text-foreground">Township grid</span>
      <span className="text-muted-foreground">
        {!on
          ? ''
          : fileFailed || failed
            ? 'not answering'
            : zoom < GRID_FROM
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
      Alberta): its townships kept with the app, its sections, quarter sections and legal
      subdivisions shown close in as the province publishes them. Click a square with nothing on it
      to name it.
    </p>
  );

  return {
    view,
    townships: on && file ? file.townships : null,
    on,
    setOn,
    onViewChange,
    identify,
    pick,
    clearPick,
    legend,
    about,
  };
}

function sameBox(a: Bbox, b: Bbox) {
  return a.west === b.west && a.south === b.south && a.east === b.east && a.north === b.north;
}

/** The box around a shape, for Zoom to square. */
function boundsOf(shape: GeoJSON.Polygon | GeoJSON.MultiPolygon): MapBounds | null {
  const rings = shape.type === 'Polygon' ? shape.coordinates : shape.coordinates.flat();
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x === undefined || y === undefined) continue;
      west = Math.min(west, x);
      east = Math.max(east, x);
      south = Math.min(south, y);
      north = Math.max(north, y);
    }
  }
  return Number.isFinite(west) ? [west, south, east, north] : null;
}

/** The panel on the right for a square a click named (F-271). */
export function GridPanel({
  pick,
  goTo,
  onClose,
}: {
  pick: GridPick | null;
  goTo: (bounds: MapBounds) => void;
  onClose: () => void;
}) {
  if (!pick) return null;
  if (pick.state !== 'found') {
    const text =
      pick.state === 'asking'
        ? 'Asking the province which square this is…'
        : pick.state === 'none'
          ? 'No legal subdivision here: a road allowance, or outside the grid.'
          : 'The province’s township grid did not answer. Try again in a moment.';
    return (
      <MapPanel label="Land location" eyebrow="Land location" title="—" onClose={onClose}>
        <p className="mt-2 text-muted-foreground">{text}</p>
      </MapPanel>
    );
  }
  const s = pick.square;
  const bounds = s.shape ? boundsOf(s.shape) : null;
  return (
    <MapPanel
      label={`Land location ${s.legal}`}
      eyebrow="Land location · LSD-Sec-Twp-Rge-Mer"
      title={s.legal}
      onClose={onClose}
    >
      <PanelTiles
        tiles={[
          { label: 'LSD', value: String(s.lsd) },
          { label: 'Section', value: String(s.section) },
          { label: 'Quarter', value: s.quarter ?? '—' },
        ]}
      />
      {bounds && (
        <div className="mt-3">
          <Button
            size="sm"
            onClick={() => {
              goTo(bounds);
            }}
          >
            Zoom to square
          </Button>
        </div>
      )}
      <PanelSection title="Township">
        <p className="font-mono">
          T{s.township} R{s.range} W{s.meridian}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Township {s.township}, range {s.range}, west of the {ordinal(s.meridian)} meridian;
          section {s.section}
          {s.quarter ? `, its ${s.quarter} quarter` : ''}; legal subdivision {s.lsd}.
        </p>
      </PanelSection>
      <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
        The Government of Alberta’s township grid (Open Government Licence – Alberta).
      </p>
    </MapPanel>
  );
}

function ordinal(n: number): string {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${String(n)}th`;
}
