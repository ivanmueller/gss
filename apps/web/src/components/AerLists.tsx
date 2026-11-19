import { utcToAlberta } from '@grain/domain';
import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { apiJson } from '../lib/api';
import type { MapOverlay, PickedFeature } from '../lib/mapLayers';
import { SegmentedControl } from './ui/segmented-control';

/**
 * The Alberta Energy Regulator's new well licences (ST1) and rig activity (ST49) on the oil and
 * gas map (F-243 part 2). The AER's data is used on the owner's decision (docs/DECISIONS.md,
 * 2026-11-19): its name, each list's date and "preliminary" are always shown, and nothing here
 * offers a download.
 */

export const AER_LICENCES = 'aer-licences';
export const AER_RIGS = 'aer-rigs';

const LICENCE_COLOUR = '#1a73e8';
const RIG_COLOUR = '#e8590c';

interface Source {
  name: string;
  preliminary: true;
  latestListDate: string | null;
  lastSeenAt: string | null;
}

interface Answer {
  source: Source;
  located: GeoJSON.FeatureCollection;
  unlocated: number | unknown[];
  truncated: boolean;
}

type State =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ok'; answer: Answer };

const LICENCE_DAYS = ['7', '30', '90'] as const;
const RIG_DAYS = ['7', '30'] as const;

function useList(
  on: boolean,
  path: string,
  organizationId: string,
  token: string,
  days: string,
): State {
  const [state, setState] = useState<{ key: string; value: State } | null>(null);
  const key = `${path}/${days}/${organizationId}`;
  useEffect(() => {
    if (!on) return;
    const controller = new AbortController();
    apiJson<Answer>(
      `${path}?days=${days}&organization_id=${encodeURIComponent(organizationId)}`,
      token,
      { signal: controller.signal },
    )
      .then((answer) => {
        setState({ key, value: { status: 'ok', answer } });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ key, value: { status: 'failed' } });
      });
    return () => {
      controller.abort();
    };
  }, [on, path, days, organizationId, token, key]);
  if (!on) return { status: 'off' };
  return state?.key === key ? state.value : { status: 'loading' };
}

function count(value: number | unknown[]): number {
  return Array.isArray(value) ? value.length : value;
}

export interface AerListsState {
  overlays: MapOverlay[];
  /** A dot of these lists that was clicked, or null. */
  picked: PickedFeature | null;
  setPicked: (picked: PickedFeature | null) => void;
  panel: React.ReactNode;
}

/** The switches, the periods, the dots they draw and the card of a clicked dot. */
export function useAerLists(organizationId: string, token: string): AerListsState {
  const [licencesOn, setLicencesOn] = useState(false);
  const [rigsOn, setRigsOn] = useState(false);
  const [licenceDays, setLicenceDays] = useState<(typeof LICENCE_DAYS)[number]>('30');
  const [rigDays, setRigDays] = useState<(typeof RIG_DAYS)[number]>('7');
  const [picked, setPicked] = useState<PickedFeature | null>(null);
  const licences = useList(
    licencesOn,
    '/petroleum/aer/licences',
    organizationId,
    token,
    licenceDays,
  );
  const rigs = useList(rigsOn, '/petroleum/aer/rigs', organizationId, token, rigDays);

  const overlays = useMemo<MapOverlay[]>(() => {
    const out: MapOverlay[] = [];
    if (licences.status === 'ok') {
      out.push({
        id: AER_LICENCES,
        kind: 'features',
        data: licences.answer.located,
        colour: LICENCE_COLOUR,
      });
    }
    if (rigs.status === 'ok') {
      out.push({ id: AER_RIGS, kind: 'features', data: rigs.answer.located, colour: RIG_COLOUR });
    }
    return out;
  }, [licences, rigs]);

  const line = (
    label: string,
    colour: string,
    on: boolean,
    set: (v: boolean) => void,
    s: State,
  ) => (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={on}
          onChange={(event) => {
            set(event.target.checked);
            if (!event.target.checked) setPicked(null);
          }}
        />
        <span
          aria-hidden="true"
          className="inline-block size-3 rounded-full border border-white"
          style={{ background: colour }}
        />
        {label}
      </label>
      {s.status === 'loading' && <p className="text-xs text-muted-foreground">Loading…</p>}
      {s.status === 'failed' && (
        <p className="text-xs text-destructive">Could not be loaded. Try again in a moment.</p>
      )}
      {s.status === 'ok' && (
        <p className="text-xs text-muted-foreground">
          {String(s.answer.located.features.length)} on the map
          {count(s.answer.unlocated) > 0 && `, ${String(count(s.answer.unlocated))} not placed yet`}
          {s.answer.truncated && ', the newest 5,000 shown'}
        </p>
      )}
    </div>
  );

  const sources = [licences, rigs].flatMap((s) => (s.status === 'ok' ? [s.answer.source] : []));

  const panel = (
    <div
      className="flex w-64 flex-col gap-3 rounded-card border bg-card/95 p-3 shadow-xs"
      aria-label="Alberta Energy Regulator lists"
      role="group"
    >
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        New wells and rigs
      </p>
      {line('New licences', LICENCE_COLOUR, licencesOn, setLicencesOn, licences)}
      {licencesOn && (
        <SegmentedControl
          label="Licences issued in the last"
          options={LICENCE_DAYS.map((d) => ({ value: d, label: `${d} days` }))}
          value={licenceDays}
          onChange={setLicenceDays}
        />
      )}
      {line('Rigs', RIG_COLOUR, rigsOn, setRigsOn, rigs)}
      {rigsOn && (
        <SegmentedControl
          label="Rig activity in the last"
          options={RIG_DAYS.map((d) => ({ value: d, label: `${d} days` }))}
          value={rigDays}
          onChange={setRigDays}
        />
      )}
      {sources.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Source: Alberta Energy Regulator (ST1 and ST49 daily lists), preliminary.{' '}
          {sources
            .map((s) => s.latestListDate)
            .filter((d): d is string => d !== null)
            .map((d) => `List of ${d}`)
            .join(', ')}
          . Not an official record.
        </p>
      )}
    </div>
  );

  return { overlays, picked, setPicked, panel };
}

const LABELS: [string, string][] = [
  ['licenceNumber', 'Licence'],
  ['wellName', 'Well'],
  ['licensee', 'Licensee'],
  ['drillingOperation', 'Drilling'],
  ['substance', 'Substance'],
  ['terminatingZone', 'Target zone'],
  ['projectedDepth', 'Projected depth'],
  ['surfaceLocation', 'Surface location'],
  ['listDate', 'List date'],
  ['wellId', 'Well ID'],
  ['contractorName', 'Contractor'],
  ['rigNumber', 'Rig'],
  ['activityType', 'Activity'],
  ['activityAt', 'When (Alberta time)'],
];

/** The card of a clicked dot: the AER's fields, with its source and "preliminary". */
export function AerPickedCard({ state }: { state: AerListsState }) {
  const { picked, setPicked } = state;
  if (!picked) return null;
  const rig = picked.layerId === AER_RIGS;
  const rows = LABELS.flatMap(([key, label]) => {
    const value = picked.properties[key];
    if (typeof value !== 'string' || value === '') return [];
    return [[label, key === 'activityAt' ? utcToAlberta(value) : value] as const];
  });
  return (
    <div className="absolute right-3 bottom-8 z-20 w-72 max-w-[calc(100%-1.5rem)] rounded-card border bg-card p-3 text-sm shadow-md">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="font-semibold">{rig ? 'Rig activity' : 'New well licence'}</p>
        <button
          type="button"
          aria-label="Close"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => {
            setPicked(null);
          }}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
        Alberta Energy Regulator, preliminary
        {rig
          ? '. Placed at the licence’s surface location, to its quarter-section.'
          : '. Placed at the middle of its surface quarter-section.'}
      </p>
    </div>
  );
}
