import { albertaDay } from '@grain/domain';

import type { MapBounds } from '../lib/mapbox';
import { RIG_COLOUR } from '../lib/rigsMap';
import { MapPanel, MapTip, PanelBadge, PanelSection, PanelTiles, TipHead } from './MapPanel';
import { daysAgo, rigStarted, targetName, type RigMove } from './Rigs';
import { Button } from './ui/button';

// A rig on the oil and gas map (F-282): the box at the pointer, and the panel on the right when it
// is clicked, as for facilities and wells (F-265).

/** "Ensign Drilling Inc. rig 419", or the contractor alone for a rig with no number. */
export function rigName(m: RigMove): string {
  return m.rigNumber.trim() === '' ? m.contractorName : `${m.contractorName} rig ${m.rigNumber}`;
}

function since(m: RigMove, now: Date): string {
  const days = daysAgo(m.activityAt, now);
  return days === 0 ? 'today' : days === 1 ? '1 day ago' : `${String(days)} days ago`;
}

export function RigTip({ move, now = new Date() }: { move: RigMove | null; now?: Date }) {
  if (!move) return null;
  return (
    <MapTip>
      <TipHead title={rigName(move)} aside={move.now ? 'now' : since(move, now)} />
      <p className="mt-0.5 truncate font-medium">{move.wellName}</p>
      <p className="truncate text-xs">
        Drilling for {targetName(move.targetZone) ?? 'a zone not known yet'}
      </p>
      <p className="truncate text-xs text-muted-foreground">
        {move.activityType} · {since(move, now)}
      </p>
      <p className="mt-0.5 truncate text-xs">{move.licenseeName}</p>
    </MapTip>
  );
}

export function RigPanel({
  move,
  movesOf,
  goTo,
  onClose,
  now = new Date(),
}: {
  move: RigMove | null;
  movesOf: (rig: string) => RigMove[];
  goTo: (bounds: MapBounds) => void;
  onClose: () => void;
  now?: Date;
}) {
  if (!move) return null;
  const m = move;
  const zoom = (at: RigMove) => {
    if (at.longitude === null || at.latitude === null) return;
    const d = 0.02;
    goTo([at.longitude - d, at.latitude - d, at.longitude + d, at.latitude + d]);
  };
  const others = movesOf(m.rig);
  return (
    <MapPanel
      label={`Rig ${rigName(m)}`}
      eyebrow={`Rig · ${m.contractorName}`}
      title={m.rigNumber.trim() === '' ? 'No number' : `Rig ${m.rigNumber}`}
      onClose={onClose}
    >
      <PanelBadge colour={m.now ? RIG_COLOUR : '#78716c'}>
        {m.now ? 'On this well now' : `${m.activityType}, ${since(m, now)}`}
      </PanelBadge>
      <PanelTiles
        tiles={[
          { label: 'Activity', value: m.activityType },
          { label: 'Started', value: since(m, now), title: rigStarted(m) },
          { label: 'Licence', value: m.licenceNumber },
        ]}
      />
      {m.longitude !== null && (
        <div className="mt-3">
          <Button
            size="sm"
            onClick={() => {
              zoom(m);
            }}
          >
            Zoom to rig
          </Button>
        </div>
      )}
      <PanelSection title="Drilling for">
        <p className="font-medium">{targetName(m.targetZone) ?? 'Not known yet'}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {m.targetZone
            ? `The zone its well licence targets (the AER’s terminating zone, “${m.targetZone}”).`
            : 'The zone its well licence targets is looked up in the AER’s licence lists twice a day.'}
        </p>
      </PanelSection>
      <PanelSection title="Well">
        <p className="font-medium">{m.wellName}</p>
        <p className="mt-0.5 font-mono text-xs text-muted-foreground">{m.wellId}</p>
        <p className="mt-1 text-xs text-muted-foreground">Started {rigStarted(m)} (Alberta time)</p>
      </PanelSection>
      <PanelSection title="Operator">
        <p>
          {m.licenseeName}
          <span className="ml-1.5 font-mono text-xs text-muted-foreground">{m.licenseeBaId}</span>
        </p>
      </PanelSection>
      <PanelSection title="Drilling contractor">
        <p>
          {m.contractorName}
          <span className="ml-1.5 font-mono text-xs text-muted-foreground">{m.contractorBaId}</span>
        </p>
      </PanelSection>
      <PanelSection title="Where">
        <p className="font-mono text-xs">{m.surfaceLocation ?? 'Not placed yet'}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {m.place === 'well'
            ? 'The well’s surface location, from the AER’s list of every licence.'
            : m.place === 'lsd'
              ? 'The centre of its surface legal subdivision (about 400 m across).'
              : 'Its licence’s place is looked up twice a day.'}
        </p>
      </PanelSection>
      {others.length > 1 && (
        <PanelSection title="This rig in the last 90 days" count={others.length}>
          <ul className="flex flex-col gap-1">
            {others.map((o) => (
              <li key={o.key}>
                <button
                  type="button"
                  disabled={o.longitude === null}
                  onClick={() => {
                    zoom(o);
                  }}
                  className="flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left text-[0.8125rem] hover:bg-muted disabled:hover:bg-transparent"
                >
                  <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">
                    {albertaDay(o.activityAt)}
                  </span>
                  <span className={o.key === m.key ? 'grow font-semibold' : 'grow'}>
                    {o.wellName}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </PanelSection>
      )}
      <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
        The AER’s ST49 daily drilling activity list, list of {m.listDate}; preliminary.
      </p>
    </MapPanel>
  );
}
