import {
  FACILITY_GROUPS,
  operatorKey,
  operatorMatches,
  type Bbox,
  type FacilityGroup,
  type MapSettings,
} from '@grain/domain';
import { countOperators, type OperatorCount } from '../lib/operatorColours';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, apiJson } from '../lib/api';
import { FACILITIES_FROM, FACILITY_COLOURS, type FacilitiesView } from '../lib/facilitiesMap';
import { landDay } from './LandPanel';
import { FilterChip, LegendTitle, MapSection, SIDE_INPUT, SIDE_LABEL } from './MapSide';

// Facilities on the oil and gas map (F-278; the owner, 2026-11-22): the AER's ST102 list for the
// area loaded, asked for once and kept, filtered in the page by kind, status and operator. The
// box at the pointer and the panel on the right are in FacilityPanel.tsx.

/** The answer of GET /api/v1/petroleum/facilities (apps/api/src/petro-facilities.ts). */
interface Answer {
  load: {
    loadedAt: string;
    fileDate: string | null;
    area: Bbox;
    facilities: number;
  } | null;
  subtypes: { code: number | null; name: string | null; group: FacilityGroup }[];
  statuses: (string | null)[];
  companies: { code: string | null; name: string | null }[];
  located: string[];
  facilities: [
    string,
    string | null,
    number,
    number,
    number,
    number,
    number,
    number,
    string | null,
    number,
  ][];
}

export interface FacilityCompany {
  code: string | null;
  name: string | null;
}

/** One facility, as the box at the pointer and the panel show it. */
export interface FacilityEntry {
  id: string;
  key: string;
  name: string | null;
  longitude: number;
  latitude: number;
  subCode: number | null;
  subType: string | null;
  group: FacilityGroup;
  status: string | null;
  operator: FacilityCompany | null;
  licensee: FacilityCompany | null;
  licence: string | null;
  located: string | null;
}

/** The statuses the AER gives a facility that is working; every other one is drawn faint. */
const LIVE = new Set(['Active', 'New']);
export const facilityLive = (status: string | null) => status !== null && LIVE.has(status);

export const facilityKey = (id: string) => `facility:${id}`;

/** The facilities of an answer, each with its subtype, status and companies looked up. */
export function facilityEntries(answer: Answer): FacilityEntry[] {
  return answer.facilities.map(
    ([id, name, longitude, latitude, sub, status, operator, licensee, licence, located]) => {
      const subtype = answer.subtypes[sub];
      return {
        id,
        key: facilityKey(id),
        name,
        longitude,
        latitude,
        subCode: subtype?.code ?? null,
        subType: subtype?.name ?? null,
        group: subtype?.group ?? 'other',
        status: answer.statuses[status] ?? null,
        operator: answer.companies[operator] ?? null,
        licensee: answer.companies[licensee] ?? null,
        licence,
        located: answer.located[located] ?? null,
      };
    },
  );
}

/** The facilities shown: of the kinds and statuses on, and of an operator whose name holds the text. */
export function facilitiesShown(
  entries: readonly FacilityEntry[],
  groups: ReadonlySet<FacilityGroup>,
  statuses: ReadonlySet<string>,
  operator: string,
): FacilityEntry[] {
  // Names compared whatever their case or punctuation (F-302).
  return entries.filter(
    (f) =>
      groups.has(f.group) &&
      statuses.has(f.status ?? '') &&
      operatorMatches(f.operator?.name, operator),
  );
}

const inside = (f: FacilityEntry, b: Bbox) =>
  f.longitude >= b.west && f.longitude <= b.east && f.latitude >= b.south && f.latitude <= b.north;

export interface Facilities {
  /** What the map draws; null while off or not loaded. */
  view: FacilitiesView | null;
  /** The operators of what is drawn in view, counted (F-302 part 2); null while off. */
  operatorsInView: readonly OperatorCount[] | null;
  byKey: ReadonlyMap<string, FacilityEntry>;
  setPicked: (keys: readonly string[]) => void;
  onViewChange: (bbox: Bbox | null, zoom: number) => void;
  /** When the facilities were loaded; null before. */
  updated: string | null;
  fileDate: string | null;
  /** Every setting of the section as it is now, and a way to set some of them (F-254). */
  settings: FacilitiesSnapshot;
  apply: (settings: FacilitiesSnapshot) => void;
  section: (props: { open: boolean; onToggle: () => void }) => React.ReactNode;
  legend: () => React.ReactNode;
  about: () => React.ReactNode;
}

/** The section's settings, with the exact statuses on, so Undo brings them back. */
export type FacilitiesSnapshot = NonNullable<MapSettings['facilities']> & {
  statuses?: readonly string[];
};

const ALL_GROUPS: ReadonlySet<FacilityGroup> = new Set(FACILITY_GROUPS.map((g) => g.key));
/** When the section is first switched on (F-284): active facilities only, and no kind yet. */
export const FACILITY_STATUSES_AT_START: ReadonlySet<string> = new Set(['Active']);
export const FACILITY_GROUPS_AT_START: ReadonlySet<FacilityGroup> = new Set();

export function useFacilities(organizationId: string, token: string): Facilities {
  // Off when the map opens (F-284).
  const [on, setOn] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [groups, setGroups] = useState<ReadonlySet<FacilityGroup>>(FACILITY_GROUPS_AT_START);
  const [statusesOn, setStatusesOn] = useState<ReadonlySet<string>>(FACILITY_STATUSES_AT_START);
  const [operator, setOperator] = useState('');
  const [picked, setPickedKeys] = useState<readonly string[]>([]);
  const [at, setAt] = useState<{ view: Bbox; zoom: number } | null>(null);

  // Asked for once while on: the browser keeps the answer and is told "unchanged" after.
  const wanted = on && answer === null;
  useEffect(() => {
    if (!wanted) return;
    const controller = new AbortController();
    apiJson<Answer>(
      `/petroleum/facilities?organization_id=${encodeURIComponent(organizationId)}`,
      token,
      { signal: controller.signal },
    )
      .then((got) => {
        setAnswer(got);
        setProblem(null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setProblem(
          error instanceof ApiError && error.code === 'PETROLEUM_NOT_READY'
            ? 'The oil and gas database is being updated. Try again in a few minutes.'
            : 'The facilities could not be loaded. Try again later.',
        );
      });
    return () => {
      controller.abort();
    };
  }, [wanted, organizationId, token]);

  const entries = useMemo(() => (answer ? facilityEntries(answer) : []), [answer]);
  const byKey = useMemo(() => new Map(entries.map((f) => [f.key, f])), [entries]);
  const shown = useMemo(
    () => facilitiesShown(entries, groups, statusesOn, operator),
    [entries, groups, statusesOn, operator],
  );
  const points = useMemo(
    (): GeoJSON.FeatureCollection => ({
      type: 'FeatureCollection',
      features: shown.map((f) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [f.longitude, f.latitude] },
        properties: {
          key: f.key,
          colour: FACILITY_COLOURS[f.group],
          op: operatorKey(f.operator?.name),
          faint: !facilityLive(f.status),
        },
      })),
    }),
    [shown],
  );
  const view = useMemo(
    (): FacilitiesView | null => (on && answer ? { points, picked } : null),
    [on, answer, points, picked],
  );

  // The statuses in the list, the most first, for the chips.
  const statuses = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of entries) counts.set(f.status ?? '', (counts.get(f.status ?? '') ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([status]) => status);
  }, [entries]);

  const settings: FacilitiesSnapshot = {
    on,
    kinds: FACILITY_GROUPS.map((g) => g.key).filter((key) => groups.has(key)),
    activeOnly: statusesOn.size === 1 && statusesOn.has('Active'),
    statuses: [...statusesOn],
    operator,
  };
  const apply = (next: FacilitiesSnapshot) => {
    if (next.on !== undefined) setOn(next.on);
    if (next.kinds) setGroups(new Set(next.kinds));
    if (next.statuses) setStatusesOn(new Set(next.statuses));
    else if (next.activeOnly === true) setStatusesOn(FACILITY_STATUSES_AT_START);
    // Every status the list holds; before the list has come, the statuses stay as they are.
    else if (next.activeOnly === false && statuses.length > 0) setStatusesOn(new Set(statuses));
    if (next.operator !== undefined) setOperator(next.operator);
  };

  // Counted in the view only close enough in for the facilities to be drawn.
  const close = at !== null && at.zoom >= FACILITIES_FROM;
  const countInView = useCallback(
    (list: readonly FacilityEntry[]) => {
      const counts = new Map<FacilityGroup, number>();
      if (!at || !close) return null;
      for (const f of list) {
        if (inside(f, at.view)) counts.set(f.group, (counts.get(f.group) ?? 0) + 1);
      }
      return counts;
    },
    [at, close],
  );
  const inView = useMemo(() => countInView(shown), [countInView, shown]);
  // Drawn close in only: no operator counted further out (F-302 part 2).
  const operatorsInView = useMemo(
    () =>
      on && at && close
        ? countOperators(shown.filter((f) => inside(f, at.view)).map((f) => f.operator?.name))
        : null,
    [on, at, close, shown],
  );
  // Each kind in view, chosen or not, so a chip shows what it would add.
  const kindsInView = useMemo(
    () => countInView(facilitiesShown(entries, ALL_GROUPS, statusesOn, operator)),
    [countInView, entries, statusesOn, operator],
  );

  const onViewChange = useCallback((bbox: Bbox | null, zoom: number) => {
    setAt(bbox ? { view: bbox, zoom } : null);
  }, []);
  const setPicked = useCallback((keys: readonly string[]) => {
    setPickedKeys(keys.filter((k) => k.startsWith('facility:')));
  }, []);

  const toggleGroup = (group: FacilityGroup) => {
    setGroups((before) => {
      const next = new Set(before);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };
  const toggleStatus = (status: string) => {
    setStatusesOn((before) => {
      const next = new Set(before);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };
  const total = (counts: ReadonlyMap<FacilityGroup, number> | null) =>
    counts ? [...counts.values()].reduce((sum, n) => sum + n, 0) : 0;

  const section = ({ open, onToggle }: { open: boolean; onToggle: () => void }) => (
    <MapSection
      title="Facilities"
      open={open}
      onToggle={onToggle}
      on={on}
      onSwitch={setOn}
      sample={
        <span aria-hidden="true" className="flex gap-0.5">
          {(['oil_battery', 'gas_battery', 'gas_plant', 'compressor'] as const).map((g) => (
            <span key={g} className="size-2" style={{ backgroundColor: FACILITY_COLOURS[g] }} />
          ))}
        </span>
      }
    >
      {problem && <p className="text-xs text-destructive">{problem}</p>}
      {answer?.load === null && (
        <p className="text-xs text-muted-foreground">
          Not loaded yet: an admin runs Load facilities (GitHub → Actions).
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <span className={SIDE_LABEL}>Kind</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kinds shown">
          {FACILITY_GROUPS.map((g) => (
            <FilterChip
              key={g.key}
              dot={FACILITY_COLOURS[g.key]}
              pressed={groups.has(g.key)}
              onClick={() => {
                toggleGroup(g.key);
              }}
            >
              {g.name}
              {kindsInView && (
                <span className="font-mono text-xs opacity-70">
                  {(kindsInView.get(g.key) ?? 0).toLocaleString('en-CA')}
                </span>
              )}
            </FilterChip>
          ))}
        </div>
      </div>
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
      <div className="flex flex-col gap-1.5">
        <span className={SIDE_LABEL}>Status</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Statuses shown">
          {statuses.map((status) => (
            <FilterChip
              key={status}
              pressed={statusesOn.has(status)}
              onClick={() => {
                toggleStatus(status);
              }}
            >
              {status === '' ? 'No status' : status}
            </FilterChip>
          ))}
        </div>
      </div>
      {answer?.load && groups.size === 0 && (
        <p className="text-xs text-muted-foreground">Pick a kind to see facilities.</p>
      )}
      {answer?.load && (
        <p className="text-xs text-muted-foreground">
          {inView
            ? `${total(inView).toLocaleString('en-CA')} in view; `
            : 'Zoom in to about a 5 km distance bar to see them; '}
          {shown.length.toLocaleString('en-CA')} of {entries.length.toLocaleString('en-CA')} loaded
          shown. Faint: suspended, abandoned and other statuses than Active or New.
        </p>
      )}
    </MapSection>
  );

  const legend = () =>
    !view || !inView || total(inView) === 0 ? null : (
      <div className="flex flex-col gap-1.5">
        <LegendTitle>Facilities in view</LegendTitle>
        {FACILITY_GROUPS.filter((g) => (inView.get(g.key) ?? 0) > 0).map((g) => (
          <p key={g.key} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0"
              style={{ backgroundColor: FACILITY_COLOURS[g.key] }}
            />
            <span className="grow">{g.name}</span>
            <span className="font-mono text-muted-foreground">
              {(inView.get(g.key) ?? 0).toLocaleString('en-CA')}
            </span>
          </p>
        ))}
      </div>
    );

  const about = () => (
    <p>
      <strong className="font-medium text-foreground">Facilities.</strong> The Alberta Energy
      Regulator’s ST102 facility list
      {answer?.load?.fileDate ? ` (its file of ${landDay(answer.load.fileDate)})` : ''}, for the
      area loaded: each facility’s type, operator, licensee, licence and status as the AER writes
      them. Many points are the centre of a legal subdivision or a section, not the facility’s own
      spot: the panel says which. Data of the AER, shown to members only and not exported.
    </p>
  );

  return {
    view,
    operatorsInView,
    byKey,
    setPicked,
    onViewChange,
    updated: answer?.load?.loadedAt ?? null,
    fileDate: answer?.load?.fileDate ?? null,
    settings,
    apply,
    section,
    legend,
    about,
  };
}
