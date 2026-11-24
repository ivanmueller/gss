import { formatAlberta, LAND_RIGHTS, type Bbox, type MapSettings } from '@grain/domain';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { apiJson } from '../lib/api';
import {
  landSaleFeatures,
  landSaleState,
  SALE_BLUES,
  SALE_NO_OFFERS,
  SALE_STEPS,
  SALE_UPCOMING,
  type LandSaleDocuments,
  type LandSaleParcel,
  type LandSaleState,
  type LandSalesView,
} from '../lib/landSalesMap';
import { ST37_OUTLINES } from '../lib/st37Map';
import type { MapBounds } from '../lib/mapbox';
import { landBounds, landRequest, landToday } from './Land';
import {
  FilterChip,
  Fold,
  LegendTitle,
  MapSection,
  SIDE_INPUT,
  SIDE_LABEL,
  SIDE_SELECT,
} from './MapSide';

/**
 * Crown land sales on the oil and gas map (F-242): a "Land sales" panel (the next sale, the
 * rights and buyer asked for, the bonus paid over a period with its totals and its history by
 * quarter, the statuses shown) and a legend of the bonus per hectare. A parcel's box at the
 * pointer and its panel on the right are in LandPanel.tsx (F-265). Data from Alberta Energy and Minerals, named wherever it is shown
 * (docs/DECISIONS.md, 2026-11-21). Every figure is the province's own or a sum of them made by
 * the database; nothing is estimated.
 */

/** The periods the panel offers, as years back from today; null for every year loaded. */
export const SALE_PERIODS = [
  { key: '1', label: '12 mo', title: 'last 12 mo', years: 1 },
  { key: '2', label: '2 yrs', title: 'last 2 yrs', years: 2 },
  { key: '5', label: '5 yrs', title: 'last 5 yrs', years: 5 },
  { key: 'all', label: 'All', title: 'all years', years: null },
] as const;
export type SalePeriod = (typeof SALE_PERIODS)[number]['key'];

/** Dates chosen (YYYY-MM-DD), both included; null for no limit on that side (F-303). */
export interface SaleRange {
  from: string | null;
  to: string | null;
}

/**
 * What the panel's When row holds: a period ending today, one sale by its date (F-267), or a
 * year or dates chosen (F-303).
 */
export type SaleWhen = SalePeriod | { sale: string } | SaleRange;

/** A whole year as dates: 2023 is 2023-01-01 to 2023-12-31. */
export function saleYear(year: number): SaleRange {
  return { from: `${String(year)}-01-01`, to: `${String(year)}-12-31` };
}

/** The year a range is, when it is exactly one whole year; null otherwise. */
export function saleRangeYear(range: SaleRange): number | null {
  if (range.from === null || range.to === null) return null;
  const year = Number(range.from.slice(0, 4));
  const whole = saleYear(year);
  return range.from === whole.from && range.to === whole.to ? year : null;
}

/** The sales a When holds: from this date on, and before that one (null: no limit). */
export function saleWindow(
  when: SaleWhen,
  today: string,
): { since: string | null; until: string | null } {
  if (typeof when !== 'object') return { since: saleSince(when, today), until: null };
  if ('sale' in when) return { since: when.sale, until: saleNextDay(when.sale) };
  return { since: when.from, until: when.to === null ? null : saleNextDay(when.to) };
}

/** A range in words: `2023`, `Mar 1, 2023 to Jun 30, 2024`, `from Mar 1, 2023`. */
export function saleRangeTitle(range: SaleRange): string {
  const year = saleRangeYear(range);
  if (year !== null) return String(year);
  if (range.from !== null && range.to !== null) {
    return `${saleDay(range.from, true)} to ${saleDay(range.to, true)}`;
  }
  if (range.from !== null) return `from ${saleDay(range.from, true)}`;
  if (range.to !== null) return `up to ${saleDay(range.to, true)}`;
  return 'all years';
}

/** The day after a date (YYYY-MM-DD): one sale's parcels are those from its day to before it. */
export function saleNextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-12-02` as `Dec 2`, or `Dec 2, 2026` with its year. */
export function saleDay(date: string, year = false): string {
  const month = MONTHS[Number(date.slice(5, 7)) - 1] ?? '';
  return `${month} ${String(Number(date.slice(8, 10)))}${year ? `, ${date.slice(0, 4)}` : ''}`;
}

/** The first sale date of a period ending today (YYYY-MM-DD); null for every year. */
export function saleSince(period: SalePeriod, today: string): string | null {
  const years = SALE_PERIODS.find((p) => p.key === period)?.years ?? null;
  return years === null ? null : `${String(Number(today.slice(0, 4)) - years)}${today.slice(4)}`;
}

/**
 * The zoom from which parcels are asked for by the map's view, when no play's rights narrow
 * them: every parcel loaded is too many to hold at once. With a play's rights they are asked
 * for whole, once, every year of them, and kept at every zoom (F-263): 0.
 */
export function saleFromZoom(rights: string | null): number {
  return rights !== null ? 0 : 9;
}

/**
 * The pieces a play's parcels are read in, the newest sales first, each from a date on and
 * before the piece ahead of it: one answer with every year is tens of megabytes, more than the
 * API should hold at once, and the newest piece alone serves the periods most looked at
 * (F-263). Fixed dates, so each piece's address stays the same and the browser can keep it.
 */
const SALE_PIECE_STARTS = ['2021-01-01', '2014-01-01', '2010-01-01', '2007-01-01'] as const;
export const SALE_PIECES: readonly { since: string | null; until: string | null }[] = [
  ...SALE_PIECE_STARTS.map((since, i) => ({ since, until: SALE_PIECE_STARTS[i - 1] ?? null })),
  { since: null, until: SALE_PIECE_STARTS[SALE_PIECE_STARTS.length - 1] ?? null },
];

const STATES: { key: LandSaleState; label: string }[] = [
  { key: 'sold', label: 'Sold' },
  { key: 'no_offers', label: 'No offers' },
  { key: 'upcoming', label: 'Upcoming' },
];

/**
 * The parcels the panel's filters keep: the statuses on, a buyer whose name holds the text, and
 * the period when it is chosen here and not by the request.
 */
export function saleFiltered(
  parcels: readonly LandSaleParcel[],
  filters: {
    buyer: string;
    states: ReadonlySet<LandSaleState>;
    today: string;
    /** Sales from this date on (YYYY-MM-DD), when the parcels of every year are held. */
    since?: string | null;
    /** And sales before this date: one sale is its day to the day after (F-267). */
    until?: string | null;
  },
): LandSaleParcel[] {
  const text = filters.buyer.trim().toLowerCase();
  const since = filters.since ?? null;
  const until = filters.until ?? null;
  return parcels.filter(
    (p) =>
      (since === null || p.saleDate >= since) &&
      (until === null || p.saleDate < until) &&
      filters.states.has(landSaleState(p, filters.today)) &&
      (text === '' || (p.buyers ?? '').toLowerCase().includes(text)),
  );
}

/** `366012345.67` as `$366.0M`, `56888.32` as `$56.9K`, `35.88` as `$36`: for reading, not sums. */
export function saleMoney(text: string | null): string {
  const n = text === null ? Number.NaN : Number(text);
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toLocaleString('en-CA', { maximumFractionDigits: 0 })}`;
}

/** Dollars to the cent, as published: `$2,296.32`. */
export function saleExact(text: string): string {
  const [whole = '0', cents] = text.split('.');
  return `$${Number(whole).toLocaleString('en-CA')}${cents ? `.${cents}` : ''}`;
}

/** `643210.5` as `643K ha`, `256` as `256 ha`. */
export function saleHectares(text: string | null): string {
  const n = text === null ? Number.NaN : Number(text);
  if (!Number.isFinite(n)) return '—';
  return n >= 1e4
    ? `${(n / 1e3).toFixed(0)}K ha`
    : `${n.toLocaleString('en-CA', { maximumFractionDigits: 1 })} ha`;
}

interface ParcelsAnswer {
  source: {
    name: string;
    loadedAt: string | null;
    firstSale: string | null;
    lastSale: string | null;
  };
  truncated: boolean;
  /** The documents of the sales these parcels belong to, by sale date (F-265). */
  documents?: Record<string, LandSaleDocuments>;
  parcels: LandSaleParcel[];
}

interface SummaryAnswer {
  offered: number;
  sold: number;
  bonus: string;
  hectaresSold: string;
  averagePerHectare: string | null;
  highPerHectare: string | null;
  nextSale: { date: string; parcels: number } | null;
  /** Every sale the rights keep a parcel of, the newest first (F-267). */
  sales?: { date: string; parcels: number; sold: number; held: boolean }[];
  quarters: { quarter: string; bonus: string; sold: number }[];
}

interface Settled {
  key: string;
  filter: string;
  asked: Bbox;
  /** How many of SALE_PIECES the answer holds, when a play's parcels are read whole. */
  pieces: number;
  answer: ParcelsAnswer | null;
  failed: boolean;
}

const ALBERTA: Bbox = { west: -120.1, south: 48.9, east: -109.9, north: 60.1 };
const inside = (asked: Bbox, view: Bbox) =>
  Math.max(ALBERTA.west, view.west) >= asked.west &&
  Math.min(ALBERTA.east, view.east) <= asked.east &&
  Math.max(ALBERTA.south, view.south) >= asked.south &&
  Math.min(ALBERTA.north, view.north) <= asked.north;

const round = (n: number) => Math.round(n * 1e4) / 1e4;
const LABEL = SIDE_LABEL;
const ALL_STATES: readonly LandSaleState[] = ['sold', 'no_offers', 'upcoming'];
const NONE: readonly string[] = [];
const NO_DOCUMENTS: Readonly<Record<string, LandSaleDocuments>> = {};

export interface LandSalesState {
  view: LandSalesView | null;
  onViewChange: (bbox: Bbox | null, zoom: number) => void;
  /** The parcels whose card is open, drawn with a bold outline. */
  setPicked: (keys: readonly string[]) => void;
  /** The parcels shown, by their id: for the box at the pointer and the panel (F-265). */
  parcels: ReadonlyMap<string, LandSaleParcel>;
  /** Each sale's notice and results on the department's site, by sale date. */
  documents: Readonly<Record<string, LandSaleDocuments>>;
  /** The play the parcels' rights must include; null for every parcel. */
  rights: string | null;
  /** The next sale not held yet and the last one held, of the rights chosen (F-267). */
  nextSale: { date: string; parcels: number } | null;
  lastSale: { date: string; sold: number } | null;
  /** Shows one sale alone and moves the map to its parcels, when they are held. */
  showSale: (date: string, goTo: (bounds: MapBounds) => void) => void;
  /** Shows a play's sales of the last 12 months. */
  showPastYear: (rights: string) => void;
  /** When the sales were last loaded; null before an answer. */
  updated: string | null;
  /**
   * Every setting of the section as it is now, and a way to set some of them (F-254). One sale
   * alone is kept as its date, so Undo brings that sale back.
   */
  settings: LandSalesSnapshot;
  apply: (settings: LandSalesSnapshot, goTo: (bounds: MapBounds) => void) => void;
  section: (props: {
    open: boolean;
    onToggle: () => void;
    goTo: (bounds: MapBounds) => void;
  }) => React.ReactNode;
  /** What the parcels' colours mean; null when the sales are off. */
  legend: () => React.ReactNode;
  /** What the section shows and where it comes from, for Sources & licence. */
  about: () => React.ReactNode;
}

/** The section's settings, with one sale alone named by its date as well as next or last. */
export type LandSalesSnapshot = NonNullable<MapSettings['sales']> & {
  saleDate?: string;
  /** A year or dates chosen in the panel (F-303); not among the Ask bar's settings. */
  saleRange?: SaleRange;
};

export function useLandSales(organizationId: string, token: string): LandSalesState {
  // Off when the map opens (F-284); Jump to and its section's switch turn it on.
  const [on, setOn] = useState(false);
  const [rights, setRights] = useState<string | null>('duvernay');
  const [when, setWhen] = useState<SaleWhen>('2');
  const [buyer, setBuyer] = useState('');
  const [states, setStates] = useState<ReadonlySet<LandSaleState>>(
    new Set<LandSaleState>(ALL_STATES),
  );
  const [at, setAt] = useState<{ view: Bbox; zoom: number } | null>(null);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [summary, setSummary] = useState<{
    key: string;
    rights: string | null;
    answer: SummaryAnswer | null;
  } | null>(null);
  const [picked, setPicked] = useState<readonly string[]>(NONE);
  const today = useMemo(() => landToday(), []);
  // One sale alone is its day to the day after (F-267).
  const oneSale = typeof when === 'object' && 'sale' in when ? when.sale : null;
  // A year or dates chosen (F-303): to the day after the last day, so it is included.
  const range = typeof when === 'object' && !('sale' in when) ? when : null;
  const { since, until } = saleWindow(when, today);
  // With a play's rights every parcel is asked for once, whatever the view and the period, and
  // kept: zooming, moving and choosing a period then ask for nothing (F-263). They come in
  // pieces, the newest sales first. Without a play the parcels are too many to hold: those of
  // the view and the period, close in, as before.
  const whole = rights !== null;
  const filter = whole ? `${rights}|` : `|${since ?? ''}|${until ?? ''}`;
  const summaryFilter = `${rights ?? ''}|${since ?? ''}|${until ?? ''}`;

  const far = at !== null && at.zoom < saleFromZoom(rights);
  const wanted = on && (whole || (at !== null && !far));
  // The piece to read next, of a play's parcels.
  const piece = whole && settled?.filter === filter ? settled.pieces : 0;
  const covered =
    settled !== null &&
    !settled.failed &&
    settled.filter === filter &&
    settled.answer !== null &&
    (whole
      ? piece >= SALE_PIECES.length
      : !settled.answer.truncated && at !== null && inside(settled.asked, at.view));
  const box = !wanted || covered ? null : whole ? ALBERTA : at ? landRequest(at.view) : null;
  // A piece that failed is asked for again when the map next moves.
  const again =
    whole && settled?.failed === true && at
      ? `@${String(round(at.view.west))},${String(round(at.view.south))},${String(round(at.zoom))}`
      : '';
  const key = box
    ? `${filter}:${whole ? `piece ${String(piece)}` : ''}${String(round(box.west))},${String(round(box.south))},${String(round(box.east))},${String(round(box.north))}${again}`
    : null;
  const loading = key !== null && settled?.key !== key;
  const failed = settled?.failed === true && settled.key === key;

  const query = useCallback(
    (extra: Record<string, string> = {}) => {
      const q = new URLSearchParams({ organization_id: organizationId, ...extra });
      if (rights !== null) q.set('rights', rights);
      if (since !== null) q.set('since', since);
      if (until !== null) q.set('until', until);
      return q.toString();
    },
    [organizationId, rights, since, until],
  );

  useEffect(() => {
    if (key === null || box === null) return;
    const controller = new AbortController();
    const q = new URLSearchParams(
      query({
        west: String(round(box.west)),
        south: String(round(box.south)),
        east: String(round(box.east)),
        north: String(round(box.north)),
      }),
    );
    // Every year of them, a piece at a time: the period is then chosen here, from what is held.
    const years = whole ? SALE_PIECES[piece] : undefined;
    if (years) {
      q.delete('since');
      q.delete('until');
      if (years.since !== null) q.set('since', years.since);
      if (years.until !== null) q.set('until', years.until);
    }
    apiJson<ParcelsAnswer>(`/petroleum/land-sales?${q.toString()}`, token, {
      signal: controller.signal,
    })
      .then((answer) => {
        setSettled((before) => {
          // A later piece joins the ones already held; anything else stands alone.
          const earlier = years && piece > 0 && before?.filter === filter ? before.answer : null;
          return {
            key,
            filter,
            asked: box,
            pieces: years ? piece + 1 : 0,
            answer: earlier
              ? {
                  ...answer,
                  truncated: earlier.truncated || answer.truncated,
                  documents: { ...earlier.documents, ...answer.documents },
                  parcels: [...earlier.parcels, ...answer.parcels],
                }
              : answer,
            failed: false,
          };
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setSettled((before) => ({
          key,
          filter: before?.filter ?? '',
          asked: box,
          pieces: before?.pieces ?? 0,
          answer: before?.answer ?? null,
          failed: true,
        }));
      });
    return () => {
      controller.abort();
    };
    // `box` and the filter are described by `key`; asking again for the same would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, token]);

  // The totals and the history by quarter: of every parcel loaded, not of the view. Asked for
  // also while the section is off, so the Jump to buttons know the next and the last sale.
  useEffect(() => {
    const controller = new AbortController();
    apiJson<SummaryAnswer>(`/petroleum/land-sales/summary?${query()}`, token, {
      signal: controller.signal,
    })
      .then((answer) => {
        setSummary({ key: summaryFilter, rights, answer });
      })
      .catch(() => {
        if (!controller.signal.aborted) setSummary({ key: summaryFilter, rights, answer: null });
      });
    return () => {
      controller.abort();
    };
    // `rights` is part of `summaryFilter`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryFilter, query, token]);

  const answer = settled?.answer ?? null;
  const shown = useMemo(
    () =>
      wanted && settled?.filter === filter
        ? saleFiltered(answer?.parcels ?? [], {
            buyer,
            states,
            today,
            since: whole ? since : null,
            until: whole ? until : null,
          })
        : [],
    [wanted, settled?.filter, filter, answer, buyer, states, today, whole, since, until],
  );
  const features = useMemo(() => landSaleFeatures(shown, today), [shown, today]);
  const byId = useMemo(() => new Map(shown.map((p) => [p.id, p])), [shown]);
  const documents = answer?.documents ?? NO_DOCUMENTS;
  const view = useMemo<LandSalesView | null>(
    () => (on ? { parcels: features, picked } : null),
    [on, features, picked],
  );
  const onViewChange = useCallback((bbox: Bbox | null, zoom: number) => {
    setAt(bbox ? { view: bbox, zoom } : null);
  }, []);

  const totals = summary?.key === summaryFilter ? summary.answer : null;
  // The sales themselves do not change with the dates asked for: kept while the totals of
  // another period are on their way, so the Jump to buttons and the list of sales stay.
  const known = summary?.rights === rights ? summary.answer : null;
  const nextSale = known?.nextSale ?? null;
  const allSales = useMemo(() => known?.sales ?? [], [known]);
  const lastHeld = allSales.find((sale) => sale.held) ?? null;
  const lastSale = useMemo(
    () => (lastHeld ? { date: lastHeld.date, sold: lastHeld.sold } : null),
    [lastHeld],
  );
  const inPeriod = allSales.filter(
    (sale) => (since === null || sale.date >= since) && (until === null || sale.date < until),
  ).length;
  const rightsName = rights !== null ? (LAND_RIGHTS[rights]?.name ?? rights) : null;
  // A play's sales are those inside its outline, when the map has one for it (F-264).
  const outlined = rights !== null && Object.hasOwn(ST37_OUTLINES, rights);
  const periodTitle =
    oneSale !== null
      ? `sale of ${saleDay(oneSale, true)}`
      : range !== null
        ? saleRangeTitle(range)
        : (SALE_PERIODS.find((p) => p.key === when)?.title ?? '');
  // The years with a sale, newest first, for the Year list (F-303).
  const saleYears = [...new Set(allSales.map((sale) => Number(sale.date.slice(0, 4))))].sort(
    (a, b) => b - a,
  );
  const rangeYear = range !== null ? saleRangeYear(range) : null;
  // A date typed in From or To: the other side kept, an empty box no limit.
  const setRange = (next: SaleRange) => {
    setWhen(next.from === null && next.to === null ? 'all' : next);
  };
  const held = settled?.filter === filter ? answer : null;

  const showSale = (date: string, goTo: (bounds: MapBounds) => void) => {
    setOn(true);
    setWhen({ sale: date });
    // The map moves to the sale's parcels when they are among those held.
    const box = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
    for (const p of held?.parcels ?? []) {
      if (p.saleDate !== date) continue;
      const b = landBounds(p.shape);
      box.west = Math.min(box.west, b.west);
      box.south = Math.min(box.south, b.south);
      box.east = Math.max(box.east, b.east);
      box.north = Math.max(box.north, b.north);
    }
    if (box.west < box.east && box.south < box.north) {
      goTo([box.west, box.south, box.east, box.north]);
    }
  };
  const showPastYear = (play: string) => {
    setOn(true);
    setRights(play);
    setWhen('1');
  };

  const settings: LandSalesSnapshot = {
    on,
    rights: rights === null || Object.hasOwn(LAND_RIGHTS, rights) ? rights : null,
    ...(oneSale !== null
      ? { saleDate: oneSale }
      : range !== null
        ? { saleRange: range }
        : { period: when as SalePeriod }),
    buyer,
    states: ALL_STATES.filter((state) => states.has(state)),
  };
  const apply = (next: LandSalesSnapshot, goTo: (bounds: MapBounds) => void) => {
    if (next.on !== undefined) setOn(next.on);
    if (next.rights !== undefined) setRights(next.rights);
    if (next.period !== undefined) setWhen(next.period);
    if (next.saleRange !== undefined) setWhen(next.saleRange);
    if (next.buyer !== undefined) setBuyer(next.buyer);
    if (next.states) setStates(new Set(next.states));
    const date =
      next.saleDate ??
      (next.sale === 'next' ? nextSale?.date : next.sale === 'last' ? lastSale?.date : undefined);
    if (date) showSale(date, goTo);
  };

  const section = ({
    open,
    onToggle,
    goTo,
  }: {
    open: boolean;
    onToggle: () => void;
    goTo: (bounds: MapBounds) => void;
  }) => (
    <MapSection
      title="Land sales"
      open={open}
      onToggle={onToggle}
      on={on}
      onSwitch={setOn}
      chip={rightsName}
      onClearChip={() => {
        setRights(null);
      }}
      sample={
        <span aria-hidden="true" className="flex h-2.5 w-7 shrink-0 overflow-hidden rounded-sm">
          {SALE_BLUES.filter((_, i) => i % 2 === 0).map((colour) => (
            <span key={colour} className="grow" style={{ backgroundColor: colour }} />
          ))}
        </span>
      }
    >
      <div className="flex flex-col gap-1.5">
        <p className={LABEL}>When</p>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="When">
          <FilterChip
            plain
            disabled={nextSale === null}
            pressed={oneSale !== null && oneSale === nextSale?.date}
            onClick={() => {
              if (nextSale) showSale(nextSale.date, goTo);
            }}
          >
            Next sale
          </FilterChip>
          <FilterChip
            plain
            disabled={lastSale === null}
            pressed={oneSale !== null && oneSale === lastSale?.date}
            onClick={() => {
              if (lastSale) showSale(lastSale.date, goTo);
            }}
          >
            Last sale
          </FilterChip>
          <select
            aria-label="Pick a sale"
            className="h-8 max-w-[8.5rem] rounded-md border bg-card px-2 text-[0.8125rem] font-medium"
            value={oneSale ?? ''}
            onChange={(event) => {
              if (event.target.value !== '') showSale(event.target.value, goTo);
            }}
          >
            <option value="">Pick a sale</option>
            {allSales.map((sale) => (
              <option key={sale.date} value={sale.date}>
                {saleDay(sale.date, true)}
              </option>
            ))}
          </select>
          {SALE_PERIODS.map((p) => (
            <FilterChip
              key={p.key}
              plain
              pressed={when === p.key}
              onClick={() => {
                setWhen(p.key);
              }}
            >
              {p.label}
            </FilterChip>
          ))}
        </div>
        {/* A year, or dates from and to, both included (the owner, 2026-11-24, F-303). */}
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            aria-label="Sale year"
            className="h-8 rounded-md border bg-card px-2 text-[0.8125rem] font-medium"
            value={rangeYear ?? ''}
            onChange={(event) => {
              if (event.target.value !== '') setWhen(saleYear(Number(event.target.value)));
            }}
          >
            <option value="">Year</option>
            {saleYears.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
          <input
            type="date"
            aria-label="Sales from"
            className="h-8 min-w-0 flex-1 rounded-md border bg-card px-2 text-[0.8125rem]"
            value={range?.from ?? ''}
            max={range?.to ?? undefined}
            onChange={(event) => {
              setRange({ from: event.target.value || null, to: range?.to ?? null });
            }}
          />
          <span className="text-xs text-muted-foreground">to</span>
          <input
            type="date"
            aria-label="Sales to"
            className="h-8 min-w-0 flex-1 rounded-md border bg-card px-2 text-[0.8125rem]"
            value={range?.to ?? ''}
            min={range?.from ?? undefined}
            onChange={(event) => {
              setRange({ from: range?.from ?? null, to: event.target.value || null });
            }}
          />
        </div>
      </div>
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
          <span className={LABEL}>Buyer</span>
          <input
            type="search"
            className={SIDE_INPUT}
            placeholder="Any buyer"
            value={buyer}
            onChange={(event) => {
              setBuyer(event.target.value);
            }}
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        {outlined
          ? `Parcels whose rights include it, inside the ${rightsName ?? ''} outline (shown under Formations).`
          : rightsName
            ? `Parcels whose rights include the ${rightsName}, in the area loaded.`
            : 'Every parcel in the area loaded: zoom in to see them.'}
      </p>
      <div className="rounded-lg border bg-card px-3 py-2.5">
        <p className={LABEL}>Bonus paid · {periodTitle}</p>
        <p className="font-mono text-3xl font-semibold tabular-nums">
          {totals ? saleMoney(totals.bonus) : '…'}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <Tile
          label="Parcels sold"
          value={totals ? totals.sold.toLocaleString('en-CA') : '…'}
          note={totals ? `of ${totals.offered.toLocaleString('en-CA')} offered` : ''}
        />
        <Tile label="Hectares sold" value={totals ? saleHectares(totals.hectaresSold) : '…'} />
        <Tile
          label="Average"
          value={totals ? `${saleMoney(totals.averagePerHectare)}/ha` : '…'}
          note={totals?.highPerHectare ? `high ${saleMoney(totals.highPerHectare)}/ha` : ''}
        />
      </div>
      {known && known.quarters.length > 0 && (
        <Fold
          label="Chart"
          note={`${since !== null ? saleDay(since, true) : (known.quarters[0]?.quarter.slice(0, 4) ?? '')}${oneSale !== null ? '' : ' – latest'}`}
        >
          <p className={LABEL}>
            Bonus by quarter · {known.quarters[0]?.quarter.slice(0, 4)} to{' '}
            {known.quarters[known.quarters.length - 1]?.quarter.slice(0, 4)}
          </p>
          <QuarterBars quarters={known.quarters} since={since} />
        </Fold>
      )}
      <div className="flex items-center justify-between border-t pt-2.5">
        <span className={`${LABEL} text-foreground/80`}>Sales in period</span>
        <span className="font-mono text-[0.6875rem] text-muted-foreground">
          {known
            ? `${inPeriod.toLocaleString('en-CA')} ${inPeriod === 1 ? 'sale date' : 'sale dates'}`
            : '…'}
        </span>
      </div>
      <div className="relative">
        <Fold label="More filters">
          <div className="flex items-start gap-2">
            <span className={`${LABEL} pt-2`}>Status</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sale status">
              {STATES.map(({ key: state, label }) => (
                <FilterChip
                  key={state}
                  pressed={states.has(state)}
                  onClick={() => {
                    setStates((before) => {
                      const next = new Set(before);
                      if (next.has(state)) next.delete(state);
                      else next.add(state);
                      return next;
                    });
                  }}
                >
                  {label}
                </FilterChip>
              ))}
            </div>
          </div>
        </Fold>
        <button
          type="button"
          onClick={() => {
            setBuyer('');
            setStates(new Set<LandSaleState>(ALL_STATES));
          }}
          className="absolute top-2 right-0 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Clear all
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        {far
          ? 'Zoom in to see the parcels.'
          : `${shown.length.toLocaleString('en-CA')} ${shown.length === 1 ? 'parcel' : 'parcels'}${whole ? '' : ' in view'}.`}
        {loading ? ' Loading…' : ''}
      </p>
      {failed && (
        <p className="text-xs text-destructive">
          The parcels could not be loaded. Move the map to try again.
        </p>
      )}
      {!far && answer?.truncated && (
        <p className="text-xs text-muted-foreground">
          More parcels than can be drawn at once here: the newest sales are shown. Zoom in, or
          choose a shorter period, to see every one.
        </p>
      )}
    </MapSection>
  );

  const about = () => (
    <>
      <p>
        <strong className="font-medium text-foreground">Land sales.</strong> The Crown’s public
        offerings of petroleum and natural gas rights: each sale’s parcels from its notice, and
        their results once the sale is held (status, bonus, price per hectare, buyers), as
        published. A buyer is often a land broker bidding for someone else. The totals are of every
        parcel loaded that the rights and the period keep, not of the map’s view; the bonus by
        quarter covers every year. With a play chosen, the parcels and the totals are those inside
        the play’s outline: a parcel counts when the middle of its land lies within it.
      </p>
      <p>
        A parcel’s shape is its land placed on the province’s township grid; quarters and legal
        subdivisions are an even division of their section, so an edge can be a few metres off.
        Corrections and withdrawals published after a notice are not applied yet: a withdrawn parcel
        can still show as upcoming until its sale has results. Rights include: read from the
        parcel’s rights as for the agreements (Land today, below).
      </p>
      <p>
        {answer?.source.loadedAt
          ? `${answer.source.name}; sales of ${answer.source.firstSale ?? ''} to ${answer.source.lastSale ?? ''}, loaded ${formatAlberta(answer.source.loadedAt, { weekday: false })}, for the Duvernay's area only so far. Not an official record.`
          : 'Alberta Energy and Minerals, Government of Alberta, public offerings of petroleum and natural gas rights.'}
      </p>
    </>
  );

  const legend = () =>
    !on ? null : (
      <div role="group" aria-label="Land sales legend">
        <LegendTitle>Bonus per hectare</LegendTitle>
        <div className="mt-2 flex h-2 overflow-hidden rounded-sm" aria-hidden="true">
          {SALE_BLUES.map((colour) => (
            <span key={colour} className="grow" style={{ backgroundColor: colour }} />
          ))}
        </div>
        <div className="mt-1 flex text-[0.625rem] text-muted-foreground tabular-nums">
          <span className="grow" />
          {SALE_STEPS.map((step) => (
            <span key={step} className="grow basis-0 text-center">
              ${step}
            </span>
          ))}
          <span className="grow-[0.5]" />
        </div>
        <ul className="mt-2 flex flex-col gap-1">
          <li className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block size-3 rounded-[2px]"
              style={{ backgroundColor: SALE_NO_OFFERS }}
            />
            No offers / not sold
          </li>
          <li className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block size-3 rounded-[2px] border border-dashed"
              style={{ borderColor: SALE_UPCOMING, backgroundColor: `${SALE_UPCOMING}40` }}
            />
            Upcoming sale
          </li>
        </ul>
      </div>
    );

  return {
    view,
    onViewChange,
    setPicked,
    parcels: byId,
    documents,
    rights,
    nextSale,
    lastSale,
    showSale,
    showPastYear,
    updated: answer?.source.loadedAt ?? null,
    settings,
    apply,
    section,
    legend,
    about,
  };
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-md border bg-card px-2 py-1.5">
      <p className="truncate text-[0.625rem] font-medium tracking-wider text-muted-foreground uppercase">
        {label}
      </p>
      <p className="font-mono text-sm font-semibold tabular-nums">{value}</p>
      {note && <p className="truncate text-[0.625rem] text-muted-foreground">{note}</p>}
    </div>
  );
}

/** The bonus paid in each quarter as bars; the quarters of the period chosen are darker. */
export function QuarterBars({
  quarters,
  since,
}: {
  quarters: readonly { quarter: string; bonus: string; sold: number }[];
  since: string | null;
}) {
  const first = Number(quarters[0]?.quarter.slice(0, 4));
  const last = Number(quarters[quarters.length - 1]?.quarter.slice(0, 4));
  const slots = (last - first + 1) * 4;
  const max = Math.max(...quarters.map((q) => Number(q.bonus)), 1);
  const width = 264;
  const height = 56;
  const sinceQuarter = since
    ? `${since.slice(0, 4)}-Q${String(Math.floor((Number(since.slice(5, 7)) - 1) / 3) + 1)}`
    : null;
  return (
    <svg
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      className="mt-1 w-full"
      role="img"
      aria-label={`Bonus paid by quarter, ${String(first)} to ${String(last)}; the highest quarter ${saleMoney(String(max))}`}
    >
      {quarters.map((q) => {
        const slot = (Number(q.quarter.slice(0, 4)) - first) * 4 + Number(q.quarter.slice(6)) - 1;
        const h = Math.max(1, (Number(q.bonus) / max) * (height - 2));
        const inPeriod = sinceQuarter === null || q.quarter >= sinceQuarter;
        return (
          <rect
            key={q.quarter}
            x={(slot / slots) * width}
            y={height - h}
            width={Math.max(1, width / slots - 0.6)}
            height={h}
            fill={inPeriod ? '#2c68bd' : '#bcd5f4'}
          >
            <title>{`${q.quarter}: ${saleMoney(q.bonus)}, ${String(q.sold)} sold`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
