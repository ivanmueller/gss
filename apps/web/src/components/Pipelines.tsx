import {
  decodeParts,
  gridSquares,
  PIPELINE_LEVELS,
  PIPELINE_STATUSES,
  PIPELINE_SUBSTANCES,
  pipelineLevelAt,
  pipelineSubstanceOf,
  tileBounds,
  type Bbox,
  type PipelineLevel,
  type PipelineParts,
  type PipelineSubstance,
  type Tile,
} from '@grain/domain';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, apiJson } from '../lib/api';
import { PIPELINE_COLOURS, pipelineStrength, type PipelinesView } from '../lib/pipelinesMap';
import { landDay } from './LandPanel';
import { FilterChip, LegendTitle, MapSection, SIDE_INPUT, SIDE_LABEL } from './MapSide';

// Pipelines on the oil and gas map (F-249; the owner, 2026-11-22: "We need the pipeline data, so
// the pipelines and who owns them"; every status, with filters). The AER's pipelines of the area
// loaded, asked for square by square as the map moves (183,000 segments in the Duvernay's box are
// too many to send at once): the large lines from farther out, every line close in; each square
// kept in the page once read. The box at the pointer and the panel are in PipelinePanel.tsx.

/** The answer of GET /api/v1/petroleum/pipelines/:z/:x/:y (apps/api/src/petro-pipelines.ts). */
export interface PipelineSquareAnswer {
  load: { loadedAt: string; fileDate: string | null; area: Bbox; segments: number } | null;
  level: PipelineLevel;
  truncated: boolean;
  statuses: (string | null)[];
  substances: (string | null)[];
  companies: { code: string | null; name: string | null }[];
  lines: [number, string, number, number, number, number | null, number[], number[]][];
}

/** One segment as the map, the box at the pointer and the filters use it. */
export interface PipelineEntry {
  id: number;
  key: string;
  /** Licence and line, "58864-2". */
  line: string;
  status: string | null;
  substance: string | null;
  group: PipelineSubstance;
  licensee: { code: string | null; name: string | null } | null;
  diameterMm: number | null;
  parts: PipelineParts;
}

export const pipelineKey = (id: number) => `pipeline:${String(id)}`;

/** A square's segments, each with its status, substance and licensee looked up. */
export function pipelineEntries(answer: PipelineSquareAnswer): PipelineEntry[] {
  return answer.lines.map(([id, line, status, substance, licensee, diameterMm, path, breaks]) => {
    const name = answer.substances[substance] ?? null;
    return {
      id,
      key: pipelineKey(id),
      line,
      status: answer.statuses[status] ?? null,
      substance: name,
      group: pipelineSubstanceOf(name),
      licensee: answer.companies[licensee] ?? null,
      diameterMm,
      parts: decodeParts(path, breaks),
    };
  });
}

export interface PipelineSquare {
  level: PipelineLevel;
  tile: Tile;
}
const squareKey = ({ tile }: PipelineSquare) =>
  `${String(tile.z)}/${String(tile.x)}/${String(tile.y)}`;

const overlaps = (a: Bbox, b: Bbox) =>
  a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south;

/** The squares a view needs at its zoom, within the area loaded once it is known. */
export function pipelineSquaresFor(view: Bbox, zoom: number, area: Bbox | null): PipelineSquare[] {
  const level = pipelineLevelAt(zoom);
  const within = area ? clip(view, area) : view;
  if (within === null) return [];
  return gridSquares(within, PIPELINE_LEVELS[level].squareZoom).map((tile) => ({ level, tile }));
}

function clip(a: Bbox, b: Bbox): Bbox | null {
  if (!overlaps(a, b)) return null;
  return {
    west: Math.max(a.west, b.west),
    south: Math.max(a.south, b.south),
    east: Math.min(a.east, b.east),
    north: Math.min(a.north, b.north),
  };
}

/** What a level leaves out, in words; empty where every line is drawn. */
export function pipelineLevelNote(level: PipelineLevel): string {
  switch (level) {
    case 'far':
      return ': from this far out the large and long lines only, 8-inch pipe and up or 5 km and longer; more come in as you zoom in';
    case 'mid':
      return ': 6-inch pipe and up or 2 km and longer; every line from about the 3 km distance bar';
    default:
      return '';
  }
}

/** Squares kept in the page at most; the oldest go first. */
const KEPT = 300;
/** Requests at once. */
const AT_ONCE = 6;

interface SquareRead {
  load: PipelineSquareAnswer['load'];
  truncated: boolean;
  entries: PipelineEntry[];
}

/**
 * One queue of squares for the page, as the township grid's: a square on its way is never dropped
 * by a move of the map; one still waiting is skipped once the view no longer needs it; a few at
 * once; every request stops when the page closes.
 */
export class PipelineLoader {
  private member = { organizationId: '', token: '' };
  private queue: PipelineSquare[] = [];
  private wanted = new Set<string>();
  private readonly asking = new Set<string>();
  private controller = new AbortController();

  constructor(
    private readonly loaded: (key: string, read: SquareRead) => void,
    private readonly failed: (error: unknown) => void,
    private readonly ask: (path: string, token: string, signal: AbortSignal) => Promise<unknown> = (
      path,
      token,
      signal,
    ) => apiJson<unknown>(path, token, { signal }),
  ) {}

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

  want(needed: readonly PipelineSquare[], kept: ReadonlyMap<string, SquareRead>) {
    this.wanted = new Set(needed.map(squareKey));
    this.queue = needed.filter((s) => !kept.has(squareKey(s)) && !this.asking.has(squareKey(s)));
    this.pump();
  }

  private pump() {
    while (this.asking.size < AT_ONCE) {
      const square = this.queue.shift();
      if (!square) return;
      const key = squareKey(square);
      if (!this.wanted.has(key) || this.asking.has(key)) continue;
      this.asking.add(key);
      const signal = this.controller.signal;
      const { organizationId, token } = this.member;
      this.ask(
        `/petroleum/pipelines/${key}?organization_id=${encodeURIComponent(organizationId)}`,
        token,
        signal,
      )
        .then((answer) => {
          if (signal.aborted) return;
          const a = answer as PipelineSquareAnswer;
          this.loaded(key, { load: a.load, truncated: a.truncated, entries: pipelineEntries(a) });
        })
        .catch((error: unknown) => {
          if (!signal.aborted && !(error instanceof DOMException && error.name === 'AbortError')) {
            this.failed(error);
          }
        })
        .finally(() => {
          this.asking.delete(key);
          if (!signal.aborted) this.pump();
        });
    }
  }
}

/** The smallest outside diameter shown, in millimetres; 0 for any. */
export const PIPELINE_SIZES = [
  { mm: 0, label: 'Any size' },
  { mm: 114.3, label: '4-inch (114.3 mm) and up' },
  { mm: 219.1, label: '8-inch (219.1 mm) and up' },
  { mm: 323.9, label: '12-inch (323.9 mm) and up' },
  { mm: 508, label: '20-inch (508 mm) and up' },
] as const;

export interface PipelineFilter {
  statuses: ReadonlySet<string>;
  groups: ReadonlySet<PipelineSubstance>;
  licensee: string;
  minMm: number;
}

/** The segments shown: of the statuses and substances on, a licensee holding the text, the size. */
export function pipelinesShown(
  entries: readonly PipelineEntry[],
  filter: PipelineFilter,
): PipelineEntry[] {
  const text = filter.licensee.trim().toLowerCase();
  return entries.filter(
    (p) =>
      filter.statuses.has(p.status ?? '') &&
      filter.groups.has(p.group) &&
      (filter.minMm === 0 || (p.diameterMm ?? 0) >= filter.minMm) &&
      (text === '' || (p.licensee?.name ?? '').toLowerCase().includes(text)),
  );
}

/** A kept square's place from its key ("z/x/y"). */
function tileOfKey(key: string): Tile | null {
  const [z, x, y] = key.split('/').map(Number);
  return z === undefined || x === undefined || y === undefined ? null : { z, x, y };
}

/**
 * Each segment once, from the squares the view needs, whichever square held it. Where a square
 * needed has not come yet, the lines of kept squares of another level over the same ground stand
 * in for it, so zooming across a level never leaves the map bare while the new squares come.
 */
export function pipelinesInSquares(
  needed: readonly PipelineSquare[],
  squares: ReadonlyMap<string, SquareRead>,
): PipelineEntry[] {
  const seen = new Set<number>();
  const out: PipelineEntry[] = [];
  const add = (entries: readonly PipelineEntry[]) => {
    for (const entry of entries) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      out.push(entry);
    }
  };
  const missing: Bbox[] = [];
  for (const square of needed) {
    const read = squares.get(squareKey(square));
    if (read) add(read.entries);
    else missing.push(tileBounds(square.tile));
  }
  if (missing.length > 0) {
    for (const [key, read] of squares) {
      const tile = tileOfKey(key);
      if (!tile) continue;
      const ground = tileBounds(tile);
      if (missing.some((gap) => overlaps(gap, ground))) add(read.entries);
    }
  }
  return out;
}

/** The map's lines: one feature a segment, with what its layers read. */
export function pipelineFeatures(entries: readonly PipelineEntry[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: entries.map((p) => ({
      type: 'Feature',
      geometry:
        p.parts.length === 1
          ? { type: 'LineString', coordinates: p.parts[0] ?? [] }
          : { type: 'MultiLineString', coordinates: p.parts },
      properties: {
        key: p.key,
        colour: PIPELINE_COLOURS[p.group],
        strength: pipelineStrength(p.status),
        diameter: p.diameterMm ?? 0,
        permitted: p.status === 'Permitted',
      },
    })),
  };
}

export interface Pipelines {
  view: PipelinesView | null;
  byKey: ReadonlyMap<string, PipelineEntry>;
  setPicked: (keys: readonly string[]) => void;
  onViewChange: (bbox: Bbox | null, zoom: number) => void;
  updated: string | null;
  fileDate: string | null;
  section: (props: { open: boolean; onToggle: () => void }) => React.ReactNode;
  legend: () => React.ReactNode;
  about: () => React.ReactNode;
}

const ALL_GROUPS: ReadonlySet<PipelineSubstance> = new Set(PIPELINE_SUBSTANCES.map((s) => s.key));
/** When the section is first switched on (F-284): operating lines only, and no substance yet. */
export const PIPELINE_STATUSES_AT_START: ReadonlySet<string> = new Set(['Operating']);
export const PIPELINE_GROUPS_AT_START: ReadonlySet<PipelineSubstance> = new Set();

export function usePipelines(organizationId: string, token: string): Pipelines {
  // Off when the map opens (F-284).
  const [on, setOn] = useState(false);
  const [at, setAt] = useState<{ view: Bbox; zoom: number } | null>(null);
  const [squares, setSquares] = useState<ReadonlyMap<string, SquareRead>>(new Map());
  const [problem, setProblem] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<ReadonlySet<string>>(PIPELINE_STATUSES_AT_START);
  const [groups, setGroups] = useState<ReadonlySet<PipelineSubstance>>(PIPELINE_GROUPS_AT_START);
  const [licensee, setLicensee] = useState('');
  const [minMm, setMinMm] = useState(0);
  const [picked, setPickedKeys] = useState<readonly string[]>([]);
  const [loader] = useState(
    () =>
      new PipelineLoader(
        (key, read) => {
          setProblem(null);
          setSquares((before) => {
            const next = new Map(before);
            next.set(key, read);
            for (const oldest of next.keys()) {
              if (next.size <= KEPT) break;
              next.delete(oldest);
            }
            return next;
          });
        },
        (error) => {
          setProblem(
            error instanceof ApiError && error.code === 'PETROLEUM_NOT_READY'
              ? 'The oil and gas database is being updated. Try again in a few minutes.'
              : 'Some pipelines could not be loaded. Move the map to try again.',
          );
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

  // The load, from any square read: its area keeps the squares asked for within it.
  const load = useMemo(() => {
    for (const read of squares.values()) if (read.load) return read.load;
    return null;
  }, [squares]);
  const loadedNone = useMemo(
    () => squares.size > 0 && [...squares.values()].every((read) => read.load === null),
    [squares],
  );

  const needed = useMemo(
    () => (on && at ? pipelineSquaresFor(at.view, at.zoom, load?.area ?? null) : []),
    [on, at, load],
  );
  useEffect(() => {
    loader.want(needed, squares);
  }, [loader, needed, squares]);

  const entries = useMemo(() => pipelinesInSquares(needed, squares), [needed, squares]);
  const truncated = useMemo(
    () => needed.some((s) => squares.get(squareKey(s))?.truncated === true),
    [needed, squares],
  );
  const byKey = useMemo(() => new Map(entries.map((p) => [p.key, p])), [entries]);
  const shown = useMemo(
    () => pipelinesShown(entries, { statuses, groups, licensee, minMm }),
    [entries, statuses, groups, licensee, minMm],
  );
  const lines = useMemo(() => pipelineFeatures(shown), [shown]);
  const view = useMemo(
    (): PipelinesView | null => (on ? { lines, picked } : null),
    [on, lines, picked],
  );

  // Each substance's segments here, chosen or not, so a chip shows what it would add.
  const counts = useMemo(() => {
    const out = new Map<PipelineSubstance, number>();
    const each = pipelinesShown(entries, { statuses, groups: ALL_GROUPS, licensee, minMm });
    for (const p of each) out.set(p.group, (out.get(p.group) ?? 0) + 1);
    return out;
  }, [entries, statuses, licensee, minMm]);

  const onViewChange = useCallback((bbox: Bbox | null, zoom: number) => {
    setAt(bbox ? { view: bbox, zoom } : null);
  }, []);
  const setPicked = useCallback((keys: readonly string[]) => {
    setPickedKeys(keys.filter((k) => k.startsWith('pipeline:')));
  }, []);

  const toggle = <T,>(set: (fn: (before: ReadonlySet<T>) => ReadonlySet<T>) => void, value: T) => {
    set((before) => {
      const next = new Set(before);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const zoom = at?.zoom ?? 0;
  const level = pipelineLevelAt(zoom);
  const section = ({ open, onToggle }: { open: boolean; onToggle: () => void }) => (
    <MapSection
      title="Pipelines"
      open={open}
      onToggle={onToggle}
      on={on}
      onSwitch={setOn}
      sample={
        <span aria-hidden="true" className="flex gap-0.5">
          {(['gas', 'effluent', 'crude', 'water'] as const).map((g) => (
            <span
              key={g}
              className="h-0.5 w-2.5 self-center"
              style={{ backgroundColor: PIPELINE_COLOURS[g] }}
            />
          ))}
        </span>
      }
    >
      {problem && <p className="text-xs text-destructive">{problem}</p>}
      {loadedNone && (
        <p className="text-xs text-muted-foreground">
          Not loaded yet: an admin runs Load pipelines (GitHub → Actions).
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <span className={SIDE_LABEL}>Carries</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Substances shown">
          {PIPELINE_SUBSTANCES.map((s) => (
            <FilterChip
              key={s.key}
              dot={PIPELINE_COLOURS[s.key]}
              pressed={groups.has(s.key)}
              onClick={() => {
                toggle(setGroups, s.key);
              }}
            >
              {s.name}
              <span className="font-mono text-xs opacity-70">
                {(counts.get(s.key) ?? 0).toLocaleString('en-CA')}
              </span>
            </FilterChip>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className={SIDE_LABEL}>Status</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Statuses shown">
          {PIPELINE_STATUSES.map((status) => (
            <FilterChip
              key={status}
              pressed={statuses.has(status)}
              onClick={() => {
                toggle(setStatuses, status);
              }}
            >
              {status}
            </FilterChip>
          ))}
        </div>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className={SIDE_LABEL}>Licensee</span>
        <input
          type="search"
          className={SIDE_INPUT}
          placeholder="Any licensee"
          value={licensee}
          onChange={(event) => {
            setLicensee(event.target.value);
          }}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={SIDE_LABEL}>Size (outside diameter)</span>
        <select
          className={SIDE_INPUT}
          value={String(minMm)}
          onChange={(event) => {
            setMinMm(Number(event.target.value));
          }}
        >
          {PIPELINE_SIZES.map((s) => (
            <option key={s.mm} value={String(s.mm)}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      {groups.size === 0 && (
        <p className="text-xs text-muted-foreground">Pick what they carry to see pipelines.</p>
      )}
      <p className="text-xs text-muted-foreground">
        {`${shown.length.toLocaleString('en-CA')} segments shown here${pipelineLevelNote(level)}.`}
        {truncated && ' Some squares hold more lines than are drawn: zoom in to see them all.'}{' '}
        Faint: discontinued; fainter: abandoned or removed; dashed: permitted, not yet built.
      </p>
    </MapSection>
  );

  const legend = () =>
    !view || shown.length === 0 ? null : (
      <div className="flex flex-col gap-1.5">
        <LegendTitle>Pipelines here</LegendTitle>
        {PIPELINE_SUBSTANCES.filter((s) => groups.has(s.key) && (counts.get(s.key) ?? 0) > 0).map(
          (s) => (
            <p key={s.key} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-0.5 w-3 shrink-0"
                style={{ backgroundColor: PIPELINE_COLOURS[s.key] }}
              />
              <span className="grow">{s.name}</span>
              <span className="font-mono text-muted-foreground">
                {(counts.get(s.key) ?? 0).toLocaleString('en-CA')}
              </span>
            </p>
          ),
        )}
      </div>
    );

  const about = () => (
    <p>
      <strong className="font-medium text-foreground">Pipelines.</strong> The Alberta Energy
      Regulator’s pipeline file{load?.fileDate ? ` (its file of ${landDay(load.fileDate)})` : ''},
      for the area loaded: each segment’s licence and line, licensee, status, substances and pipe as
      the AER writes them. The federal lines of the Canada Energy Regulator are not shown yet. Where
      a line is drawn is the AER’s best information, not a survey. Data of the AER, shown to members
      only and not exported.
    </p>
  );

  return {
    view,
    byKey,
    setPicked,
    onViewChange,
    updated: load?.loadedAt ?? null,
    fileDate: load?.fileDate ?? null,
    section,
    legend,
    about,
  };
}
