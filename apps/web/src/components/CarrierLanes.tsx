import {
  COUNTRY_NAMES,
  crossesBorder,
  groupLanes,
  LANE_REGIONS,
  laneCountry,
  laneRegionName,
  TRANSPORT_ACCESS,
  TRANSPORT_ACCESS_LABELS,
  type CarrierLane,
  type LaneChangeInput,
  type LaneGroup,
  type TransportAccess,
} from '@grain/domain';
import { ArrowRight, CircleDashed, MapPinned, Pencil, Plus, Route, Trash2 } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState, type SyntheticEvent } from 'react';

import { ApiError, sendJson, type CounterpartyDetail } from '../lib/api';
import { canEnterFreight } from '../lib/freight';
import { areaBounds, laneAreas, quotedOnly, type LaneRegionData } from '../lib/lanes';
import { mapboxToken, type MapboxToken } from '../lib/mapbox';
import { useTheme } from '../lib/theme';
import { MultiPicker } from './MultiPicker';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardHeader, CardTitle } from './ui/card';
import { Dialog, DialogClose, DialogContent } from './ui/dialog';
import { SearchSelect } from './ui/search-select';
import { SegmentedControl } from './ui/segmented-control';

// A carrier's lanes (owner's request and answers, 2026-11-01; docs/DECISIONS.md): from a
// province or state to one or more others, by truck, rail or both, so the team knows which
// carrier to call for which trade. Shown as a list and on a map with the places shaded; the
// places its freight rates run between are added, dashed, without being entered.

const FacilityMap = lazy(() => import('./FacilityMap'));

const PLACE_OPTIONS = LANE_REGIONS.map((code) => ({
  value: code,
  label: laneRegionName(code),
  detail: COUNTRY_NAMES[laneCountry(code)],
  keywords: code,
})).sort((a, b) => a.detail.localeCompare(b.detail) || a.label.localeCompare(b.label));

// Not stated first: truck or rail only when the person says so (owner's answer, 2026-11-01).
const TRANSPORT_OPTIONS: { value: TransportAccess | ''; label: string }[] = [
  { value: '', label: 'Not stated' },
  ...TRANSPORT_ACCESS.map((value) => ({ value, label: TRANSPORT_ACCESS_LABELS[value] })),
];

/** One origin's lanes as chosen in a form: from one place to several, by truck, rail or both. */
export interface LaneDraft {
  origin: string;
  destinations: string[];
  transport: TransportAccess | null;
}

export const EMPTY_LANE_DRAFT: LaneDraft = { origin: '', destinations: [], transport: null };

/** What is missing from a lane draft, or null when it is complete. */
export function laneDraftProblem(draft: LaneDraft): string | null {
  if (!draft.origin) return 'Choose where the lanes start.';
  if (draft.destinations.length === 0) return 'Choose at least one place they go to.';
  return null;
}

/** A complete draft's lanes, one per destination. */
export function draftLanes(draft: LaneDraft): CarrierLane[] {
  return draft.destinations.map((destination) => ({
    origin: draft.origin,
    destination,
    transport: draft.transport,
  }));
}

/** "by truck", or "truck or rail not stated", for buttons' names. */
function byWords(transport: TransportAccess | null): string {
  return transport === null
    ? 'truck or rail not stated'
    : `by ${TRANSPORT_ACCESS_LABELS[transport].toLowerCase()}`;
}

/** From, To and By for one origin's lanes; used on a carrier's page and in the add form. */
export function LaneFields({
  value,
  onChange,
  disabled,
}: {
  value: LaneDraft;
  onChange: (draft: LaneDraft) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">From</span>
        <SearchSelect
          aria-label="From"
          value={value.origin}
          onValueChange={(origin) => {
            onChange({ ...value, origin });
          }}
          options={PLACE_OPTIONS}
          placeholder="Province or state…"
          disabled={disabled}
          className="w-full"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">To</span>
        <MultiPicker
          label="To"
          icon={<MapPinned aria-hidden="true" className="size-4 text-muted-foreground" />}
          options={PLACE_OPTIONS}
          chosen={PLACE_OPTIONS.filter((option) => value.destinations.includes(option.value)).map(
            (option) => option.value,
          )}
          allLabel="Every province and state"
          onChange={(destinations) => {
            onChange({ ...value, destinations });
          }}
        />
        {value.destinations.length > 0 && (
          <p className="text-xs text-muted-foreground">{places(value.destinations)}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">By</span>
        <SegmentedControl
          label="By truck, rail or both"
          options={TRANSPORT_OPTIONS}
          value={value.transport ?? ''}
          onChange={(transport) => {
            onChange({ ...value, transport: transport === '' ? null : transport });
          }}
        />
      </div>
    </>
  );
}

/** "Montana, North Dakota". */
function places(codes: readonly string[]): string {
  return codes.map(laneRegionName).join(', ');
}

/** What to send to go from one group of lanes (or none) to the one chosen in the form. */
export function laneChange(before: LaneGroup | null, after: LaneDraft): LaneChangeInput {
  const kept = before?.origin === after.origin ? new Set(after.destinations) : new Set<string>();
  return {
    add: draftLanes(after),
    remove: (before?.destinations ?? [])
      .filter((destination) => !kept.has(destination))
      .map((destination) => ({ origin: before?.origin ?? '', destination })),
  };
}

/** Whether the carrier runs across the border, from its lanes or its freight rates. */
export function isCrossBorder(detail: Pick<CounterpartyDetail, 'lanes' | 'quotedLanes'>): boolean {
  return [...detail.lanes, ...detail.quotedLanes].some(crossesBorder);
}

/** Add or change one origin's lanes: from one place to several, by truck, rail or both. */
function LaneForm({
  label,
  initial,
  onSave,
  onCancel,
}: {
  label: string;
  initial: LaneGroup | null;
  onSave: (lanes: LaneDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<LaneDraft>(initial ?? EMPTY_LANE_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    const problem = laneDraftProblem(draft);
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      await onSave(draft);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <form
      aria-label={label}
      noValidate
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-3 border-b bg-muted/40 px-4 py-4"
    >
      <LaneFields value={draft} onChange={setDraft} disabled={busy} />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Saving…' : 'Save lanes'}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** The lanes on a map, when there is a Mapbox token; the list says it all without one. */
function LanesMap({
  lanes,
  quotedLanes,
  mapbox,
}: {
  lanes: readonly CarrierLane[];
  quotedLanes: readonly CarrierLane[];
  mapbox: MapboxToken;
}) {
  const [data, setData] = useState<LaneRegionData | null>(null);
  const [refused, setRefused] = useState(false);
  const [theme] = useTheme();
  const token = mapbox.status === 'ok' ? mapbox.token : null;
  const shown = token !== null && !refused && lanes.length + quotedLanes.length > 0;
  useEffect(() => {
    if (!shown || data) return;
    let current = true;
    // The outlines are fetched only when a lanes map is shown.
    void import('../data/lane-regions.json').then((module) => {
      if (current) setData(module.default as unknown as LaneRegionData);
    });
    return () => {
      current = false;
    };
  }, [shown, data]);
  const areas = useMemo(
    () => (data ? laneAreas(data, lanes, quotedLanes) : null),
    [data, lanes, quotedLanes],
  );
  const bounds = areas ? areaBounds(areas) : null;
  if (token === null || !shown) return null;

  return (
    <div className="border-b">
      <div role="region" aria-label="Map of its lanes" className="relative h-64 bg-muted">
        {areas && bounds ? (
          <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading map…</p>}>
            <FacilityMap
              key={bounds.join(',')}
              token={token}
              basemap="map"
              theme={theme}
              pins={[]}
              selectedId={null}
              start={bounds}
              cooperative
              simple
              areas={areas}
              onSelect={() => undefined}
              onTokenRefused={() => {
                setRefused(true);
              }}
            />
          </Suspense>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">Loading map…</p>
        )}
      </div>
      <ul
        aria-label="Map key"
        className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 text-xs text-muted-foreground"
      >
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-3 rounded-sm bg-info/60" />
          Loads in
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-3 rounded-sm bg-info/20 ring-1 ring-info/60" />
          Delivers to
        </li>
        {quotedOnly(lanes, quotedLanes).length > 0 && (
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-3 rounded-sm border border-dashed border-info"
            />
            From its freight rates
          </li>
        )}
      </ul>
    </div>
  );
}

type Editing = { kind: 'add' } | { kind: 'edit' | 'remove'; group: LaneGroup } | null;

const groupKey = (group: LaneGroup) => `${group.origin} ${group.transport ?? 'not_stated'}`;

/** The Lanes box on a carrier's page. */
export function CarrierLanes({
  token,
  role,
  detail,
  onSaved,
  mapbox = mapboxToken(),
}: {
  token: string;
  role: string;
  detail: CounterpartyDetail;
  onSaved: (message: string) => void;
  mapbox?: MapboxToken;
}) {
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<string | null>(null);
  const writer = canEnterFreight(role) && detail.archivedAt === null;
  const groups = groupLanes(detail.lanes);
  const quoted = quotedOnly(detail.lanes, detail.quotedLanes);
  const path = `/counterparties/${detail.id}/lanes`;

  // Lanes from a spreadsheet not yet verified, by their places (owner's request, 2026-11-01).
  const unverified = new Set(
    detail.lanes
      .filter((lane) => lane.verifiedAt === null)
      .map((lane) => `${lane.origin}>${lane.destination}`),
  );
  const [verifying, setVerifying] = useState<{ origin: string; destination: string } | null>(null);

  async function send(change: LaneChangeInput, message: string) {
    await sendJson(path, token, 'PATCH', change);
    setEditing(null);
    onSaved(message);
  }

  async function addQuoted(lane: CarrierLane) {
    setError(null);
    try {
      await send({ add: [lane], remove: [] }, 'Lane added.');
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.');
    }
  }

  return (
    <Card asChild className="overflow-hidden">
      <section aria-labelledby="lanes-heading">
        <CardHeader>
          <CardTitle id="lanes-heading">Lanes ({detail.lanes.length})</CardTitle>
          {writer && editing?.kind !== 'add' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setError(null);
                setEditing({ kind: 'add' });
              }}
            >
              <Plus aria-hidden="true" />
              Add lanes
            </Button>
          )}
        </CardHeader>
        <LanesMap lanes={detail.lanes} quotedLanes={detail.quotedLanes} mapbox={mapbox} />
        <VerifyLane
          lane={verifying}
          onClose={() => {
            setVerifying(null);
          }}
          onVerify={(lane) =>
            send(
              { add: [], remove: [], verify: [lane] },
              `${laneRegionName(lane.origin)} to ${laneRegionName(lane.destination)} verified.`,
            )
          }
        />
        {editing?.kind === 'add' && (
          <LaneForm
            label="New lanes"
            initial={null}
            onSave={(lanes) => send(laneChange(null, lanes), 'Lanes saved.')}
            onCancel={() => {
              setEditing(null);
            }}
          />
        )}
        {error && (
          <p role="alert" className="border-b px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}
        {groups.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">
            No lanes yet.
            {writer && ' Add where this carrier loads and where it delivers.'}
          </p>
        ) : (
          <ul aria-label="Lanes" className="divide-y text-sm">
            {groups.map((group) =>
              editing?.kind === 'edit' && groupKey(editing.group) === groupKey(group) ? (
                <li key={groupKey(group)}>
                  <LaneForm
                    label={`Edit lanes from ${laneRegionName(group.origin)}`}
                    initial={group}
                    onSave={(lanes) => send(laneChange(group, lanes), 'Lanes saved.')}
                    onCancel={() => {
                      setEditing(null);
                    }}
                  />
                </li>
              ) : (
                <li
                  key={groupKey(group)}
                  className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">From {laneRegionName(group.origin)}</span>
                      <ArrowRight aria-hidden="true" className="size-3.5 text-muted-foreground" />
                      <span className="sr-only">{' to '}</span>
                      {group.destinations.some((destination) =>
                        unverified.has(`${group.origin}>${destination}`),
                      ) ? (
                        <Destinations
                          origin={group.origin}
                          destinations={group.destinations}
                          unverified={unverified}
                          onVerify={
                            writer
                              ? (destination) => {
                                  setError(null);
                                  setVerifying({ origin: group.origin, destination });
                                }
                              : null
                          }
                        />
                      ) : (
                        <span>{places(group.destinations)}</span>
                      )}
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      {group.transport && (
                        <Badge variant="neutral">{TRANSPORT_ACCESS_LABELS[group.transport]}</Badge>
                      )}
                      {group.destinations.some((destination) =>
                        crossesBorder({ origin: group.origin, destination }),
                      ) && <Badge variant="info">Cross-border</Badge>}
                    </span>
                  </div>
                  {writer &&
                    (editing?.kind === 'remove' && groupKey(editing.group) === groupKey(group) ? (
                      <RemoveLanes
                        group={group}
                        onConfirm={() =>
                          send(
                            {
                              add: [],
                              remove: group.destinations.map((destination) => ({
                                origin: group.origin,
                                destination,
                              })),
                            },
                            'Lanes removed.',
                          )
                        }
                        onCancel={() => {
                          setEditing(null);
                        }}
                      />
                    ) : (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Edit lanes from ${laneRegionName(group.origin)}, ${byWords(group.transport)}`}
                          onClick={() => {
                            setError(null);
                            setEditing({ kind: 'edit', group });
                          }}
                        >
                          <Pencil aria-hidden="true" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Remove lanes from ${laneRegionName(group.origin)}, ${byWords(group.transport)}`}
                          onClick={() => {
                            setError(null);
                            setEditing({ kind: 'remove', group });
                          }}
                        >
                          <Trash2 aria-hidden="true" />
                          Remove
                        </Button>
                      </div>
                    ))}
                </li>
              ),
            )}
          </ul>
        )}
        {quoted.length > 0 && (
          <div className="border-t">
            <h3 className="flex items-center gap-1.5 px-4 pt-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              <Route aria-hidden="true" className="size-3.5" />
              From its freight rates
            </h3>
            <ul aria-label="Lanes from its freight rates" className="divide-y text-sm">
              {quoted.map((lane) => (
                <li
                  key={`${lane.origin}>${lane.destination}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
                >
                  <span className="flex flex-wrap items-center gap-1.5">
                    {laneRegionName(lane.origin)}
                    <ArrowRight aria-hidden="true" className="size-3.5 text-muted-foreground" />
                    <span className="sr-only">{' to '}</span>
                    {laneRegionName(lane.destination)}
                    <span className="text-muted-foreground">
                      {lane.transport && ` · ${TRANSPORT_ACCESS_LABELS[lane.transport]}`}
                    </span>
                  </span>
                  {writer && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Add ${laneRegionName(lane.origin)} to ${laneRegionName(lane.destination)} to its lanes`}
                      onClick={() => void addQuoted(lane)}
                    >
                      <Plus aria-hidden="true" />
                      Add to lanes
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </Card>
  );
}

function RemoveLanes({
  group,
  onConfirm,
  onCancel,
}: {
  group: LaneGroup;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div
      role="group"
      aria-label={`Remove lanes from ${laneRegionName(group.origin)}`}
      className="flex w-full flex-col gap-2 text-sm"
    >
      <p>
        Remove the lanes from <strong>{laneRegionName(group.origin)}</strong> to{' '}
        {places(group.destinations)}? The audit trail keeps who removed them and when.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="danger"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            onConfirm().catch((failure: unknown) => {
              setError(
                failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.',
              );
              setBusy(false);
            });
          }}
        >
          {busy ? 'Removing…' : 'Remove'}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>
          Keep them
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * A group's destinations when some are not yet verified: verified ones as text, unverified ones
 * grey and dashed, like commodities from a spreadsheet; a click asks to verify one.
 */
function Destinations({
  origin,
  destinations,
  unverified,
  onVerify,
}: {
  origin: string;
  destinations: readonly string[];
  unverified: ReadonlySet<string>;
  onVerify: ((destination: string) => void) | null;
}) {
  return (
    <ul aria-label={`Places from ${laneRegionName(origin)}`} className="flex flex-wrap gap-1.5">
      {destinations.map((destination) => {
        const name = laneRegionName(destination);
        if (!unverified.has(`${origin}>${destination}`)) {
          return (
            <li key={destination} className="px-1">
              {name}
            </li>
          );
        }
        const chip =
          'inline-flex items-center gap-1 rounded-badge border border-dashed px-2 py-0.5 text-xs text-muted-foreground';
        return (
          <li key={destination}>
            {onVerify ? (
              <button
                type="button"
                className={`${chip} hover:bg-accent`}
                aria-label={`${name}, not verified: verify ${laneRegionName(origin)} to ${name}`}
                onClick={() => {
                  onVerify(destination);
                }}
              >
                <CircleDashed aria-hidden="true" className="size-3" />
                {name}
              </button>
            ) : (
              <span className={chip}>
                <CircleDashed aria-hidden="true" className="size-3" />
                {name}
                <span className="sr-only"> (not verified)</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** "Verify Alberta to Montana?", from an unverified lane: one from a spreadsheet. */
function VerifyLane({
  lane,
  onClose,
  onVerify,
}: {
  lane: { origin: string; destination: string } | null;
  onClose: () => void;
  onVerify: (lane: { origin: string; destination: string }) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify(chosen: { origin: string; destination: string }) {
    setBusy(true);
    setError(null);
    try {
      await onVerify(chosen);
      onClose();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const route = lane && `${laneRegionName(lane.origin)} to ${laneRegionName(lane.destination)}`;
  return (
    <Dialog
      open={lane !== null}
      onOpenChange={(open) => {
        if (!open) {
          setError(null);
          onClose();
        }
      }}
    >
      {lane && route && (
        <DialogContent
          title={`Verify ${route}?`}
          description={`This lane came from a spreadsheet and has not been checked yet. Verify it once the carrier has confirmed it runs from ${route}.`}
          className="max-w-sm"
        >
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void verify(lane)}>
              {busy ? 'Verifying…' : 'Verify'}
            </Button>
            <DialogClose asChild>
              <Button variant="outline" disabled={busy}>
                Not now
              </Button>
            </DialogClose>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
