import {
  MATURITY_MIN_S2,
  MATURITY_RO_EDGES,
  MATURITY_WINDOW_LABELS,
  type MaturityWindow,
} from '@grain/domain';
import { useEffect, useState } from 'react';

import { apiJson } from '../lib/api';
import { PanelTiles } from './MapPanel';

/**
 * A well's Geology section (F-287 part 2): its play's zone under it in the Alberta Geological
 * Survey's model (depth, thickness, where each leg's lateral lies in it), the tops the Survey
 * picked in it or in the nearest picked wells, and the nearest Rock-Eval samples with the
 * maturity each one reads. The answer of GET /petroleum/geology/well
 * (apps/api/src/petro-geology.ts).
 */

export interface GeologyPick {
  name: string;
  zone: number | null;
  tvdM: number;
  elevationM: number | null;
  source: 'unknown' | 'Survey' | 'AER';
}

export interface GeologyAnswer {
  source: {
    picks: { name: string; loadedAt: string | null; sourceDate: string | null };
    samples: { name: string; loadedAt: string | null; sourceDate: string | null };
    model: { name: string; loadedAt: string | null };
  };
  play: { key: string; zone: number; name: string } | null;
  zoneHere: { topDepthM: number | null; topElevationM: number; thicknessM: number } | null;
  legs: {
    uwi: string;
    points: number;
    inside: number;
    belowTopM: number | null;
    aboveBaseM: number | null;
  }[];
  picked: { uwi: string; own: boolean; distanceKm: number; picks: GeologyPick[] }[];
  samples: {
    sampleId: number;
    run: number;
    uwi: string | null;
    own: boolean;
    distanceKm: number;
    unit: string | null;
    lithology: string | null;
    depthM: string | null;
    collectedOn: string | null;
    tmaxC: string | null;
    tocPct: string | null;
    hydrogenIndex: string | null;
    ro: number | null;
    window: MaturityWindow | null;
    note: 'no-tmax' | 'small-s2' | null;
  }[];
  reach: { picksKm: number; samplesKm: number };
}

/** The answers read in this visit, by well: a panel opened again asks nothing. */
const geologyRead = new Map<string, Promise<GeologyAnswer>>();

/** For tests: forget the answers read. */
export function clearGeology() {
  geologyRead.clear();
}

function useGeology(organizationId: string, token: string, uwi: string) {
  const key = `${organizationId}|${uwi}`;
  const [state, setState] = useState<{ key: string; value: GeologyAnswer | 'failed' } | null>(null);
  useEffect(() => {
    let live = true;
    let read = geologyRead.get(key);
    if (!read) {
      read = apiJson<GeologyAnswer>(
        `/petroleum/geology/well?${new URLSearchParams({ organization_id: organizationId, uwi }).toString()}`,
        token,
      );
      geologyRead.set(key, read);
      read.catch(() => geologyRead.delete(key));
    }
    read
      .then((value) => {
        if (live) setState({ key, value });
      })
      .catch(() => {
        if (live) setState({ key, value: 'failed' });
      });
    return () => {
      live = false;
    };
  }, [key, organizationId, token, uwi]);
  return state?.key === key ? state.value : null;
}

const metres = (m: number) => `${m.toLocaleString('en-CA', { maximumFractionDigits: 0 })} m`;
const km = (d: number) => `${d.toLocaleString('en-CA', { maximumFractionDigits: 1 })} km`;

/** The colour of each window's dot: cool for immature, warm toward gas. */
export const WINDOW_COLOURS: Record<MaturityWindow, string> = {
  immature: '#9ca3af',
  oil: '#15803d',
  condensate: '#d97706',
  'dry-gas': '#dc2626',
};

/** The picks shown first: the play's zone and the two zones each side of it. */
function nearPlay(picks: readonly GeologyPick[], zone: number | null) {
  if (zone === null) return picks;
  return picks.filter((p) => p.zone !== null && Math.abs(p.zone - zone) <= 2);
}

function PickList({ picks }: { picks: readonly GeologyPick[] }) {
  return (
    <ul className="mt-1 flex flex-col gap-0.5 text-xs">
      {picks.map((p) => (
        <li
          key={`${p.name}|${String(p.tvdM)}`}
          className="flex items-baseline justify-between gap-2"
        >
          <span>{p.name}</span>
          <span className="font-mono text-muted-foreground tabular-nums">
            {metres(p.tvdM)} TVD
            {p.source === 'AER' ? ' · AER' : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function WellGeology({
  organizationId,
  token,
  uwi,
}: {
  organizationId: string;
  token: string;
  uwi: string;
}) {
  const geology = useGeology(organizationId, token, uwi);
  if (geology === 'failed') {
    return <p className="text-xs text-muted-foreground">The geology could not be loaded.</p>;
  }
  if (geology === null) return <p className="text-xs text-muted-foreground">Geology: loading…</p>;
  if (!geology.source.picks.loadedAt && !geology.source.samples.loadedAt) {
    return (
      <p className="text-xs text-muted-foreground">
        The Survey&rsquo;s geology is not loaded yet: GitHub → Actions → Load geology.
      </p>
    );
  }
  const { play, zoneHere } = geology;
  const legs = geology.legs.filter((l) => l.points > 0);
  const points = legs.reduce((n, l) => n + l.points, 0);
  const inside = legs.reduce((n, l) => n + l.inside, 0);
  const own = geology.picked.filter((p) => p.own);
  const nearest = geology.picked.filter((p) => !p.own);
  const ownPicks = own.flatMap((p) => p.picks).sort((a, b) => a.tvdM - b.tvdM);
  const shownWell = own.length > 0 ? null : (nearest[0] ?? null);
  const listed = shownWell ? shownWell.picks : ownPicks;
  const first = nearPlay(listed, play?.zone ?? null);
  return (
    <div>
      {play && zoneHere && (
        <PanelTiles
          tiles={[
            {
              label: `${play.name} top`,
              value: zoneHere.topDepthM === null ? '—' : metres(zoneHere.topDepthM),
              title: `${metres(zoneHere.topElevationM)} above sea level`,
            },
            { label: 'Thickness', value: metres(zoneHere.thicknessM) },
            {
              label: 'Lateral in zone',
              value: points > 0 ? `${String(Math.round((inside / points) * 100))}%` : '—',
              title: points > 0 ? `${String(inside)} of ${String(points)} points` : undefined,
            },
          ]}
        />
      )}
      {play && !zoneHere && (
        <p className="text-xs text-muted-foreground">
          The Survey&rsquo;s model has no {play.name} under this well&rsquo;s bottom hole.
        </p>
      )}
      {play && zoneHere && legs.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5 text-xs" aria-label="Legs in the zone">
          {legs.map((leg) => (
            <li key={leg.uwi}>
              {legs.length > 1 && <span className="font-mono">{leg.uwi} </span>}
              {leg.belowTopM === null || leg.aboveBaseM === null
                ? 'Its lateral is outside the model here.'
                : `Lateral on average ${metres(leg.belowTopM)} under the top and ${metres(leg.aboveBaseM)} over the base${
                    leg.inside < leg.points
                      ? ` (${String(leg.points - leg.inside)} of ${String(leg.points)} points outside the zone)`
                      : ''
                  }.`}
            </li>
          ))}
        </ul>
      )}

      <h4 className="mt-3 text-xs font-medium">Tops picked</h4>
      {listed.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No tops picked in this well or within {km(geology.reach.picksKm)}.
        </p>
      ) : (
        <>
          {shownWell && (
            <p className="text-xs text-muted-foreground">
              None in this well; in the nearest picked well,{' '}
              <span className="font-mono">{shownWell.uwi}</span>, {km(shownWell.distanceKm)} away:
            </p>
          )}
          <PickList picks={first} />
          {listed.length > first.length && (
            <details className="mt-1 text-xs">
              <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">
                All {String(listed.length)} tops
              </summary>
              <PickList picks={listed} />
            </details>
          )}
        </>
      )}

      <h4 className="mt-3 text-xs font-medium">Maturity</h4>
      {geology.samples.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No Rock-Eval sample of {play ? `the ${play.name}` : 'this well'} within{' '}
          {km(geology.reach.samplesKm)}.
        </p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1 text-xs" aria-label="Rock-Eval samples">
          {geology.samples.map((s) => (
            <li
              key={`${String(s.sampleId)}-${String(s.run)}`}
              className="flex items-baseline gap-1.5"
            >
              <span
                aria-hidden="true"
                className="inline-block size-2 shrink-0 rounded-full"
                style={{
                  backgroundColor: s.window ? WINDOW_COLOURS[s.window] : 'transparent',
                  border: s.window ? undefined : '1px solid #9ca3af',
                }}
              />
              <span>
                <span className="font-medium">
                  {s.window ? MATURITY_WINDOW_LABELS[s.window] : 'No window'}
                </span>
                {' · '}
                {[
                  s.unit,
                  s.own ? 'in this well' : `${km(s.distanceKm)} away`,
                  s.tmaxC !== null ? `Tmax ${s.tmaxC} °C` : null,
                  s.ro !== null ? `Ro ${s.ro.toFixed(2)}% (calc.)` : null,
                  s.tocPct !== null ? `TOC ${s.tocPct}%` : null,
                  s.note === 'small-s2' ? 'S2 too small to read Tmax' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}

      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">
          More info
        </summary>
        <div className="mt-1 flex flex-col gap-1 text-[0.6875rem] leading-snug text-muted-foreground">
          <p>
            Depth, thickness and the lateral: the Survey&rsquo;s 3D model (Geological Framework of
            Alberta, Version 4) on cells of about 1 km, depth from the ground at the bottom hole;
            the lateral is the drilled path within 100 m of its deepest point. A model, not a log: a
            well&rsquo;s own picks are measured.
          </p>
          <p>
            Tops: the Survey&rsquo;s picks for its model
            {geology.source.picks.sourceDate ? ` (file of ${geology.source.picks.sourceDate})` : ''}
            , true vertical depth below the kelly bushing; marked AER where the pick is the
            AER&rsquo;s rather than the Survey&rsquo;s own. Kept for the wells loaded and the three
            picked wells nearest each.
          </p>
          <p>
            Maturity: Rock-Eval samples measured by laboratories (Digital Dataset 2013-0003). Ro is
            calculated from Tmax (Ro = 0.018 × Tmax − 7.16, the Survey&rsquo;s formula); the windows
            are those commonly used for shale plays: under {MATURITY_RO_EDGES.oil}% immature, to{' '}
            {MATURITY_RO_EDGES.condensate.toFixed(1)}% oil, to {MATURITY_RO_EDGES.dryGas}% wet gas
            and condensate, then dry gas. A Tmax from an S2 under {MATURITY_MIN_S2} mg/g is not
            read. The Survey publishes no maturity map.
          </p>
          <p>
            Source: Alberta Energy Regulator / Alberta Geological Survey, Open Government Licence –
            Alberta.
          </p>
        </div>
      </details>
    </div>
  );
}
