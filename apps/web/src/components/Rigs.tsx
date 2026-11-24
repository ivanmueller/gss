import { albertaDay, formatAlberta, type Bbox, type MapSettings } from '@grain/domain';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, apiJson } from '../lib/api';
import { RIG_COLOUR, type RigsView } from '../lib/rigsMap';
import { landDay } from './LandPanel';
import { FilterChip, LegendTitle, MapSection, SIDE_INPUT, SIDE_LABEL } from './MapSide';

// Rigs on the oil and gas map (F-282; the owner, 2026-11-23: "Active rigs now and the last 30
// and 90 days, all of Alberta"): the AER's daily rig list (ST49) and its monthly archives, kept
// by the Worker, asked for once for 90 days and kept; the period and the filters are the page's.
// The AER lists when a rig starts on a well, never when it leaves: a rig is "now" at its latest
// well when it started there in the last 30 days.

/** The answer of GET /api/v1/petroleum/aer/rigs (apps/api/src/aer-lists.ts, rigsAnswer). */
interface Served {
  wellId: string;
  wellName: string;
  licenceNumber: string;
  licenseeBaId: string;
  licenseeName: string;
  contractorBaId: string;
  contractorName: string;
  rigNumber: string;
  activityType: string;
  activityAt: string;
  listDate: string;
  surfaceLocation: string | null;
  place: 'well' | 'lsd' | null;
  /** The licence's terminating zone as ST1 writes it ('SPIRIT RIVER FM'); null when unknown. */
  targetZone: string | null;
}
interface Answer {
  source: { latestListDate: string | null; lastSeenAt: string | null };
  days: number;
  listDates: string[];
  located: {
    features: { geometry: { coordinates: [number, number] }; properties: Served }[];
  };
  unlocated: Served[];
  truncated: boolean;
}

export type RigPeriod = 'now' | '30' | '90';

/** One move of a rig onto a well. */
export interface RigMove extends Served {
  key: string;
  /** The rig: its contractor's code and its number (or the well, for a rig with no number). */
  rig: string;
  longitude: number | null;
  latitude: number | null;
  /** The rig's latest move, started in the last 30 days: where it is now. */
  now: boolean;
}

const DAY = 86_400_000;
/** How long a rig is taken to stay on its latest well with no later move listed. */
export const RIG_NOW_DAYS = 30;

export const rigKey = (index: number) => `rig:${String(index)}`;

/** Every move, each with its rig and whether it is the rig's place now. */
export function rigMoves(answer: Answer, now: Date): RigMove[] {
  const rows = [
    ...answer.located.features.map((f) => ({
      ...f.properties,
      longitude: f.geometry.coordinates[0],
      latitude: f.geometry.coordinates[1],
    })),
    ...answer.unlocated.map((r) => ({ ...r, longitude: null, latitude: null })),
  ];
  const moves: RigMove[] = rows.map((r, i) => ({
    ...r,
    key: rigKey(i),
    rig:
      r.rigNumber.trim() === ''
        ? `${r.contractorBaId}|well:${r.wellId}`
        : `${r.contractorBaId}|${r.rigNumber.trim()}`,
    now: false,
  }));
  const latest = new Map<string, RigMove>();
  for (const m of moves) {
    const before = latest.get(m.rig);
    if (!before || m.activityAt > before.activityAt) latest.set(m.rig, m);
  }
  const since = now.getTime() - RIG_NOW_DAYS * DAY;
  for (const m of latest.values()) m.now = Date.parse(m.activityAt) >= since;
  return moves;
}

/** The moves shown for a period and the filters. */
export function rigsShown(
  moves: readonly RigMove[],
  period: RigPeriod,
  now: Date,
  filters: { contractor: string; operator: string; hidden: ReadonlySet<string> },
): RigMove[] {
  const since = period === 'now' ? null : now.getTime() - Number(period) * DAY;
  const contractor = filters.contractor.trim().toLowerCase();
  const operator = filters.operator.trim().toLowerCase();
  return moves.filter(
    (m) =>
      (period === 'now' ? m.now : Date.parse(m.activityAt) >= (since ?? 0)) &&
      !filters.hidden.has(m.activityType) &&
      (contractor === '' || m.contractorName.toLowerCase().includes(contractor)) &&
      (operator === '' || m.licenseeName.toLowerCase().includes(operator)),
  );
}

/**
 * The runs of three days or more in the period with no rig list held: the AER's archive for a
 * month not posted yet, or days before the lists were kept. Shorter gaps (a weekend with no
 * list) are left out.
 */
export function missingRuns(
  listDates: readonly string[],
  first: string,
  last: string,
): { from: string; to: string }[] {
  const held = new Set(listDates);
  const runs: { from: string; to: string }[] = [];
  let start: string | null = null;
  let previous = '';
  for (let t = Date.parse(`${first}T00:00:00Z`); t <= Date.parse(`${last}T00:00:00Z`); t += DAY) {
    const day = new Date(t).toISOString().slice(0, 10);
    if (!held.has(day)) {
      start ??= day;
    } else if (start !== null) {
      runs.push({ from: start, to: previous });
      start = null;
    }
    previous = day;
  }
  if (start !== null) runs.push({ from: start, to: previous });
  return runs.filter((r) => (Date.parse(r.to) - Date.parse(r.from)) / DAY >= 2);
}

/** The names with the most rigs now, most first. */
export function topBy(
  moves: readonly RigMove[],
  name: (m: RigMove) => string,
  limit = 5,
): { name: string; rigs: number }[] {
  const counts = new Map<string, number>();
  for (const m of moves) if (m.now) counts.set(name(m), (counts.get(name(m)) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([n, rigs]) => ({ name: n, rigs }));
}

/** How long ago, in whole days. */
export function daysAgo(at: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(at)) / DAY));
}

const inside = (m: RigMove, b: Bbox) =>
  m.longitude !== null &&
  m.latitude !== null &&
  m.longitude >= b.west &&
  m.longitude <= b.east &&
  m.latitude >= b.south &&
  m.latitude <= b.north;

export interface Rigs {
  view: RigsView | null;
  byKey: ReadonlyMap<string, RigMove>;
  /** Every move of a rig in the 90 days, newest first. */
  movesOf: (rig: string) => RigMove[];
  setPicked: (keys: readonly string[]) => void;
  onViewChange: (bbox: Bbox | null, zoom: number) => void;
  updated: string | null;
  /** Every setting of the section as it is now, and a way to set some of them (F-254). */
  settings: RigsSnapshot;
  apply: (settings: RigsSnapshot) => void;
  section: (props: { open: boolean; onToggle: () => void }) => React.ReactNode;
  legend: () => React.ReactNode;
  about: () => React.ReactNode;
}

/** The section's settings, with the activity types hidden, so Undo brings them back. */
export type RigsSnapshot = NonNullable<MapSettings['rigs']> & { hidden?: readonly string[] };

const PERIODS: { value: RigPeriod; label: string }[] = [
  { value: 'now', label: 'Now' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];

export function useRigs(organizationId: string, token: string): Rigs {
  // Off when the map opens (F-284): switched on from its section.
  const [on, setOn] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [period, setPeriod] = useState<RigPeriod>('now');
  const [contractor, setContractor] = useState('');
  const [operator, setOperator] = useState('');
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [picked, setPickedKeys] = useState<readonly string[]>([]);
  const [view, setView] = useState<Bbox | null>(null);
  // The moment "now" is reckoned from: when the answer came.
  const [now, setNow] = useState(() => new Date());

  const wanted = on && answer === null;
  useEffect(() => {
    if (!wanted) return;
    const controller = new AbortController();
    apiJson<Answer>(
      `/petroleum/aer/rigs?organization_id=${encodeURIComponent(organizationId)}&days=90`,
      token,
      { signal: controller.signal },
    )
      .then((got) => {
        setNow(new Date());
        setAnswer(got);
        setProblem(null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setProblem(
          error instanceof ApiError && error.code === 'PETROLEUM_NOT_READY'
            ? 'The oil and gas database is being updated. Try again in a few minutes.'
            : 'The rigs could not be loaded. Try again later.',
        );
      });
    return () => {
      controller.abort();
    };
  }, [wanted, organizationId, token]);

  const moves = useMemo(() => (answer ? rigMoves(answer, now) : []), [answer, now]);
  const byKey = useMemo(() => new Map(moves.map((m) => [m.key, m])), [moves]);
  const byRig = useMemo(() => {
    const map = new Map<string, RigMove[]>();
    for (const m of moves) map.set(m.rig, [...(map.get(m.rig) ?? []), m]);
    for (const list of map.values()) list.sort((a, b) => b.activityAt.localeCompare(a.activityAt));
    return map;
  }, [moves]);
  const shown = useMemo(
    () => rigsShown(moves, period, now, { contractor, operator, hidden }),
    [moves, period, now, contractor, operator, hidden],
  );
  const placed = useMemo(() => shown.filter((m) => m.longitude !== null), [shown]);
  const points = useMemo((): GeoJSON.FeatureCollection => {
    const span = (period === 'now' ? RIG_NOW_DAYS : Number(period)) * DAY;
    return {
      type: 'FeatureCollection',
      features: placed.map((m) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [m.longitude ?? 0, m.latitude ?? 0] },
        properties: {
          key: m.key,
          now: m.now,
          age: Math.min(1, Math.max(0, (now.getTime() - Date.parse(m.activityAt)) / span)),
        },
      })),
    };
  }, [placed, period, now]);
  const mapView = useMemo(
    (): RigsView | null => (on && answer ? { points, picked } : null),
    [on, answer, points, picked],
  );

  const activities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of moves) counts.set(m.activityType, (counts.get(m.activityType) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([type]) => type);
  }, [moves]);
  const nowShown = useMemo(() => shown.filter((m) => m.now), [shown]);
  const inView = useMemo(
    () => (view ? nowShown.filter((m) => inside(m, view)).length : null),
    [nowShown, view],
  );
  const unplaced = shown.length - placed.length;
  const gaps = useMemo(() => {
    if (!answer) return [];
    const first = albertaDay(new Date(now.getTime() - 90 * DAY));
    const last = answer.source.latestListDate ?? albertaDay(now);
    return missingRuns(answer.listDates, first, last);
  }, [answer, now]);

  const onViewChange = useCallback((bbox: Bbox | null) => {
    setView(bbox);
  }, []);
  const setPicked = useCallback((keys: readonly string[]) => {
    setPickedKeys(keys.filter((k) => k.startsWith('rig:')));
  }, []);
  const movesOf = useCallback((rig: string) => byRig.get(rig) ?? [], [byRig]);

  const toggle = (type: string) => {
    setHidden((before) => {
      const next = new Set(before);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const tops = (label: string, list: { name: string; rigs: number }[]) =>
    list.length === 0 ? null : (
      <div className="flex flex-col gap-1">
        <span className={SIDE_LABEL}>{label}</span>
        {list.map((row) => (
          <p key={row.name} className="flex items-baseline gap-2 text-[0.8125rem]">
            <span className="grow truncate">{row.name}</span>
            <span className="font-mono text-xs text-muted-foreground">{row.rigs}</span>
          </p>
        ))}
      </div>
    );

  const section = ({ open, onToggle }: { open: boolean; onToggle: () => void }) => (
    <MapSection
      title="Rigs"
      open={open}
      onToggle={onToggle}
      on={on}
      onSwitch={setOn}
      sample={
        <span
          aria-hidden="true"
          className="size-0 border-x-[5px] border-b-[9px] border-x-transparent"
          style={{ borderBottomColor: RIG_COLOUR }}
        />
      }
    >
      {problem && <p className="text-xs text-destructive">{problem}</p>}
      <div className="flex flex-col gap-1.5">
        <span className={SIDE_LABEL}>Period</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <FilterChip
              key={p.value}
              plain
              pressed={period === p.value}
              onClick={() => {
                setPeriod(p.value);
              }}
            >
              {p.label}
            </FilterChip>
          ))}
        </div>
      </div>
      {answer && (
        <p className="text-[0.8125rem]">
          <span className="font-mono font-semibold">{nowShown.length.toLocaleString('en-CA')}</span>{' '}
          {nowShown.length === 1 ? 'rig' : 'rigs'} on a well now
          {inView !== null && <span className="text-muted-foreground">, {inView} in view</span>}
          {period !== 'now' && (
            <>
              {'; '}
              <span className="font-mono font-semibold">
                {shown.length.toLocaleString('en-CA')}
              </span>{' '}
              {shown.length === 1 ? 'move' : 'moves'} in {period} days
            </>
          )}
        </p>
      )}
      <label className="flex flex-col gap-1.5">
        <span className={SIDE_LABEL}>Contractor</span>
        <input
          type="search"
          className={SIDE_INPUT}
          placeholder="Any drilling contractor"
          value={contractor}
          onChange={(event) => {
            setContractor(event.target.value);
          }}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={SIDE_LABEL}>Operator</span>
        <input
          type="search"
          className={SIDE_INPUT}
          placeholder="Any licensee"
          value={operator}
          onChange={(event) => {
            setOperator(event.target.value);
          }}
        />
      </label>
      {activities.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className={SIDE_LABEL}>Activity</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Activities shown">
            {activities.map((type) => (
              <FilterChip
                key={type}
                pressed={!hidden.has(type)}
                onClick={() => {
                  toggle(type);
                }}
              >
                {type}
              </FilterChip>
            ))}
          </div>
        </div>
      )}
      {tops(
        'Contractors with the most rigs now',
        topBy(shown, (m) => m.contractorName),
      )}
      {tops(
        'Operators with the most rigs now',
        topBy(shown, (m) => m.licenseeName),
      )}
      {answer && (
        <p className="text-xs text-muted-foreground">
          The AER lists when a rig starts on a well, not when it leaves: a rig is shown on its
          latest well if it started there in the last {RIG_NOW_DAYS} days.
          {unplaced > 0 &&
            ` ${unplaced.toLocaleString('en-CA')} not on the map yet (their licence's place is looked up twice a day).`}
          {gaps.length > 0 &&
            ` No rig list held for ${gaps
              .map((g) =>
                g.from === g.to ? landDay(g.from) : `${landDay(g.from)} to ${landDay(g.to)}`,
              )
              .join(', ')}: the AER posts each month's archive in the middle of the next month.`}
        </p>
      )}
    </MapSection>
  );

  const legend = () =>
    !mapView ? null : (
      <div className="flex flex-col gap-1.5">
        <LegendTitle>Rigs</LegendTitle>
        <p className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-0 shrink-0 border-x-[5px] border-b-[9px] border-x-transparent"
            style={{ borderBottomColor: RIG_COLOUR }}
          />
          <span className="grow">On a well now</span>
          <span className="font-mono text-muted-foreground">
            {nowShown.length.toLocaleString('en-CA')}
          </span>
        </p>
        {period !== 'now' && (
          <p className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full border border-stone-900"
              style={{ backgroundColor: RIG_COLOUR, opacity: 0.6 }}
            />
            <span className="grow">Earlier moves, fainter with age</span>
          </p>
        )}
      </div>
    );

  const about = () => (
    <p>
      <strong className="font-medium text-foreground">Rigs.</strong> The Alberta Energy Regulator’s
      ST49 daily drilling activity list and its monthly archives
      {answer?.source.latestListDate
        ? ` (latest list ${landDay(answer.source.latestListDate)})`
        : ''}
      , preliminary as the AER says; each rig placed at its well’s surface location from the AER’s
      list of every well licence. Data of the AER, shown to members only and not exported.
    </p>
  );

  return {
    view: mapView,
    byKey,
    movesOf,
    setPicked,
    onViewChange,
    updated: answer?.source.lastSeenAt ?? null,
    settings: { on, period, contractor, operator, hidden: [...hidden] },
    apply: (next: RigsSnapshot) => {
      if (next.on !== undefined) setOn(next.on);
      if (next.period) setPeriod(next.period);
      if (next.contractor !== undefined) setContractor(next.contractor);
      if (next.operator !== undefined) setOperator(next.operator);
      if (next.hidden) setHidden(new Set(next.hidden));
    },
    section,
    legend,
    about,
  };
}

/** The AER's short words in a zone's name, written out. */
const ZONE_WORDS: Record<string, string> = {
  FM: 'Formation',
  MBR: 'Member',
  GRP: 'Group',
  SS: 'Sandstone',
  SD: 'Sand',
  LS: 'Limestone',
  ZN: 'Zone',
};

/**
 * What a rig is drilling for, readable (F-283): 'SPIRIT RIVER FM' → 'Spirit River Formation',
 * 'MCMURRAY FM' → 'McMurray Formation'; null when the zone is not known.
 */
export function targetName(zone: string | null): string | null {
  if (zone === null || zone.trim() === '') return null;
  return zone
    .trim()
    .split(/\s+/)
    .map((word) => {
      const upper = word.toUpperCase();
      const full = ZONE_WORDS[upper];
      if (full) return full;
      const lower = word.toLowerCase();
      if (lower.startsWith('mc') && lower.length > 2) {
        return `Mc${lower.charAt(2).toUpperCase()}${lower.slice(3)}`;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/** A move's start, in Alberta time. */
export function rigStarted(m: RigMove): string {
  return formatAlberta(m.activityAt, { weekday: false });
}
