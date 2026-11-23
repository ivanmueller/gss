import { formatAlberta, LAND_RIGHTS, type Bbox } from '@grain/domain';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { apiJson } from '../lib/api';
import {
  LAND_FREEHOLD,
  LAND_OFFSET,
  LAND_PLAIN,
  LAND_RESERVE,
  landExpiring,
  landFeatures,
  landHolderColour,
  type LandMapAgreement,
  type LandMapFreehold,
  type LandMapOffset,
  type LandShape,
  type LandView,
} from '../lib/landMap';
import { DETAIL_GONE } from '../lib/mapDetail';
import {
  FilterChip,
  LegendTitle,
  MapSection,
  SIDE_INPUT,
  SIDE_LABEL,
  SIDE_SELECT,
  SwitchRow,
} from './MapSide';

/**
 * Land held today on the oil and gas map (F-241): a "Land today" panel (who holds the Crown
 * rights, filtered by the rights they include, by holder and by term; land that is not the
 * Crown's; offset notices) and a legend of the holders in view. The box at the pointer and the
 * panel of the land clicked are in LandPanel.tsx (F-265).
 * Data from Alberta Energy and Minerals, named wherever it is shown, as the Open Government
 * Licence - Alberta asks (docs/DECISIONS.md, 2026-11-21).
 */

export const LAND_KINDS = ['agreements', 'offsets', 'freehold'] as const;
export type LandKind = (typeof LAND_KINDS)[number];

/**
 * The zoom each kind is drawn from: farther out a view holds more shapes than can be sent and
 * drawn at once (about 135 km across at zoom 10 on a wide screen). Agreements narrowed to one
 * play's rights are few enough to draw from far out (LAND_FROM_RIGHTS). Nothing is asked for
 * farther out than DETAIL_GONE, where the map draws no land (F-260).
 */
export const LAND_FROM: Record<LandKind, number> = {
  agreements: 10,
  offsets: DETAIL_GONE,
  freehold: 11,
};
export const LAND_FROM_RIGHTS = DETAIL_GONE;

/** The terms the Status chips keep. */
export const LAND_TERMS = ['primary', 'expiring', 'continued'] as const;
export type LandTerm = (typeof LAND_TERMS)[number];
const TERM_LABELS: Record<LandTerm, string> = {
  primary: 'Primary term',
  expiring: 'Expiring 12 mo',
  continued: 'Continued',
};

interface Cut<T> {
  truncated: boolean;
  items: T[];
}

interface Answer {
  source: {
    name: string;
    loads: { layer: string; loadedAt: string; area: Bbox; shapes: number }[];
  };
  agreements: Cut<LandMapAgreement>;
  offsets: Cut<LandMapOffset>;
  freehold: Cut<LandMapFreehold>;
}

/** Land is only in Alberta: a view is cut to it before asking. */
const ALBERTA: Bbox = { west: -120.1, south: 48.9, east: -109.9, north: 60.1 };

/**
 * The kinds to ask for: those switched on that the zoom is close enough to draw. Agreements
 * narrowed to a play's rights are drawn from farther out.
 */
export function landWanted(
  on: Record<LandKind, boolean>,
  zoom: number,
  rights: string | null = null,
): LandKind[] {
  return LAND_KINDS.filter(
    (kind) =>
      on[kind] &&
      zoom >= (kind === 'agreements' && rights !== null ? LAND_FROM_RIGHTS : LAND_FROM[kind]),
  );
}

/** The box asked for: the view and a sixth again on each side, within Alberta; null outside. */
export function landRequest(view: Bbox): Bbox | null {
  const padX = (view.east - view.west) / 6;
  const padY = (view.north - view.south) / 6;
  const box = {
    west: Math.max(ALBERTA.west, view.west - padX),
    south: Math.max(ALBERTA.south, view.south - padY),
    east: Math.min(ALBERTA.east, view.east + padX),
    north: Math.min(ALBERTA.north, view.north + padY),
  };
  return box.west < box.east && box.south < box.north ? box : null;
}

/** The last answer that came back (or failed): the box, kinds and rights it was for. */
interface Settled {
  key: string;
  asked: Bbox;
  kinds: readonly LandKind[];
  rights: string | null;
  answer: Answer | null;
  failed: boolean;
}

/**
 * Whether the land already asked for serves this view: the same rights, the same kinds or
 * more, the view inside the box asked for, and nothing left out of that answer for being too
 * many.
 */
export function landCovers(
  settled: Pick<Settled, 'asked' | 'kinds' | 'rights' | 'answer'>,
  view: Bbox,
  kinds: readonly LandKind[],
  rights: string | null = null,
): boolean {
  if (!settled.answer) return false;
  if (kinds.includes('agreements') && settled.rights !== rights) return false;
  if (kinds.some((kind) => !settled.kinds.includes(kind) || settled.answer?.[kind].truncated)) {
    return false;
  }
  const { asked } = settled;
  return (
    Math.max(ALBERTA.west, view.west) >= asked.west &&
    Math.min(ALBERTA.east, view.east) <= asked.east &&
    Math.max(ALBERTA.south, view.south) >= asked.south &&
    Math.min(ALBERTA.north, view.north) <= asked.north
  );
}

/** An agreement's term: its first one (primary, initial, intermediate), or continued. */
export function landTerm(a: Pick<LandMapAgreement, 'vintage'>): 'primary' | 'continued' | null {
  const vintage = a.vintage ?? '';
  if (vintage.startsWith('CONTINUED')) return 'continued';
  return /^(PRIMARY|INITIAL|INTERMEDIATE)/.test(vintage) ? 'primary' : null;
}

/**
 * The agreements the panel's filters keep: a holder whose name holds the text typed, and, when
 * any Status chip is on, one of the terms chosen.
 */
export function landFiltered(
  agreements: readonly LandMapAgreement[],
  filters: { holder: string; terms: ReadonlySet<LandTerm>; today: string },
): LandMapAgreement[] {
  const text = filters.holder.trim().toLowerCase();
  return agreements.filter((a) => {
    if (text !== '' && !(a.holder ?? '').toLowerCase().includes(text)) return false;
    if (filters.terms.size === 0) return true;
    const term = landTerm(a);
    return (
      (term !== null && filters.terms.has(term)) ||
      (filters.terms.has('expiring') && landExpiring(a.expiryText, filters.today))
    );
  });
}

/** The box around a shape, worked out once: the holders in view are counted at every move. */
const boxes = new WeakMap<LandShape, Bbox>();
export function landBounds(shape: LandShape): Bbox {
  const kept = boxes.get(shape);
  if (kept) return kept;
  const box = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
  for (const polygon of shape) {
    for (const [x, y] of polygon[0] ?? []) {
      if (x === undefined || y === undefined) continue;
      box.west = Math.min(box.west, x);
      box.east = Math.max(box.east, x);
      box.south = Math.min(box.south, y);
      box.north = Math.max(box.north, y);
    }
  }
  boxes.set(shape, box);
  return box;
}

/**
 * The holders whose agreements touch the view, the one with the most land first (by the
 * hectares the province gives; a tract without them counts as none).
 */
export function landHolders(
  agreements: readonly LandMapAgreement[],
  view: Bbox | null,
): { holder: string; hectares: number; tracts: number }[] {
  const by = new Map<string, { holder: string; hectares: number; tracts: number }>();
  for (const a of agreements) {
    if (!a.holder) continue;
    if (view) {
      const b = landBounds(a.shape);
      if (
        b.east < view.west ||
        b.west > view.east ||
        b.north < view.south ||
        b.south > view.north
      ) {
        continue;
      }
    }
    const row = by.get(a.holder) ?? { holder: a.holder, hectares: 0, tracts: 0 };
    row.hectares += a.areaHa ?? 0;
    row.tracts += 1;
    by.set(a.holder, row);
  }
  return [...by.values()].sort(
    (x, y) => y.hectares - x.hectares || x.holder.localeCompare(y.holder),
  );
}

/** EXAMPLE ENERGY LTD. → Example Energy Ltd.: a holder's name as the province writes it. */
export function landReadable(name: string): string {
  return name
    .toLowerCase()
    .replace(
      /(^|[^a-z'’])([a-z])/g,
      (_, before: string, letter: string) => `${before}${letter.toUpperCase()}`,
    );
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;

/** Today in Alberta (UTC-6 all year), as YYYY-MM-DD. */
export function landToday(now = new Date()): string {
  return new Date(now.getTime() - 6 * 3_600_000).toISOString().slice(0, 10);
}

/** What a click on the map found: the keys of the land under it, and where. */
export interface LandPick {
  keys: string[];
  x: number;
  y: number;
}

export interface LandState {
  view: LandView | null;
  agreements: ReadonlyMap<string, LandMapAgreement>;
  offsets: ReadonlyMap<string, LandMapOffset>;
  freehold: ReadonlyMap<string, LandMapFreehold>;
  /** The shape of a piece of land by its key (`png:12`), for the outline under the pointer. */
  shapeOf: (key: string) => LandShape | null;
  onViewChange: (bbox: Bbox | null, zoom: number) => void;
  /** The land whose card is open, drawn with a bold outline. */
  setPicked: (keys: readonly string[]) => void;
  /** Narrows the agreements to a play's rights; null for every agreement. */
  setRights: (rights: string | null) => void;
  /** When the land was last loaded; null before an answer. */
  updated: string | null;
  section: (props: { open: boolean; onToggle: () => void }) => React.ReactNode;
  /** The holders in view and what each mark means; null when no land is on. */
  legend: () => React.ReactNode;
  /** What the section shows and where it comes from, for Sources & licence. */
  about: () => React.ReactNode;
}

const NONE: readonly string[] = [];
const LABEL = SIDE_LABEL;

/**
 * One request for land and what came back. `ground` is the map's view (the box asked for is
 * that view and some more, and a view that leaves it asks again), or "all" for every shape
 * loaded, asked for once whatever the view; null asks for nothing. A request that failed is
 * made again when `moved`, the map's place, next changes.
 */
function useLandAnswer(
  organizationId: string,
  token: string,
  kinds: readonly LandKind[],
  rights: string | null,
  ground: Bbox | 'all' | null,
  moved: string,
) {
  const [settled, setSettled] = useState<Settled | null>(null);
  const covered =
    settled !== null &&
    !settled.failed &&
    (ground === 'all'
      ? settled.answer !== null &&
        kinds.every((kind) => settled.kinds.includes(kind)) &&
        (!kinds.includes('agreements') || settled.rights === rights)
      : ground !== null && landCovers(settled, ground, kinds, rights));
  const box =
    kinds.length === 0 || covered || ground === null
      ? null
      : ground === 'all'
        ? ALBERTA
        : landRequest(ground);
  const again = ground === 'all' && settled?.failed === true ? `@${moved}` : '';
  const key = box
    ? `${kinds.join(',')}:${rights ?? ''}:${String(round(box.west))},${String(round(box.south))},${String(round(box.east))},${String(round(box.north))}${again}`
    : null;
  const loading = key !== null && settled?.key !== key;
  const failed = settled?.failed === true && settled.key === key;

  useEffect(() => {
    if (key === null || box === null) return;
    const controller = new AbortController();
    const asked = [...kinds];
    const query = new URLSearchParams({
      organization_id: organizationId,
      west: String(round(box.west)),
      south: String(round(box.south)),
      east: String(round(box.east)),
      north: String(round(box.north)),
      layers: asked.join(','),
    });
    if (rights !== null) query.set('rights', rights);
    apiJson<Answer>(`/petroleum/land?${query.toString()}`, token, { signal: controller.signal })
      .then((answer) => {
        setSettled({ key, asked: box, kinds: asked, rights, answer, failed: false });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // The land already drawn stays; moving the map asks again.
        setSettled((before) => ({
          key,
          asked: box,
          kinds: before?.kinds ?? [],
          rights: before?.rights ?? null,
          answer: before?.answer ?? null,
          failed: true,
        }));
      });
    return () => {
      controller.abort();
    };
    // `box`, `kinds` and `rights` are described by `key`; asking again for the same would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, organizationId, token]);

  return { settled, loading, failed };
}

export function useLand(organizationId: string, token: string): LandState {
  // Off when the map opens (F-284): switched on from its section.
  const [all, setAll] = useState(false);
  const [kinds, setKinds] = useState<Record<LandKind, boolean>>({
    agreements: true,
    offsets: true,
    freehold: true,
  });
  // The play the agreements' rights must include; null for every agreement.
  const [rights, setRights] = useState<string | null>('duvernay');
  const [holder, setHolder] = useState('');
  const [terms, setTerms] = useState<ReadonlySet<LandTerm>>(new Set());
  const [byHolder, setByHolder] = useState(true);
  const [at, setAt] = useState<{ view: Bbox; zoom: number } | null>(null);
  const [picked, setPicked] = useState<readonly string[]>(NONE);
  const today = useMemo(() => landToday(), []);

  const on = useMemo(
    () => ({
      agreements: all && kinds.agreements,
      offsets: all && kinds.offsets,
      freehold: all && kinds.freehold,
    }),
    [all, kinds],
  );
  // Held whole, asked for once and kept at every zoom (F-263): the offset notices, and the
  // agreements with one play's rights. By the map's view, close in: land that is not the
  // Crown's, and every agreement when no play narrows them (both too many to hold at once).
  const wholeKey = [
    on.agreements && rights !== null ? 'agreements' : '',
    on.offsets ? 'offsets' : '',
  ]
    .filter(Boolean)
    .join(',');
  const viewKey = (at ? landWanted(on, at.zoom, rights) : [])
    .filter((kind) => kind === 'freehold' || (kind === 'agreements' && rights === null))
    .join(',');
  // By their text, so a move of the map that changes neither makes no new list (and so no
  // new features for the map to read again).
  const wholeKinds = useMemo(() => (wholeKey ? wholeKey.split(',') : []) as LandKind[], [wholeKey]);
  const viewKinds = useMemo(() => (viewKey ? viewKey.split(',') : []) as LandKind[], [viewKey]);
  const moved = at
    ? `${String(round(at.view.west))},${String(round(at.view.south))},${String(round(at.zoom))}`
    : '';
  const held = useLandAnswer(organizationId, token, wholeKinds, rights, 'all', moved);
  const seen = useLandAnswer(organizationId, token, viewKinds, null, at?.view ?? null, moved);
  const loading = held.loading || seen.loading;
  const failed = held.failed || seen.failed;

  const heldAnswer = held.settled?.answer ?? null;
  const heldRights = held.settled?.rights ?? null;
  const seenAnswer = seen.settled?.answer ?? null;
  const answer = heldAnswer ?? seenAnswer;
  // Only what is switched on is drawn, and agreements read for other rights than those now
  // asked for are let go. What is held whole is drawn whatever the zoom: the map's layers fade
  // it out far out, with nothing to read again.
  const loaded = useMemo(
    () =>
      rights !== null
        ? on.agreements && heldRights === rights
          ? (heldAnswer?.agreements.items ?? [])
          : []
        : viewKinds.includes('agreements')
          ? (seenAnswer?.agreements.items ?? [])
          : [],
    [heldAnswer, heldRights, seenAnswer, on, viewKinds, rights],
  );
  const shown = useMemo(
    () => ({
      agreements: landFiltered(loaded, { holder, terms, today }),
      offsets: on.offsets ? (heldAnswer?.offsets.items ?? []) : [],
      freehold: viewKinds.includes('freehold') ? (seenAnswer?.freehold.items ?? []) : [],
    }),
    [loaded, heldAnswer, seenAnswer, on, viewKinds, holder, terms, today],
  );
  const truncated =
    wholeKinds.some((kind) => heldAnswer?.[kind].truncated) ||
    viewKinds.some((kind) => seenAnswer?.[kind].truncated);
  const features = useMemo(
    () => landFeatures(shown, { byHolder, today }),
    [shown, byHolder, today],
  );
  const agreements = useMemo(() => new Map(shown.agreements.map((a) => [a.id, a])), [shown]);
  const offsets = useMemo(() => new Map(shown.offsets.map((o) => [o.id, o])), [shown]);
  const freehold = useMemo(() => new Map(shown.freehold.map((f) => [f.id, f])), [shown]);
  const shapeOf = useCallback(
    (key: string) => {
      const cut = key.indexOf(':');
      const of = key.slice(0, cut);
      const id = key.slice(cut + 1);
      const found =
        of === 'png' || of === 'oil_sands'
          ? agreements.get(id)
          : of === 'offset'
            ? offsets.get(id)
            : of === 'freehold'
              ? freehold.get(id)
              : undefined;
      return found?.shape ?? null;
    },
    [agreements, offsets, freehold],
  );
  const anyOn = LAND_KINDS.some((kind) => on[kind]);
  const view = useMemo<LandView | null>(
    () => (anyOn ? { land: features, picked } : null),
    [anyOn, features, picked],
  );
  const holders = useMemo(
    () => landHolders(shown.agreements, at?.view ?? null),
    [shown.agreements, at],
  );

  const onViewChange = useCallback((bbox: Bbox | null, zoom: number) => {
    setAt(bbox ? { view: bbox, zoom } : null);
  }, []);

  const loads = [...(heldAnswer?.source.loads ?? []), ...(seenAnswer?.source.loads ?? [])];
  const loadedAt = loads.map((l) => l.loadedAt).sort()[loads.length - 1] ?? null;
  const far = (kind: LandKind) =>
    at !== null &&
    at.zoom < (kind === 'agreements' && rights !== null ? LAND_FROM_RIGHTS : LAND_FROM[kind]);
  const count = (kind: LandKind) =>
    !on[kind] ? '' : far(kind) ? 'zoom in' : shown[kind].length.toLocaleString('en-CA');
  const rightsName = rights !== null ? (LAND_RIGHTS[rights]?.name ?? rights) : null;

  const row = (kind: LandKind, title: string, note: string) => (
    <SwitchRow
      title={title}
      note={count(kind) || note}
      checked={kinds[kind]}
      onChange={(checked) => {
        setKinds((before) => ({ ...before, [kind]: checked }));
      }}
    />
  );

  const section = ({ open, onToggle }: { open: boolean; onToggle: () => void }) => (
    <MapSection
      title="Land today"
      open={open}
      onToggle={onToggle}
      on={all}
      onSwitch={setAll}
      chip={kinds.agreements ? rightsName : null}
      onClearChip={() => {
        setRights(null);
      }}
      sample={<Swatch hatch="#44403c" />}
    >
      <p className="text-[0.8125rem] text-muted-foreground">
        Who holds the rights now, and land that never comes up for sale.
      </p>
      {row('agreements', 'Current agreements', 'who holds it today')}
      {kinds.agreements && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Rights include</span>
              <select
                className={SIDE_SELECT}
                value={rights ?? ''}
                onChange={(event) => {
                  setRights(event.target.value === '' ? null : event.target.value);
                }}
              >
                {Object.values(LAND_RIGHTS).map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.name}
                  </option>
                ))}
                <option value="">All rights</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Holder</span>
              <input
                type="search"
                className={SIDE_INPUT}
                placeholder="Any holder"
                value={holder}
                onChange={(event) => {
                  setHolder(event.target.value);
                }}
              />
            </label>
          </div>
          <div className="flex items-start gap-3">
            <span className={`${LABEL} pt-2`}>Status</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status">
              {LAND_TERMS.map((term) => (
                <FilterChip
                  key={term}
                  pressed={terms.has(term)}
                  onClick={() => {
                    setTerms((before) => {
                      const next = new Set(before);
                      if (next.has(term)) next.delete(term);
                      else next.add(term);
                      return next;
                    });
                  }}
                >
                  {TERM_LABELS[term]}
                </FilterChip>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-foreground"
              checked={byHolder}
              onChange={(event) => {
                setByHolder(event.target.checked);
              }}
            />
            <span className="font-medium">Colour by holder</span>
            <span className="text-xs text-muted-foreground">a soft colour for each holder</span>
          </label>
          <p className="text-xs text-muted-foreground">
            Who holds the Crown rights today, drawn under the sale parcels and the wells.{' '}
            {rightsName
              ? `Only agreements whose rights include the ${rightsName}.`
              : 'Every agreement: zoom in to see them.'}
          </p>
        </>
      )}
      {row('freehold', 'Freehold minerals', 'not Crown-owned')}
      {row('offsets', 'Offset notices', 'drainage deadlines')}
      {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {failed && (
        <p className="text-xs text-destructive">
          The land could not be loaded. Move the map to try again.
        </p>
      )}
      {truncated && (
        <p className="text-xs text-muted-foreground">
          More land than can be drawn at once here: zoom in to see all of it.
        </p>
      )}
    </MapSection>
  );

  const about = () => (
    <>
      <p>
        <strong className="font-medium text-foreground">Land today.</strong> Current agreements: the
        Crown’s petroleum and natural gas and oil sands leases and licences, a shape for each tract,
        in its holder’s colour (the designated representative; a colour can be shared by two
        holders). Hatched: its expiry falls within 12 months. The counts are those of the land in
        view.
      </p>
      <p>
        Rights include: read from each agreement’s zone as the province writes it. An agreement
        counts when any of its rights reach into the formation: in it, across it, down into it from
        above, or from within it down. Which formation lies above which is taken from the zones
        themselves (“below the base of the Cardium to the base of the Duvernay” places the Cardium
        above), from every agreement and sale parcel loaded, and from nowhere else. Where those do
        not settle it, the agreement is not counted.
      </p>
      <p>
        Freehold minerals: land whose petroleum and natural gas is not the Crown’s; the province
        names no owner. National parks and reserves are hatched in grey. Drawn from close in. Offset
        notices: the active ones, fainter once the deadline has passed. Point at land for a few
        lines about it; click it for its details in a panel on the right.
      </p>
      <p>
        {loadedAt
          ? `${answer?.source.name ?? ''}, public map services; loaded ${formatAlberta(loadedAt, { weekday: false })}, for the Duvernay's area only so far. Not an official record.`
          : answer
            ? 'No land loaded yet.'
            : 'Alberta Energy and Minerals, Government of Alberta, public map services.'}
      </p>
    </>
  );

  const legend = () =>
    !anyOn ? null : (
      <div role="group" aria-label="Land legend">
        <LegendTitle>{byHolder ? 'Holders in view' : 'Land today'}</LegendTitle>
        {on.agreements && (
          <ul
            className="mt-2 flex max-h-36 flex-col gap-1 overflow-y-auto"
            aria-label="Holders in view"
          >
            {byHolder ? (
              holders.length > 0 ? (
                holders.map((h) => (
                  <li key={h.holder} className="flex items-center gap-2">
                    <Swatch colour={landHolderColour(h.holder)} />
                    <span className="truncate" title={h.holder}>
                      {landReadable(h.holder)}
                    </span>
                  </li>
                ))
              ) : (
                <li className="text-muted-foreground">
                  {far('agreements') ? 'Zoom in to see who holds the land.' : 'None here.'}
                </li>
              )
            ) : (
              <li className="flex items-center gap-2">
                <Swatch colour={LAND_PLAIN} />
                Current agreements
              </li>
            )}
          </ul>
        )}
        <ul className="mt-2 flex flex-col gap-1">
          {on.agreements && (
            <li className="flex items-center gap-2">
              <Swatch hatch="#44403c" />
              Expiring within 12 months
            </li>
          )}
          {on.freehold && (
            <>
              <li className="flex items-center gap-2">
                <Swatch hatch={LAND_FREEHOLD} />
                Freehold minerals
              </li>
              <li className="flex items-center gap-2">
                <Swatch hatch={LAND_RESERVE} />
                National park or reserve
              </li>
            </>
          )}
          {on.offsets && (
            <>
              <li className="flex items-center gap-2">
                <Swatch outline={LAND_OFFSET} />
                Offset notice, open
              </li>
              <li className="flex items-center gap-2">
                <Swatch outline={`${LAND_OFFSET}80`} />
                Deadline passed
              </li>
            </>
          )}
        </ul>
      </div>
    );

  return {
    view,
    agreements,
    offsets,
    freehold,
    shapeOf,
    onViewChange,
    setPicked,
    setRights,
    updated: loadedAt,
    section,
    legend,
    about,
  };
}

/** A small square of the legend: filled, hatched or outlined. */
export function Swatch({
  colour,
  hatch,
  outline,
}: {
  colour?: string;
  hatch?: string;
  outline?: string;
}) {
  const style: React.CSSProperties = colour
    ? { backgroundColor: colour, borderColor: colour }
    : hatch
      ? {
          borderColor: hatch,
          backgroundImage: `repeating-linear-gradient(135deg, ${hatch} 0 1px, transparent 1px 3px)`,
        }
      : { borderColor: outline, borderWidth: 2, backgroundColor: `${LAND_OFFSET}26` };
  return (
    <span
      aria-hidden="true"
      className="inline-block size-3 shrink-0 rounded-[2px] border"
      style={style}
    />
  );
}

/** "Lease 002-924, tract 00": an agreement as the province numbers it. */
export function landAgreementName(a: LandMapAgreement): string {
  const kind = a.group === 'LEASE' ? 'Lease' : a.group === 'LICENSE' ? 'Licence' : 'Agreement';
  return `${kind} ${a.agreementType}-${a.agreementNumber}${a.tract ? `, tract ${a.tract}` : ''}`;
}
