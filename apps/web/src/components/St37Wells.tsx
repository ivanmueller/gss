import {
  formatAlberta,
  ST37_STATUS_CLASSES,
  ST37_STATUS_LABELS,
  type Bbox,
  type St37StatusClass,
} from '@grain/domain';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { apiJson } from '../lib/api';
import type { MapBounds } from '../lib/mapbox';
import {
  ST37_ALL_PARTS,
  ST37_COLOURS,
  st37Features,
  st37Legs,
  st37ZoneFeatures,
  type St37MapWell,
  type St37MapZone,
  type St37View,
} from '../lib/st37Map';
import {
  FilterChip,
  Fold,
  LegendTitle,
  MapSection,
  SIDE_ACCENT,
  SIDE_INPUT,
  SIDE_LABEL,
  SIDE_SELECT,
} from './MapSide';
import { FormationProduction, FormationProductionAbout } from './Production';

/**
 * The AER's ST37 wells on the oil and gas map (F-243 part 4): the Wells & licences section of
 * the side card (a switch, the play and operator, the statuses as chips that hide and show
 * them, the play's production) and its legend (F-267). The box at the pointer and
 * the panel of a well clicked are in St37Panel.tsx (F-265). Data from the AER, used on the owner's decision (docs/DECISIONS.md,
 * 2026-11-19): its name and the list's date are always shown, and nothing here offers a download.
 */

interface Answer {
  source: {
    name: string;
    loadedAt: string | null;
    sourceDate: string | null;
    area: Bbox | null;
    licenceSource: string | null;
  };
  /** Each play loaded whole (F-256): where it lies, its wells by status, its zones. */
  formations?: {
    key: string;
    name: string;
    area: Bbox;
    totals: Partial<Record<St37StatusClass, number>>;
    /** Where its drilled wells cluster (F-255). */
    zones?: St37MapZone[];
  }[];
  truncated: boolean;
  wells: St37MapWell[];
}

/** Wells are only in Alberta: a view is cut to it before asking. */
const ALBERTA: Bbox = { west: -120.1, south: 48.9, east: -109.9, north: 60.1 };

/** The box asked for: the view and half again on each side, within Alberta; null outside it. */
export function st37Request(view: Bbox): Bbox | null {
  const padX = (view.east - view.west) / 2;
  const padY = (view.north - view.south) / 2;
  const box = {
    west: Math.max(ALBERTA.west, view.west - padX),
    south: Math.max(ALBERTA.south, view.south - padY),
    east: Math.min(ALBERTA.east, view.east + padX),
    north: Math.min(ALBERTA.north, view.north + padY),
  };
  return box.west < box.east && box.south < box.north ? box : null;
}

/** Whether the wells already asked for cover this view (no new request needed). */
export function st37Covers(asked: Bbox, view: Bbox): boolean {
  const inside = st37Request(view);
  if (inside === null) return true;
  const cut = {
    west: Math.max(ALBERTA.west, view.west),
    south: Math.max(ALBERTA.south, view.south),
    east: Math.min(ALBERTA.east, view.east),
    north: Math.min(ALBERTA.north, view.north),
  };
  return (
    cut.west >= asked.west &&
    cut.east <= asked.east &&
    cut.south >= asked.south &&
    cut.north <= asked.north
  );
}

/** The last answer that came back (or failed), and the box it was for. */
interface Settled {
  key: string;
  asked: Bbox;
  answer: Answer | null;
  failed: boolean;
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;

export interface St37State {
  on: boolean;
  view: St37View | null;
  byUwi: ReadonlyMap<string, St37MapWell>;
  /** Each well's legs by licence number, the main leg first (F-257). */
  legsOf: ReadonlyMap<string, St37MapWell[]>;
  onViewChange: (bbox: Bbox | null) => void;
  /** Each play loaded whole, for the card's Jump to buttons (F-267). */
  formations: readonly { key: string; name: string; area: Bbox }[];
  /** Makes a play the one the section is about. */
  choose: (key: string) => void;
  /** When the wells were last loaded; null before an answer. */
  updated: string | null;
  section: (props: {
    open: boolean;
    onToggle: () => void;
    tone: 'light' | 'dark';
    goTo: (bounds: MapBounds) => void;
  }) => React.ReactNode;
  /** What each line's colour means, with the wells in view; null when the wells are off. */
  legend: (tone: 'light' | 'dark') => React.ReactNode;
  /** What the section shows and where it comes from, for Sources & licence. */
  about: () => React.ReactNode;
}

export function useSt37Wells(organizationId: string, token: string): St37State {
  const [on, setOn] = useState(true);
  const [hidden, setHidden] = useState<ReadonlySet<St37StatusClass>>(new Set());
  const [chosen, setChosen] = useState<string | null>(null);
  const [operator, setOperator] = useState('');
  const [view, setView] = useState<Bbox | null>(null);
  const [settled, setSettled] = useState<Settled | null>(null);

  // Ask again only when the view leaves the box of the last good answer.
  const asked = settled && !settled.failed ? settled.asked : null;
  const box =
    on && view !== null && (asked === null || !st37Covers(asked, view)) ? st37Request(view) : null;
  const key = box
    ? `${String(round(box.west))},${String(round(box.south))},${String(round(box.east))},${String(round(box.north))}`
    : null;
  const loading = key !== null && settled?.key !== key;
  const failed = settled?.failed === true && settled.key === key;

  useEffect(() => {
    if (key === null || box === null) return;
    const controller = new AbortController();
    const query = new URLSearchParams({
      organization_id: organizationId,
      west: String(round(box.west)),
      south: String(round(box.south)),
      east: String(round(box.east)),
      north: String(round(box.north)),
    });
    apiJson<Answer>(`/petroleum/st37/wells?${query.toString()}`, token, {
      signal: controller.signal,
    })
      .then((answer) => {
        setSettled({ key, asked: box, answer, failed: false });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // The wells already drawn stay; moving the map asks again.
        setSettled((before) => ({ key, asked: box, answer: before?.answer ?? null, failed: true }));
      });
    return () => {
      controller.abort();
    };
    // `box` is described by `key`; asking again for the same box would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, organizationId, token]);

  const answer = settled?.answer ?? null;
  const wells = useMemo(() => answer?.wells ?? [], [answer]);
  // The wells drawn: those of an operator whose name holds the text typed (F-267). A clicked
  // well's panel still reads every well loaded.
  const listed = useMemo(() => st37ByOperator(wells, operator), [wells, operator]);
  const features = useMemo(() => st37Features(listed), [listed]);
  const byUwi = useMemo(() => new Map(wells.map((w) => [w.uwi, w])), [wells]);
  const legsOf = useMemo(() => st37Legs(wells), [wells]);
  const shown = useMemo(
    () => ST37_STATUS_CLASSES.filter((status) => !hidden.has(status)),
    [hidden],
  );
  const formations = useMemo(() => answer?.formations ?? [], [answer]);
  // The play the section is about: the one chosen, or the first (the latest loaded).
  const formation = formations.find((f) => f.key === chosen) ?? formations[0] ?? null;
  // The same zones come with every answer: kept as one object while they do not change.
  const zonesKey = JSON.stringify(formations.flatMap((f) => f.zones ?? []));
  const zones = useMemo(() => {
    const list = JSON.parse(zonesKey) as St37MapZone[];
    return list.length > 0 ? st37ZoneFeatures(list) : null;
  }, [zonesKey]);
  // Every part of a well is drawn: its main leg, its other legs and its planned line. Their
  // switches were taken off the panel (the owner, 2026-11-22, F-267). The play's outline is the
  // Formations section's, switched there (F-280).
  const mapView = useMemo<St37View | null>(
    () => (on ? { wells: features, shown, parts: ST37_ALL_PARTS, zones } : null),
    [on, features, shown, zones],
  );
  const counts = useMemo(() => {
    const out = new Map<St37StatusClass, number>();
    for (const w of listed) out.set(w.statusClass, (out.get(w.statusClass) ?? 0) + 1);
    return out;
  }, [listed]);

  const onViewChange = useCallback((bbox: Bbox | null) => {
    setView(bbox);
  }, []);

  const toggle = (status: St37StatusClass) => {
    setHidden((before) => {
      const next = new Set(before);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const section = ({
    open,
    onToggle,
    tone,
    goTo,
  }: {
    open: boolean;
    onToggle: () => void;
    tone: 'light' | 'dark';
    goTo: (bounds: MapBounds) => void;
  }) => (
    <MapSection
      title="Wells & licences"
      open={open}
      onToggle={onToggle}
      on={on}
      onSwitch={setOn}
      chip={formation?.name ?? null}
      sample={
        <span aria-hidden="true" className="flex shrink-0 items-center gap-0.5">
          {(['producing', 'suspended', 'abandoned', 'drilling'] as const).map((status) => (
            <span
              key={status}
              className="size-2 rounded-full"
              style={{ backgroundColor: ST37_COLOURS[tone][status] }}
            />
          ))}
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        {formations.length > 0 && (
          <label className="flex flex-col gap-1.5">
            <span className={SIDE_LABEL}>Producing formation</span>
            <select
              className={SIDE_SELECT}
              value={formation?.key ?? ''}
              onChange={(event) => {
                const f = formations.find((one) => one.key === event.target.value);
                if (!f) return;
                setChosen(f.key);
                goTo([f.area.west, f.area.south, f.area.east, f.area.north]);
              }}
            >
              {formations.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1.5">
          <span className={SIDE_LABEL}>Operator</span>
          <input
            type="search"
            className={SIDE_INPUT}
            placeholder="Any operator"
            value={operator}
            onChange={(event) => {
              setOperator(event.target.value);
            }}
          />
        </label>
      </div>
      <div className="flex items-start gap-3">
        <span className={`${SIDE_LABEL} pt-2`}>Show</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Statuses shown">
          {ST37_STATUS_CLASSES.map((status) => (
            <FilterChip
              key={status}
              dot={ST37_COLOURS[tone][status]}
              pressed={!hidden.has(status)}
              onClick={() => {
                toggle(status);
              }}
            >
              {CHIP_LABELS[status]}
            </FilterChip>
          ))}
        </div>
      </div>
      {formation && (
        <p className="text-xs text-muted-foreground">
          {formationTotal(formation.totals).toLocaleString('en-CA')} wells in the {formation.name},
          every status; {listed.length.toLocaleString('en-CA')} in view
          {operator.trim() ? ' for this operator' : ''}.
        </p>
      )}
      {formation && (
        <Fold label="Production" note={`${formation.name} · by month`}>
          <FormationProduction
            formation={formation.key}
            name={formation.name}
            organizationId={organizationId}
            token={token}
          />
        </Fold>
      )}
      {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {failed && (
        <p className="text-xs text-destructive">
          The wells could not be loaded. Move the map to try again.
        </p>
      )}
      {answer?.truncated && (
        <p className="text-xs text-muted-foreground">
          More wells than can be drawn at once here: zoom in to see every one.
        </p>
      )}
      {answer?.source.area && (
        <button
          type="button"
          className="self-start text-[0.8125rem] font-medium underline-offset-2 hover:underline"
          style={{ color: SIDE_ACCENT }}
          onClick={() => {
            const a = answer.source.area;
            if (a) goTo([a.west, a.south, a.east, a.north]);
          }}
        >
          Go to the wells loaded →
        </button>
      )}
    </MapSection>
  );

  const legend = (tone: 'light' | 'dark') =>
    !on ? null : (
      <div role="group" aria-label="Wells legend">
        <LegendTitle>Wells</LegendTitle>
        <ul className="mt-2 flex flex-col gap-1">
          {ST37_STATUS_CLASSES.map((status) => (
            <li
              key={status}
              className={`flex items-center gap-2 ${hidden.has(status) ? 'opacity-45' : ''}`}
            >
              <svg width="22" height="8" aria-hidden="true" className="shrink-0">
                <line
                  x1="1"
                  y1="4"
                  x2="16"
                  y2="4"
                  stroke={ST37_COLOURS[tone][status]}
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <circle cx="18" cy="4" r="2.5" fill={ST37_COLOURS[tone][status]} />
              </svg>
              <span className="grow">{ST37_STATUS_LABELS[status]}</span>
              <span className="text-muted-foreground tabular-nums">
                {(counts.get(status) ?? 0).toLocaleString('en-CA')}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-muted-foreground">
          The numbers are the wells in view. Zoom in to see every well.
        </p>
      </div>
    );

  const about = () => (
    <>
      <p>
        <strong className="font-medium text-foreground">Wells &amp; licences.</strong>{' '}
        {formation
          ? 'Every well of a formation, whatever its status. Shaded zones: where its drilled wells cluster. '
          : ''}
        Zoomed out: how dense the wells are. Zoom in for each well and its drilled path; point at
        one for its details. A dashed line is a plan: straight from the surface location to the
        planned bottom hole of a well not drilled yet; zoomed out, where the line is too short to
        see, it is one dot where it starts.
      </p>
      {formation && (
        <FormationProductionAbout
          formation={formation.key}
          organizationId={organizationId}
          token={token}
        />
      )}
      <p>
        A well is every leg drilled under one licence. Its main leg is the most active one; its
        other legs are the rest (an earlier hole, a sidetrack, an extra leg): the list does not say
        which kind. Point at a leg, from about the 10 km distance bar and closer: that leg is drawn
        a little bolder and a box at the pointer gives its details. Click it for the whole well in a
        panel on the right: every leg, and its production, which is its legs' added together; a
        dashed line on its charts marks the month a later leg starts. Click a leg, on the map or in
        the panel, for that leg's own production under the well's.
      </p>
      {answer && (
        <p>
          {answer.source.loadedAt
            ? `${answer.source.name}${
                answer.source.sourceDate ? `, list of ${answer.source.sourceDate}` : ''
              }${answer.source.licenceSource ? `; ${answer.source.licenceSource}` : ''}; loaded ${formatAlberta(answer.source.loadedAt, { weekday: false })}, for ${
                formations.length > 0
                  ? `the ${formations.map((f) => f.name).join(', ')} only`
                  : 'one area'
              } so far. Fields and pools named from the Alberta Energy Regulator's ST103 list. Not an official record.`
            : 'No wells loaded yet.'}
        </p>
      )}
    </>
  );

  return {
    on,
    view: mapView,
    byUwi,
    legsOf,
    onViewChange,
    formations,
    choose: setChosen,
    updated: answer?.source.loadedAt ?? null,
    section,
    legend,
    about,
  };
}

/** The wells of the operators whose name holds the text typed; every well for no text. */
export function st37ByOperator(wells: readonly St37MapWell[], operator: string): St37MapWell[] {
  const text = operator.trim().toLowerCase();
  if (text === '') return [...wells];
  return wells.filter((w) => (w.licensee ?? '').toLowerCase().includes(text));
}

/** The statuses in a word or two, for the chips; the legend gives them in full. */
const CHIP_LABELS: Record<St37StatusClass, string> = {
  producing: 'Producing',
  awaiting: 'Awaiting production',
  drilling: 'Drilling',
  inactive: 'Closed',
  suspended: 'Suspended',
  abandoned: 'Abandoned',
  licensed: 'Licensed',
};

function formationTotal(totals: Partial<Record<St37StatusClass, number>>): number {
  return Object.values(totals).reduce((sum, n) => sum + n, 0);
}

/**
 * What a licence planned, for a well not drilled yet: "Planned horizontal in the Duvernay Fm,
 * 5,300 m measured depth · Licensed 2026-11-19"; null when the load read no plan.
 */
export function st37Plan(well: St37MapWell): string | null {
  const parts: string[] = [];
  if (well.plannedOperation || well.plannedFormation || well.plannedDepthM !== null) {
    const what = [
      `Planned${well.plannedOperation ? ` ${well.plannedOperation.toLowerCase()}` : ''}`,
      well.plannedFormation && `in the ${well.plannedFormation}`,
    ]
      .filter(Boolean)
      .join(' ');
    parts.push(
      well.plannedDepthM !== null ? `${what}, ${metres(well.plannedDepthM)} measured depth` : what,
    );
  }
  if (well.licenceDate) parts.push(`Licensed ${well.licenceDate}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** KAYBOB SOUTH → Kaybob South: a field's or pool's name as the AER writes it, for reading. */
function readable(name: string): string {
  return name
    .toLowerCase()
    .replace(
      /(^|[^a-z])([a-z])/g,
      (_, before: string, letter: string) => `${before}${letter.toUpperCase()}`,
    );
}

/**
 * A well's field and pool: "Kaybob South field · Duvernay A pool"; a pool the AER's list does
 * not name is shown by its code; null for a well with neither.
 */
export function st37Place(well: St37MapWell): string | null {
  const parts = [
    well.fieldName && `${readable(well.fieldName)} field`,
    well.poolName
      ? `${readable(well.poolName)} pool`
      : well.poolCode != null && `pool ${String(well.poolCode)}`,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' · ') : null;
}

const metres = (n: number) => `${n.toLocaleString('en-CA', { maximumFractionDigits: 0 })} m`;
