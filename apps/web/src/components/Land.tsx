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
  landKey,
  type LandMapAgreement,
  type LandMapFreehold,
  type LandMapOffset,
  type LandShape,
  type LandView,
} from '../lib/landMap';
import { DETAIL_GONE } from '../lib/mapDetail';

/**
 * Land held today on the oil and gas map (F-241): a "Land today" panel (who holds the Crown
 * rights, filtered by the rights they include, by holder and by term; land that is not the
 * Crown's; offset notices), a legend of the holders in view, and the card of the land clicked.
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

/** The box around a shape. */
function boundsOf(shape: LandShape): Bbox {
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
      const b = boundsOf(a.shape);
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
  onViewChange: (bbox: Bbox | null, zoom: number) => void;
  /** The land whose card is open, drawn with a bold outline. */
  setPicked: (keys: readonly string[]) => void;
  panel: () => React.ReactNode;
  /** The holders in view and what each mark means; null when no land is on. */
  legend: () => React.ReactNode;
}

const NONE: readonly string[] = [];
const LABEL = 'text-[0.6875rem] font-medium tracking-wider text-muted-foreground uppercase';

export function useLand(organizationId: string, token: string): LandState {
  const [all, setAll] = useState(true);
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
  const [open, setOpen] = useState(true);
  const [legendOpen, setLegendOpen] = useState(true);
  const [at, setAt] = useState<{ view: Bbox; zoom: number } | null>(null);
  const [settled, setSettled] = useState<Settled | null>(null);
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
  const wanted = useMemo(() => (at ? landWanted(on, at.zoom, rights) : []), [on, at, rights]);
  const covered =
    settled !== null &&
    !settled.failed &&
    at !== null &&
    landCovers(settled, at.view, wanted, rights);
  const box = at !== null && wanted.length > 0 && !covered ? landRequest(at.view) : null;
  const key = box
    ? `${wanted.join(',')}:${rights ?? ''}:${String(round(box.west))},${String(round(box.south))},${String(round(box.east))},${String(round(box.north))}`
    : null;
  const loading = key !== null && settled?.key !== key;
  const failed = settled?.failed === true && settled.key === key;

  useEffect(() => {
    if (key === null || box === null) return;
    const controller = new AbortController();
    const asked = [...wanted];
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
    // `box`, `wanted` and `rights` are described by `key`; asking again for the same would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, organizationId, token]);

  const answer = settled?.answer ?? null;
  // Only what is wanted now is drawn: a kind switched off, or too far out, is let go, and so
  // are agreements read for other rights than those now asked for.
  const shown = useMemo(() => {
    const agreementsNow =
      wanted.includes('agreements') && settled?.rights === rights
        ? (answer?.agreements.items ?? [])
        : [];
    return {
      agreements: landFiltered(agreementsNow, { holder, terms, today }),
      offsets: wanted.includes('offsets') ? (answer?.offsets.items ?? []) : [],
      freehold: wanted.includes('freehold') ? (answer?.freehold.items ?? []) : [],
    };
  }, [answer, wanted, settled?.rights, rights, holder, terms, today]);
  const features = useMemo(
    () => landFeatures(shown, { byHolder, today }),
    [shown, byHolder, today],
  );
  const agreements = useMemo(() => new Map(shown.agreements.map((a) => [a.id, a])), [shown]);
  const offsets = useMemo(() => new Map(shown.offsets.map((o) => [o.id, o])), [shown]);
  const freehold = useMemo(() => new Map(shown.freehold.map((f) => [f.id, f])), [shown]);
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

  const loads = answer?.source.loads ?? [];
  const loadedAt = loads.map((l) => l.loadedAt).sort()[loads.length - 1] ?? null;
  const far = (kind: LandKind) =>
    at !== null &&
    at.zoom < (kind === 'agreements' && rights !== null ? LAND_FROM_RIGHTS : LAND_FROM[kind]);
  const count = (kind: LandKind) =>
    !on[kind] ? '' : far(kind) ? 'zoom in' : shown[kind].length.toLocaleString('en-CA');
  const rightsName = rights !== null ? (LAND_RIGHTS[rights]?.name ?? rights) : null;

  const row = (kind: LandKind, title: string, note: string) => (
    <label className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-sm">
      <span className="grow font-medium">{title}</span>
      <span className={LABEL}>{count(kind) || note}</span>
      <input
        type="checkbox"
        aria-label={title}
        checked={kinds[kind]}
        onChange={(event) => {
          setKinds((before) => ({ ...before, [kind]: event.target.checked }));
        }}
      />
    </label>
  );

  const panel = () => (
    <div
      className="flex w-72 flex-col gap-2.5 rounded-card border bg-card/95 p-3 shadow-xs"
      role="group"
      aria-label="Land today"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen((before) => !before);
          }}
          className="flex grow items-center gap-1.5 text-left text-sm font-semibold"
        >
          <span aria-hidden="true" className="text-xs text-muted-foreground">
            {open ? '▾' : '▸'}
          </span>
          Land today
        </button>
        {rightsName && all && (
          <span className="rounded-full bg-foreground px-2 py-0.5 text-xs font-medium text-background">
            {rightsName}
          </span>
        )}
        <input
          type="checkbox"
          aria-label="Land today"
          checked={all}
          onChange={(event) => {
            setAll(event.target.checked);
          }}
        />
      </div>
      {open && all && (
        <>
          <p className="text-xs text-muted-foreground">
            Who holds the rights now, and land that never comes up for sale.
          </p>
          {row('agreements', 'Current agreements', 'who holds it today')}
          {kinds.agreements && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Rights include</span>
                  <select
                    className="h-8 rounded-md border bg-foreground px-2 text-sm font-medium text-background"
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
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Holder</span>
                  <input
                    type="search"
                    className="h-8 rounded-md border bg-card px-2 text-sm"
                    placeholder="Any holder"
                    value={holder}
                    onChange={(event) => {
                      setHolder(event.target.value);
                    }}
                  />
                </label>
              </div>
              <div className="flex items-start gap-2">
                <span className={`${LABEL} pt-1.5`}>Status</span>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status">
                  {LAND_TERMS.map((term) => (
                    <button
                      key={term}
                      type="button"
                      aria-pressed={terms.has(term)}
                      onClick={() => {
                        setTerms((before) => {
                          const next = new Set(before);
                          if (next.has(term)) next.delete(term);
                          else next.add(term);
                          return next;
                        });
                      }}
                      className="rounded-md border bg-card px-2 py-1 text-xs hover:bg-muted aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background"
                    >
                      {TERM_LABELS[term]}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={byHolder}
                  onChange={(event) => {
                    setByHolder(event.target.checked);
                  }}
                />
                <span className="font-medium">Colour by holder</span>
              </label>
              <p className="text-xs text-muted-foreground">
                Who holds the Crown rights today, drawn under the wells.{' '}
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
          {wanted.some((kind) => answer?.[kind].truncated) && (
            <p className="text-xs text-muted-foreground">
              More land than can be drawn at once here: zoom in to see all of it.
            </p>
          )}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none hover:text-foreground">
              About this data
            </summary>
            <div className="mt-1.5 flex flex-col gap-1.5">
              <p>
                Current agreements: the Crown’s petroleum and natural gas and oil sands leases and
                licences, a shape for each tract, in its holder’s colour (the designated
                representative; a colour can be shared by two holders). Hatched: its expiry falls
                within 12 months. The counts are those of the land in view.
              </p>
              <p>
                Rights include: read from each agreement’s zone as the province writes it. An
                agreement counts when any of its rights reach into the formation: in it, across it,
                down into it from above, or from within it down. Which formation lies above which is
                taken from the zones themselves (“below the base of the Cardium to the base of the
                Duvernay” places the Cardium above), from every agreement and sale parcel loaded,
                and from nowhere else. Where those do not settle it, the agreement is not counted.
              </p>
              <p>
                Freehold minerals: land whose petroleum and natural gas is not the Crown’s; the
                province names no owner. National parks and reserves are hatched in grey. Drawn from
                close in. Offset notices: the active ones, fainter once the deadline has passed.
                Click land for its details.
              </p>
              <p>
                {loadedAt
                  ? `${answer?.source.name ?? ''}, public map services; loaded ${formatAlberta(loadedAt, { weekday: false })}, for the area of the Duvernay's wells only so far. Not an official record.`
                  : answer
                    ? 'No land loaded yet.'
                    : 'Alberta Energy and Minerals, Government of Alberta, public map services.'}
              </p>
            </div>
          </details>
        </>
      )}
    </div>
  );

  const legend = () =>
    !anyOn ? null : (
      <div
        className="w-64 rounded-card border bg-card/95 p-3 text-xs shadow-xs"
        role="group"
        aria-label="Land legend"
      >
        <div className="flex items-center justify-between">
          <p className={LABEL}>{byHolder ? 'Holders in view' : 'Land today'}</p>
          <button
            type="button"
            aria-expanded={legendOpen}
            aria-label={legendOpen ? 'Hide the legend' : 'Show the legend'}
            onClick={() => {
              setLegendOpen((before) => !before);
            }}
            className="rounded-sm px-1.5 leading-none text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {legendOpen ? '−' : '+'}
          </button>
        </div>
        {legendOpen && (
          <>
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
            <ul className="mt-2 flex flex-col gap-1 border-t pt-2">
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
          </>
        )}
      </div>
    );

  return { view, agreements, offsets, freehold, onViewChange, setPicked, panel, legend };
}

/** A small square of the legend: filled, hatched or outlined. */
function Swatch({ colour, hatch, outline }: { colour?: string; hatch?: string; outline?: string }) {
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

const hectares = (n: number) => `${n.toLocaleString('en-CA', { maximumFractionDigits: 1 })} ha`;

/** "Lease 002-924, tract 00": an agreement as the province numbers it. */
export function landAgreementName(a: LandMapAgreement): string {
  const kind = a.group === 'LEASE' ? 'Lease' : a.group === 'LICENSE' ? 'Licence' : 'Agreement';
  return `${kind} ${a.agreementType}-${a.agreementNumber}${a.tract ? `, tract ${a.tract}` : ''}`;
}

/** At most this many pieces of land are written out on one card. */
const CARD_MAX = 6;

/**
 * The card of the land clicked: every agreement, offset notice and piece of non-Crown land
 * under the click, the agreements first, kept open until closed.
 */
export function LandCard({
  pick,
  land,
  saleRow,
  onClose,
}: {
  pick: LandPick | null;
  land: Pick<LandState, 'agreements' | 'offsets' | 'freehold'>;
  /** A sale parcel's lines (F-242), by its id; they come first on the card. */
  saleRow?: (id: string) => React.ReactNode;
  onClose: () => void;
}) {
  if (!pick) return null;
  const today = landToday();
  const rows: React.ReactNode[] = [];
  for (const key of pick.keys) {
    const cut = key.indexOf(':');
    const of = key.slice(0, cut);
    const id = key.slice(cut + 1);
    const agreement = of === 'png' || of === 'oil_sands' ? land.agreements.get(id) : undefined;
    const offset = of === 'offset' ? land.offsets.get(id) : undefined;
    const freehold = of === 'freehold' ? land.freehold.get(id) : undefined;
    const sale = of === 'sale' ? saleRow?.(id) : null;
    if (sale) {
      rows.push(sale);
    } else if (agreement) {
      rows.push(
        <li key={landKey(agreement.rights, id)}>
          <p className="flex items-center gap-1.5 font-semibold">
            <Swatch colour={landHolderColour(agreement.holder)} />
            {agreement.holder ? landReadable(agreement.holder) : 'No holder named'}
          </p>
          <p>{landAgreementName(agreement)}</p>
          <p className="text-xs text-muted-foreground">
            {[
              agreement.rights === 'png' ? 'Petroleum and natural gas' : 'Oil sands',
              agreement.status,
              agreement.vintage,
              agreement.areaHa !== null ? hectares(agreement.areaHa) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {agreement.parties && agreement.parties !== agreement.holder && (
            <p className="text-xs text-muted-foreground">Parties: {agreement.parties}</p>
          )}
          {agreement.zone && <p className="text-xs text-muted-foreground">{agreement.zone}</p>}
          <p className="text-xs text-muted-foreground">
            {[
              agreement.termDate && `Term from ${agreement.termDate}`,
              agreement.continuationDate && `continued ${agreement.continuationDate}`,
              agreement.expiryText && `expiry: ${agreement.expiryText}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {landExpiring(agreement.expiryText, today) && (
            <p className="text-xs font-medium">Expires within 12 months.</p>
          )}
        </li>,
      );
    } else if (offset) {
      rows.push(
        <li key={landKey('offset', id)}>
          <p className="font-semibold">
            Offset notice {offset.offsetNumber}
            {offset.tract ? `, tract ${offset.tract}` : ''}
          </p>
          {offset.holder && <p>{landReadable(offset.holder)}</p>}
          {offset.zone && <p className="text-xs text-muted-foreground">{offset.zone}</p>}
          {offset.expiryDate && (
            <p className="text-xs text-muted-foreground">
              Deadline {offset.expiryDate}
              {offset.expiryDate < today ? ' (passed)' : ''}
            </p>
          )}
        </li>,
      );
    } else if (freehold) {
      rows.push(
        <li key={landKey('freehold', id)}>
          <p className="font-semibold">
            {freehold.nationalPark
              ? `National park: ${freehold.nationalPark}`
              : freehold.reserveName || freehold.reserveNumber
                ? `Reserve: ${freehold.reserveName ?? freehold.reserveNumber ?? ''}`
                : 'Freehold minerals (not the Crown’s)'}
          </p>
          {freehold.substances && (
            <p className="text-xs text-muted-foreground">{freehold.substances}</p>
          )}
        </li>,
      );
    }
  }
  if (rows.length === 0) return null;
  const more = rows.length - CARD_MAX;
  // Opens to the left of the click near the window's right edge, and above it near the bottom.
  const left = pick.x > window.innerWidth - 360;
  const up = pick.y > window.innerHeight - 320;
  return (
    <div
      role="dialog"
      aria-label="Land here"
      className="absolute z-30 max-h-[min(24rem,calc(100%-1rem))] w-80 overflow-y-auto rounded-card border bg-card p-3 text-sm shadow-md"
      style={{
        left: pick.x,
        top: pick.y,
        transform: `translate(${left ? 'calc(-100% - 14px)' : '14px'}, ${up ? 'calc(-100% - 14px)' : '14px'})`,
      }}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute top-1.5 right-1.5 rounded-sm px-1.5 text-base leading-none text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        ×
      </button>
      <ul className="flex flex-col gap-2 pr-4">{rows.slice(0, CARD_MAX)}</ul>
      {more > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          +{more} more here: zoom in and click a smaller spot.
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Alberta Energy and Minerals, Government of Alberta. Not an official record.
      </p>
    </div>
  );
}
