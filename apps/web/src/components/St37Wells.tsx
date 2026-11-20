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
  ST37_COLOURS,
  ST37_OUTLINES,
  st37Features,
  st37ZoneFeatures,
  type St37MapWell,
  type St37MapZone,
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
  /** The formation loaded whole, with its wells by status; null for a rectangle. */
  formation: {
    key: string;
    name: string;
    totals: Partial<Record<St37StatusClass, number>>;
    /** Where its drilled wells cluster (F-255). */
    zones?: St37MapZone[];
  } | null;
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
  onViewChange: (bbox: Bbox | null) => void;
  panel: (tone: 'light' | 'dark', goTo: (bounds: MapBounds) => void) => React.ReactNode;
}

export function useSt37Wells(organizationId: string, token: string): St37State {
  const [on, setOn] = useState(true);
  const [hidden, setHidden] = useState<ReadonlySet<St37StatusClass>>(new Set());
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
  const shown = useMemo(
    () => ST37_STATUS_CLASSES.filter((status) => !hidden.has(status)),
    [hidden],
  );
  const outline = answer?.formation ? (ST37_OUTLINES[answer.formation.key] ?? null) : null;
  const outlineUrl = outline?.url ?? null;
  // The same zones come with every answer: kept as one object while they do not change.
  const zonesKey = JSON.stringify(answer?.formation?.zones ?? null);
  const zones = useMemo(() => {
    const list = JSON.parse(zonesKey) as St37MapZone[] | null;
    return list ? st37ZoneFeatures(list) : null;
  }, [zonesKey]);
  const mapView = useMemo<St37View | null>(
    () => (on ? { wells: features, shown, outline: outlineUrl, zones } : null),
    [on, features, shown, outlineUrl, zones],
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
          {answer?.formation && answer.source.area && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Formation
              </p>
              <Button
                size="sm"
                variant="outline"
                className="justify-between"
                onClick={() => {
                  const a = answer.source.area;
                  if (a) goTo([a.west, a.south, a.east, a.north]);
                }}
              >
                <span>{answer.formation.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formationTotal(answer.formation.totals).toLocaleString('en-CA')} wells
                </span>
              </Button>
            </div>
          )}
          {answer?.formation && (
            <FormationProduction
              name={answer.formation.name}
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
          {answer?.source.area && !answer.formation && (
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
              {answer?.formation && (
                <p>
                  Every well of the formation, whatever its status. The counts are those of the
                  wells in view. Shaded zones: where its drilled wells cluster.
                </p>
              )}
              {answer?.formation && (
                <FormationProductionAbout organizationId={organizationId} token={token} />
              )}
              <p>
                Zoomed out: how dense the wells are. Zoom in for each well and its drilled path;
                point at one for its details. A dashed line is a plan: straight from the surface
                location to the planned bottom hole of a well not drilled yet.
              </p>
              {outline && <p>{outline.credit}</p>}
              {answer && (
                <p>
                  {answer.source.loadedAt
                    ? `${answer.source.name}${
                        answer.source.sourceDate ? `, list of ${answer.source.sourceDate}` : ''
                      }${answer.source.licenceSource ? `; ${answer.source.licenceSource}` : ''}; loaded ${formatAlberta(answer.source.loadedAt, { weekday: false })}, for ${
                        answer.formation ? `the ${answer.formation.name} only` : 'one area'
                      } so far. Not an official record.`
                    : 'No wells loaded yet.'}
                </p>
              )}
            </div>
          </details>
        </>
      )}
    </div>
  );

  return { on, view: mapView, byUwi, onViewChange, panel };
}

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

const metres = (n: number) => `${n.toLocaleString('en-CA', { maximumFractionDigits: 0 })} m`;

/** The card of the wells under the pointer: the first in full, how many more share the place. */
export function St37Card({
  hover,
  byUwi,
  member,
}: {
  hover: St37Hover | null;
  byUwi: ReadonlyMap<string, St37MapWell>;
  /** Whose sign-in reads the well's monthly production (F-252 step 3); none shows no chart. */
  member?: { organizationId: string; token: string };
}) {
  if (!hover) return null;
  const [first, ...rest] = hover.uwis;
  const well = first === undefined ? undefined : byUwi.get(first);
  if (!well) return null;
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
  const up = hover.y > window.innerHeight - (member ? 380 : 180);
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-30 w-72 rounded-card border bg-card p-3 text-sm shadow-md"
      style={{
        left: hover.x,
        top: hover.y,
        transform: `translate(${left ? 'calc(-100% - 14px)' : '14px'}, ${up ? 'calc(-100% - 14px)' : '14px'})`,
      }}
    >
      <p className="font-semibold">{well.uwi}</p>
      <p className="font-mono text-xs text-muted-foreground">
        Licence {well.licenceNumber}
        {well.licensee ? ` · ${well.licensee}` : ''}
      </p>
      <p className="mt-1">{status}</p>
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
      {member && well.statusClass !== 'licensed' && (
        <WellProduction
          uwi={well.uwi}
          organizationId={member.organizationId}
          token={member.token}
        />
      )}
      {rest.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          +{rest.length} more {rest.length === 1 ? 'well' : 'wells'} here
        </p>
      )}
    </div>
  );
}
