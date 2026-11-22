import { ST37_STATUS_LABELS } from '@grain/domain';
import { useState } from 'react';

import type { MapBounds } from '../lib/mapbox';
import { ST37_COLOURS, type St37MapWell } from '../lib/st37Map';
import type { St37Hover } from './FacilityMap';
import { MapPanel, MapTip, PanelBadge, PanelSection, PanelTiles } from './MapPanel';
import { WellProduction } from './Production';
import { st37Place, st37Plan } from './St37Wells';
import { Button } from './ui/button';
import { Well3d } from './Well3d';

/**
 * A well on the oil and gas map, shown two ways (F-265; the owner, 2026-11-22): a box at the
 * pointer with the simple lines of the well or leg under it, and, on a click, a panel that
 * slides in from the right with the well whole. Data from the AER and Petrinex, named in the
 * Wells panel's About this data.
 */

const metres = (n: number) => `${n.toLocaleString('en-CA', { maximumFractionDigits: 0 })} m`;

/** A well's or a leg's status as one line: "Producing or injecting · Gas". */
function statusLine(well: St37MapWell): string {
  return [ST37_STATUS_LABELS[well.statusClass], well.statusFluid, well.statusType]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}

/** "Spud 2014-07-03 · TD 5,001 m (TVD 2,974 m)"; empty for a well with neither. */
function depthLine(well: St37MapWell): string {
  return [
    well.spudDate && `Spud ${well.spudDate}`,
    well.totalDepthM !== null &&
      `TD ${metres(well.totalDepthM)}${
        well.trueVerticalDepthM !== null ? ` (TVD ${metres(well.trueVerticalDepthM)})` : ''
      }`,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}

/** The other wells among those pointed at or clicked: other licences, not this well's legs. */
function otherWells(
  uwis: readonly string[],
  byUwi: ReadonlyMap<string, St37MapWell>,
  licence: string,
): number {
  return new Set(
    uwis
      .map((uwi) => byUwi.get(uwi)?.licenceNumber)
      .filter((of) => of !== undefined && of !== licence),
  ).size;
}

/**
 * The box at the pointer for a well or one of its legs (the simple lines only): the leg
 * pointed at, its licence and licensee, its status, its field and pool, its spud date and
 * depths. Everything else is on the panel a click opens.
 */
export function St37Tip({
  hover,
  byUwi,
  legsOf,
}: {
  hover: St37Hover | null;
  byUwi: ReadonlyMap<string, St37MapWell>;
  /** Each well's legs by licence number, the main leg first; without it, the leg alone. */
  legsOf?: ReadonlyMap<string, St37MapWell[]>;
}) {
  const [first] = hover?.uwis ?? [];
  const leg = first === undefined ? undefined : byUwi.get(first);
  if (!hover || !leg) return null;
  const legs = legsOf?.get(leg.licenceNumber) ?? [leg];
  const others = otherWells(hover.uwis, byUwi, leg.licenceNumber);
  const depth = depthLine(leg);
  const place = st37Place(leg);
  const plan =
    leg.statusClass === 'licensed' || leg.statusClass === 'drilling' ? st37Plan(leg) : null;
  const more = [
    legs.length > 1 && `One of ${String(legs.length)} legs of this well`,
    others > 0 && `+${String(others)} more ${others === 1 ? 'well' : 'wells'} here`,
  ].filter(Boolean);
  return (
    <MapTip>
      <p className="font-mono font-semibold">{leg.uwi}</p>
      <p className="font-mono text-xs text-muted-foreground">
        Licence {leg.licenceNumber}
        {leg.licensee ? ` · ${leg.licensee}` : ''}
      </p>
      <p className="mt-1">{statusLine(leg)}</p>
      {place && <p className="text-muted-foreground">{place}</p>}
      {depth && <p className="text-muted-foreground">{depth}</p>}
      {plan && <p className="text-muted-foreground">{plan}</p>}
      {more.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{more.join(' · ')}</p>}
    </MapTip>
  );
}

/** The box around every leg of a well, with some ground about it, for the map to move to. */
export function st37Bounds(legs: readonly St37MapWell[]): MapBounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const leg of legs) {
    const points = [leg.surface, leg.bottom, leg.plannedBottom, ...(leg.path ?? [])];
    for (const point of points) {
      if (!point) continue;
      west = Math.min(west, point[0]);
      east = Math.max(east, point[0]);
      south = Math.min(south, point[1]);
      north = Math.max(north, point[1]);
    }
  }
  if (!Number.isFinite(west) || !Number.isFinite(south)) return null;
  // A vertical well is one point: about half a kilometre each way at least.
  const pad = Math.max(0.005, (east - west) * 0.2, (north - south) * 0.2);
  return [west - pad, south - pad, east + pad, north + pad];
}

/**
 * The panel of the well clicked, on the right of the map: the well whole (its main leg in
 * full, then every leg under its licence, F-257), its production as its legs' total and, under
 * it, that of the leg chosen (F-258), and how many more wells share the place.
 */
export function St37Panel({
  pick,
  byUwi,
  legsOf,
  member,
  onClose,
  goTo,
}: {
  /** The wells clicked; the first is the one shown. */
  pick: St37Hover | null;
  onClose: () => void;
  byUwi: ReadonlyMap<string, St37MapWell>;
  /** Each well's legs by licence number, the main leg first; without it, the leg alone. */
  legsOf?: ReadonlyMap<string, St37MapWell[]>;
  /** Whose sign-in reads the well's monthly production (F-252 step 3); none shows no chart. */
  member?: { organizationId: string; token: string };
  /** Moves the map to the well; without it there is no Zoom to well. */
  goTo?: (bounds: MapBounds) => void;
}) {
  // The leg whose own production is shown under the well's total: not chosen yet (the leg
  // clicked on the map, unless it is the main one), none, or the leg clicked on the panel. The
  // map page gives each click a panel of its own (a key), so a new click starts afresh.
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  if (!pick) return null;
  const [first] = pick.uwis;
  const pointed = first === undefined ? undefined : byUwi.get(first);
  if (!pointed) return null;
  const legs = legsOf?.get(pointed.licenceNumber) ?? [pointed];
  const well = legs[0] ?? pointed;
  const others = otherWells(pick.uwis, byUwi, well.licenceNumber);
  const alone =
    chosen === undefined
      ? pointed.uwi === well.uwi
        ? undefined
        : pointed
      : legs.find((leg) => leg.uwi === chosen);
  const place = st37Place(well);
  const plan =
    well.statusClass === 'licensed' || well.statusClass === 'drilling' ? st37Plan(well) : null;
  const bounds = goTo ? st37Bounds(legs) : null;
  return (
    <MapPanel
      label={`Well ${well.uwi}`}
      eyebrow={`Well${well.wellName ? ` · ${well.wellName}` : ''}`}
      title={well.uwi}
      onClose={onClose}
    >
      <PanelBadge colour={ST37_COLOURS.light[well.statusClass]}>{statusLine(well)}</PanelBadge>
      <PanelTiles
        tiles={[
          { label: 'Spud', value: well.spudDate ?? '—' },
          {
            label: 'Total depth',
            value: well.totalDepthM !== null ? metres(well.totalDepthM) : '—',
          },
          {
            label: 'Vertical depth',
            value: well.trueVerticalDepthM !== null ? metres(well.trueVerticalDepthM) : '—',
          },
        ]}
      />
      {bounds && goTo && (
        <div className="mt-3">
          <Button
            size="sm"
            onClick={() => {
              goTo(bounds);
            }}
          >
            Zoom to well
          </Button>
        </div>
      )}
      {member && well.statusClass !== 'licensed' && (
        <PanelSection title="Under the ground, in 3D">
          <Well3d
            uwi={well.uwi}
            chosen={alone?.uwi ?? null}
            organizationId={member.organizationId}
            token={member.token}
          />
        </PanelSection>
      )}
      <PanelSection title="Licence">
        <p>{well.licensee ?? 'No licensee named'}</p>
        <p className="font-mono text-xs text-muted-foreground">
          Licence {well.licenceNumber}
          {well.licenceDate ? ` · licensed ${well.licenceDate}` : ''}
        </p>
      </PanelSection>
      {place && (
        <PanelSection title="Field and pool">
          <p>{place}</p>
        </PanelSection>
      )}
      {(plan !== null || well.plannedBottom !== null) && (
        <PanelSection title="Plan">
          {plan && <p>{plan}</p>}
          {well.plannedBottom && (
            <p className="mt-1 text-xs text-muted-foreground">
              The dashed line is the plan: straight from the surface location to the planned bottom
              hole. The drilled path comes once the well is drilled.
            </p>
          )}
        </PanelSection>
      )}
      {legs.length > 1 && (
        <PanelSection title="Legs" count={legs.length}>
          <ul className="flex flex-col gap-0.5 text-xs" aria-label="Legs of this well">
            {legs.map((leg, i) => (
              <li key={leg.uwi}>
                <button
                  type="button"
                  aria-pressed={leg.uwi === alone?.uwi}
                  onClick={() => {
                    setChosen(leg.uwi === alone?.uwi ? null : leg.uwi);
                  }}
                  className="flex w-full items-baseline gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-muted aria-pressed:bg-muted"
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
        </PanelSection>
      )}
      {member && well.statusClass !== 'licensed' && (
        <PanelSection title="Production">
          {legs.length > 1 && (
            <p className="text-xs text-muted-foreground">
              Production of all legs together. Click a leg, on the map or above, for its own below.
            </p>
          )}
          <WellProduction
            uwis={legs.map((leg) => leg.uwi)}
            organizationId={member.organizationId}
            token={member.token}
            interactive
          />
          {alone && (
            <div aria-label={`Production of leg ${alone.uwi}`} role="group">
              <p className="mt-2 text-xs text-muted-foreground">
                Leg <span className="font-mono text-foreground">{alone.uwi}</span> alone
                {alone.uwi === well.uwi ? ' (the main leg)' : ''}.
              </p>
              <WellProduction
                uwis={[alone.uwi]}
                organizationId={member.organizationId}
                token={member.token}
                interactive
              />
            </div>
          )}
        </PanelSection>
      )}
      {others > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          +{others} more {others === 1 ? 'well' : 'wells'} here
        </p>
      )}
    </MapPanel>
  );
}
