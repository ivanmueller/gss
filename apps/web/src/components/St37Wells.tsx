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
  ST37_OUTLINES,
  st37Features,
  st37Legs,
  st37ZoneFeatures,
  type St37MapWell,
  type St37MapZone,
  type St37Parts,
  type St37View,
} from '../lib/st37Map';
import type { St37Hover } from './FacilityMap';
import { FormationProduction, FormationProductionAbout, WellProduction } from './Production';
import { Button } from './ui/button';

/**
 * The AER's ST37 wells on the oil and gas map (F-243 part 4): a Wells panel (a switch, the
 * statuses as a legend that also hides and shows them, the source) and the card of the wells
 * under the pointer. Data from the AER, used on the owner's decision (docs/DECISIONS.md,
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
  panel: (tone: 'light' | 'dark', goTo: (bounds: MapBounds) => void) => React.ReactNode;
}

export function useSt37Wells(organizationId: string, token: string): St37State {
  const [on, setOn] = useState(true);
  const [hidden, setHidden] = useState<ReadonlySet<St37StatusClass>>(new Set());
  const [chosen, setChosen] = useState<string | null>(null);
  const [parts, setParts] = useState<St37Parts>(ST37_ALL_PARTS);
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
  const features = useMemo(() => st37Features(wells), [wells]);
  const byUwi = useMemo(() => new Map(wells.map((w) => [w.uwi, w])), [wells]);
  const legsOf = useMemo(() => st37Legs(wells), [wells]);
  const shown = useMemo(
    () => ST37_STATUS_CLASSES.filter((status) => !hidden.has(status)),
    [hidden],
  );
  const formations = useMemo(() => answer?.formations ?? [], [answer]);
  // The play the panel is about: the one chosen, or the first (the latest loaded).
  const formation = formations.find((f) => f.key === chosen) ?? formations[0] ?? null;
  const outline = formation ? (ST37_OUTLINES[formation.key] ?? null) : null;
  const outlineUrl = outline?.url ?? null;
  // The same zones come with every answer: kept as one object while they do not change.
  const zonesKey = JSON.stringify(formations.flatMap((f) => f.zones ?? []));
  const zones = useMemo(() => {
    const list = JSON.parse(zonesKey) as St37MapZone[];
    return list.length > 0 ? st37ZoneFeatures(list) : null;
  }, [zonesKey]);
  const mapView = useMemo<St37View | null>(
    () => (on ? { wells: features, shown, parts, outline: outlineUrl, zones } : null),
    [on, features, shown, parts, outlineUrl, zones],
  );
  // How many of each part are in view, beside its switch.
  const partCounts = useMemo(
    () => ({
      legs: legsOf.size,
      otherLegs: wells.length - legsOf.size,
      planned: wells.filter((w) => w.plannedBottom !== null).length,
    }),
    [wells, legsOf],
  );
  const counts = useMemo(() => {
    const out = new Map<St37StatusClass, number>();
    for (const w of wells) out.set(w.statusClass, (out.get(w.statusClass) ?? 0) + 1);
    return out;
  }, [wells]);

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

  const panel = (tone: 'light' | 'dark', goTo: (bounds: MapBounds) => void) => (
    <div
      className="flex w-72 flex-col gap-3 rounded-card border bg-card/95 p-3 shadow-xs"
      role="group"
      aria-label="Wells"
    >
      <label className="flex items-center justify-between gap-2 text-sm font-semibold">
        Wells
        <input
          type="checkbox"
          checked={on}
          onChange={(event) => {
            setOn(event.target.checked);
          }}
        />
      </label>
      {on && (
        <>
          {formations.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {formations.length === 1 ? 'Formation' : 'Formations'}
              </p>
              {formations.map((f) => (
                <Button
                  key={f.key}
                  size="sm"
                  variant="outline"
                  className="justify-between"
                  aria-pressed={formations.length > 1 ? f.key === formation?.key : undefined}
                  onClick={() => {
                    setChosen(f.key);
                    goTo([f.area.west, f.area.south, f.area.east, f.area.north]);
                  }}
                >
                  <span>{f.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formationTotal(f.totals).toLocaleString('en-CA')} wells
                  </span>
                </Button>
              ))}
            </div>
          )}
          {formation && (
            <FormationProduction
              formation={formation.key}
              name={formation.name}
              organizationId={organizationId}
              token={token}
            />
          )}
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Colour by status
            </p>
            <ul className="flex flex-col gap-0.5" aria-label="Statuses shown">
              {ST37_STATUS_CLASSES.map((status) => {
                const showing = !hidden.has(status);
                return (
                  <li key={status}>
                    <button
                      type="button"
                      aria-pressed={showing}
                      onClick={() => {
                        toggle(status);
                      }}
                      className="flex w-full items-center gap-2 rounded-sm px-1 py-0.5 text-left text-sm hover:bg-muted aria-[pressed=false]:opacity-45"
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
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {(counts.get(status) ?? 0).toLocaleString('en-CA')}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Show
            </p>
            <ul className="flex flex-col gap-0.5" aria-label="Parts of a well shown">
              {PARTS.map(({ key, label }) => (
                <li key={key}>
                  <label className="flex items-center gap-2 rounded-sm px-1 py-0.5 text-sm hover:bg-muted">
                    <input
                      type="checkbox"
                      checked={parts[key]}
                      onChange={(event) => {
                        setParts((before) => ({ ...before, [key]: event.target.checked }));
                      }}
                    />
                    <span className="grow">{label}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {partCounts[key].toLocaleString('en-CA')}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
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
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const a = answer.source.area;
                if (a) goTo([a.west, a.south, a.east, a.north]);
              }}
            >
              Go to the wells loaded
            </Button>
          )}
          {/* What the panel shows and where it comes from, out of the way until asked for (the
              owner, 2026-11-20). The sources stay here: their terms ask that they be named. */}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none hover:text-foreground">
              About this data
            </summary>
            <div className="mt-1.5 flex flex-col gap-1.5">
              {formation && (
                <p>
                  Every well of a formation, whatever its status. The counts are those of the wells
                  in view. Shaded zones: where its drilled wells cluster.
                </p>
              )}
              {formation && (
                <FormationProductionAbout
                  formation={formation.key}
                  organizationId={organizationId}
                  token={token}
                />
              )}
              <p>
                Zoomed out: how dense the wells are. Zoom in for each well and its drilled path;
                point at one for its details. A dashed line is a plan: straight from the surface
                location to the planned bottom hole of a well not drilled yet.
              </p>
              <p>
                A well is every leg drilled under one licence. Its main leg is the most active one;
                its other legs are the rest (an earlier hole, a sidetrack, an extra leg): the list
                does not say which kind. With main legs off, a well is one dot at its surface
                location; point at it to see all its legs. A well's production is its legs' added
                together; a dashed line on its charts marks the month a later leg starts. Click a
                well to keep its card open, then a leg for its production alone.
              </p>
              {outline && <p>{outline.credit}</p>}
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
            </div>
          </details>
        </>
      )}
    </div>
  );

  return { on, view: mapView, byUwi, legsOf, onViewChange, panel };
}

/** The parts of a well the panel switches on and off (F-257), in its order. */
const PARTS: { key: keyof St37Parts; label: string }[] = [
  { key: 'legs', label: 'Main legs' },
  { key: 'otherLegs', label: 'Other legs' },
  { key: 'planned', label: 'Planned lines' },
];

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

/**
 * The card of the wells under the pointer: the first well whole (its main leg in full, then
 * every leg under its licence, F-257), and how many more wells share the place.
 */
export function St37Card({
  hover,
  byUwi,
  legsOf,
  member,
  kept = false,
  onClose,
}: {
  hover: St37Hover | null;
  /**
   * Whether the card is kept open after a click (F-258): it can then be pointed at and clicked,
   * to see one leg's production instead of the well's total, and closed.
   */
  kept?: boolean;
  onClose?: () => void;
  byUwi: ReadonlyMap<string, St37MapWell>;
  /** Each well's legs by licence number, the main leg first; without it, the leg alone. */
  legsOf?: ReadonlyMap<string, St37MapWell[]>;
  /** Whose sign-in reads the well's monthly production (F-252 step 3); none shows no chart. */
  member?: { organizationId: string; token: string };
}) {
  // The leg whose production is shown alone; another well's leg counts as none.
  const [chosen, setChosen] = useState<string | null>(null);
  if (!hover) return null;
  const [first] = hover.uwis;
  const pointed = first === undefined ? undefined : byUwi.get(first);
  if (!pointed) return null;
  const legs = legsOf?.get(pointed.licenceNumber) ?? [pointed];
  const well = legs[0] ?? pointed;
  // The other wells under the pointer: other licences, not this well's own legs.
  const others = new Set(
    hover.uwis
      .map((uwi) => byUwi.get(uwi)?.licenceNumber)
      .filter((licence) => licence !== undefined && licence !== well.licenceNumber),
  ).size;
  const alone = kept ? legs.find((leg) => leg.uwi === chosen) : undefined;
  const status = [ST37_STATUS_LABELS[well.statusClass], well.statusFluid, well.statusType]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
  const depth = [
    well.spudDate && `Spud ${well.spudDate}`,
    well.totalDepthM !== null &&
      `TD ${metres(well.totalDepthM)}${
        well.trueVerticalDepthM !== null ? ` (TVD ${metres(well.trueVerticalDepthM)})` : ''
      }`,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
  // Opens to the left of the pointer near the window's right edge, and above it near the bottom.
  const left = hover.x > window.innerWidth - 340;
  const up = hover.y > window.innerHeight - (member ? 380 : 180) - (legs.length > 1 ? 80 : 0);
  return (
    <div
      role="status"
      className={`absolute z-30 w-72 rounded-card border bg-card p-3 text-sm shadow-md ${
        kept ? '' : 'pointer-events-none'
      }`}
      style={{
        left: hover.x,
        top: hover.y,
        transform: `translate(${left ? 'calc(-100% - 14px)' : '14px'}, ${up ? 'calc(-100% - 14px)' : '14px'})`,
      }}
    >
      {kept && onClose && (
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute top-1.5 right-1.5 rounded-sm px-1.5 text-base leading-none text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          ×
        </button>
      )}
      <p className="font-semibold">{well.uwi}</p>
      <p className="font-mono text-xs text-muted-foreground">
        Licence {well.licenceNumber}
        {well.licensee ? ` · ${well.licensee}` : ''}
      </p>
      <p className="mt-1">{status}</p>
      {st37Place(well) && <p className="text-muted-foreground">{st37Place(well)}</p>}
      {depth && <p className="text-muted-foreground">{depth}</p>}
      {(well.statusClass === 'licensed' || well.statusClass === 'drilling') && st37Plan(well) && (
        <p className="text-muted-foreground">{st37Plan(well)}</p>
      )}
      {well.plannedBottom && (
        <p className="mt-1 text-xs text-muted-foreground">
          The dashed line is the plan: straight from the surface location to the planned bottom
          hole. The drilled path comes once the well is drilled.
        </p>
      )}
      {legs.length > 1 && (
        <div className="mt-1.5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {legs.length} legs
          </p>
          <ul className="text-xs" aria-label="Legs of this well">
            {legs.map((leg, i) => (
              <li key={leg.uwi}>
                <button
                  type="button"
                  disabled={!kept}
                  aria-pressed={kept ? leg.uwi === alone?.uwi : undefined}
                  onClick={() => {
                    setChosen(leg.uwi === alone?.uwi ? null : leg.uwi);
                  }}
                  className="flex w-full items-baseline gap-1.5 rounded-sm px-1 text-left enabled:hover:bg-muted aria-pressed:bg-muted"
                >
                  <span
                    aria-hidden="true"
                    className="inline-block size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: ST37_COLOURS.light[leg.statusClass] }}
                  />
                  <span className="font-mono">{leg.uwi}</span>
                  <span className="text-muted-foreground">
                    {[
                      i === 0 ? 'main leg' : null,
                      ST37_STATUS_LABELS[leg.statusClass],
                      leg.totalDepthM !== null ? `TD ${metres(leg.totalDepthM)}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {member && well.statusClass !== 'licensed' && (
        <>
          {legs.length > 1 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {alone
                ? `Production of leg ${alone.uwi} alone. Click it again for the well's total.`
                : kept
                  ? 'Production of all legs together. Click a leg for its own.'
                  : 'Production of all legs together. Click the well to choose a leg.'}
            </p>
          )}
          <WellProduction
            uwis={alone ? [alone.uwi] : legs.map((leg) => leg.uwi)}
            organizationId={member.organizationId}
            token={member.token}
            interactive={kept}
          />
        </>
      )}
      {others > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          +{others} more {others === 1 ? 'well' : 'wells'} here
        </p>
      )}
    </div>
  );
}
