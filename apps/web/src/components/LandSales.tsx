import { formatAlberta, LAND_RIGHTS, type Bbox } from '@grain/domain';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { apiJson } from '../lib/api';
import {
  landSaleFeatures,
  landSaleState,
  SALE_BLUES,
  SALE_NO_OFFERS,
  SALE_STEPS,
  SALE_UPCOMING,
  type LandSaleParcel,
  type LandSaleState,
  type LandSalesView,
} from '../lib/landSalesMap';
import { landReadable, landRequest, landToday } from './Land';

/**
 * Crown land sales on the oil and gas map (F-242): a "Land sales" panel (the next sale, the
 * rights and buyer asked for, the bonus paid over a period with its totals and its history by
 * quarter, the statuses shown), a legend of the bonus per hectare, and a parcel's lines on the
 * card of the land clicked. Data from Alberta Energy and Minerals, named wherever it is shown
 * (docs/DECISIONS.md, 2026-11-21). Every figure is the province's own or a sum of them made by
 * the database; nothing is estimated.
 */

/** The periods the panel offers, as years back from today; null for every year loaded. */
export const SALE_PERIODS = [
  { key: 'all', label: 'All years', years: null },
  { key: '1', label: 'Last 12 mo', years: 1 },
  { key: '2', label: 'Last 2 yrs', years: 2 },
  { key: '5', label: 'Last 5 yrs', years: 5 },
] as const;
export type SalePeriod = (typeof SALE_PERIODS)[number]['key'];

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
  },
): LandSaleParcel[] {
  const text = filters.buyer.trim().toLowerCase();
  const since = filters.since ?? null;
  return parcels.filter(
    (p) =>
      (since === null || p.saleDate >= since) &&
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
function saleExact(text: string): string {
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
const LABEL = 'text-[0.6875rem] font-medium tracking-wider text-muted-foreground uppercase';
const NONE: readonly string[] = [];

export interface LandSalesState {
  view: LandSalesView | null;
  onViewChange: (bbox: Bbox | null, zoom: number) => void;
  /** The parcels whose card is open, drawn with a bold outline. */
  setPicked: (keys: readonly string[]) => void;
  /** A clicked parcel's lines for the land card; null when it is not one loaded. */
  cardRow: (id: string) => React.ReactNode;
  panel: () => React.ReactNode;
  legend: () => React.ReactNode;
}

export function useLandSales(organizationId: string, token: string): LandSalesState {
  const [on, setOn] = useState(true);
  const [open, setOpen] = useState(true);
  const [rights, setRights] = useState<string | null>('duvernay');
  const [period, setPeriod] = useState<SalePeriod>('2');
  const [buyer, setBuyer] = useState('');
  const [states, setStates] = useState<ReadonlySet<LandSaleState>>(
    new Set<LandSaleState>(['sold', 'no_offers', 'upcoming']),
  );
  const [at, setAt] = useState<{ view: Bbox; zoom: number } | null>(null);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [summary, setSummary] = useState<{ key: string; answer: SummaryAnswer | null } | null>(
    null,
  );
  const [picked, setPicked] = useState<readonly string[]>(NONE);
  const today = useMemo(() => landToday(), []);
  const since = saleSince(period, today);
  // With a play's rights every parcel is asked for once, whatever the view and the period, and
  // kept: zooming, moving and choosing a period then ask for nothing (F-263). They come in
  // pieces, the newest sales first. Without a play the parcels are too many to hold: those of
  // the view and the period, close in, as before.
  const whole = rights !== null;
  const filter = whole ? `${rights}|` : `|${since ?? ''}`;
  const summaryFilter = `${rights ?? ''}|${since ?? ''}`;

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
      return q.toString();
    },
    [organizationId, rights, since],
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

  // The totals and the history by quarter: of every parcel loaded, not of the view.
  useEffect(() => {
    if (!on) return;
    const controller = new AbortController();
    apiJson<SummaryAnswer>(`/petroleum/land-sales/summary?${query()}`, token, {
      signal: controller.signal,
    })
      .then((answer) => {
        setSummary({ key: summaryFilter, answer });
      })
      .catch(() => {
        if (!controller.signal.aborted) setSummary({ key: summaryFilter, answer: null });
      });
    return () => {
      controller.abort();
    };
  }, [on, summaryFilter, query, token]);

  const answer = settled?.answer ?? null;
  const shown = useMemo(
    () =>
      wanted && settled?.filter === filter
        ? saleFiltered(answer?.parcels ?? [], {
            buyer,
            states,
            today,
            since: whole ? since : null,
          })
        : [],
    [wanted, settled?.filter, filter, answer, buyer, states, today, whole, since],
  );
  const features = useMemo(() => landSaleFeatures(shown, today), [shown, today]);
  const byId = useMemo(() => new Map(shown.map((p) => [p.id, p])), [shown]);
  const view = useMemo<LandSalesView | null>(
    () => (on ? { parcels: features, picked } : null),
    [on, features, picked],
  );
  const onViewChange = useCallback((bbox: Bbox | null, zoom: number) => {
    setAt(bbox ? { view: bbox, zoom } : null);
  }, []);

  const totals = summary?.key === summaryFilter ? summary.answer : null;
  const rightsName = rights !== null ? (LAND_RIGHTS[rights]?.name ?? rights) : null;
  const periodLabel = SALE_PERIODS.find((p) => p.key === period)?.label.toLowerCase() ?? '';

  const cardRow = (id: string) => {
    const p = byId.get(id);
    if (!p) return null;
    const state = landSaleState(p, today);
    return (
      <li key={`sale:${id}`}>
        <p className="font-semibold">
          Sale of {p.saleDate} · {p.contractType === 'LICENCE' ? 'Licence' : 'Lease'} {p.contractNo}
        </p>
        <p>
          {state === 'upcoming'
            ? 'Upcoming sale: not sold yet'
            : state === 'sold'
              ? `Sold${p.bonus ? ` for ${saleExact(p.bonus)}` : ''}${
                  p.dollarsPerHectare ? ` (${saleExact(p.dollarsPerHectare)}/ha)` : ''
                }`
              : p.status === 'NO OFFERS'
                ? 'No offers'
                : p.status === null
                  ? 'No result published for this parcel'
                  : `Not sold: ${p.status}`}
        </p>
        {p.buyers && (
          <p className="text-xs text-muted-foreground">Buyer: {landReadable(p.buyers)}</p>
        )}
        <p className="text-xs text-muted-foreground">
          {[
            p.hectares !== null ? saleHectares(p.hectares) : null,
            p.region && landReadable(p.region),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {p.zone && <p className="text-xs text-muted-foreground">{p.zone}</p>}
        {p.inexact && (
          <p className="text-xs text-muted-foreground">
            The shape is not exact: part of this parcel is a portion of its land, or lies outside
            the area loaded.
          </p>
        )}
      </li>
    );
  };

  const panel = () => (
    <div
      className="flex w-72 flex-col gap-2.5 rounded-card border bg-card/95 p-3 shadow-xs"
      role="group"
      aria-label="Land sales"
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
          Land sales
        </button>
        {rightsName && on && (
          <span className="rounded-full bg-foreground px-2 py-0.5 text-xs font-medium text-background">
            {rightsName}
          </span>
        )}
        <input
          type="checkbox"
          aria-label="Land sales"
          checked={on}
          onChange={(event) => {
            setOn(event.target.checked);
          }}
        />
      </div>
      {open && on && (
        <>
          {totals?.nextSale && (
            <p className="rounded-md border border-[#e2622f]/40 bg-[#e2622f]/10 px-2.5 py-1.5 text-sm">
              <span className="font-semibold">Next sale {totals.nextSale.date}</span>
              <span className="block text-xs text-muted-foreground">
                {totals.nextSale.parcels.toLocaleString('en-CA')}{' '}
                {totals.nextSale.parcels === 1 ? 'parcel' : 'parcels'} posted
                {rightsName ? ` with ${rightsName} rights` : ''} in the area loaded
              </span>
            </p>
          )}
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
              <span className={LABEL}>Buyer</span>
              <input
                type="search"
                className="h-8 rounded-md border bg-card px-2 text-sm"
                placeholder="Any buyer"
                value={buyer}
                onChange={(event) => {
                  setBuyer(event.target.value);
                }}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Period">
            {SALE_PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={period === p.key}
                onClick={() => {
                  setPeriod(p.key);
                }}
                className="rounded-md px-2 py-1 text-xs hover:bg-muted aria-pressed:bg-foreground aria-pressed:font-medium aria-pressed:text-background"
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="rounded-md border bg-card px-2.5 py-2">
            <p className={LABEL}>Bonus paid · {periodLabel}</p>
            <p className="font-mono text-2xl font-semibold tabular-nums">
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
          {totals && totals.quarters.length > 0 && (
            <div>
              <p className={LABEL}>
                Bonus by quarter · {totals.quarters[0]?.quarter.slice(0, 4)} to{' '}
                {totals.quarters[totals.quarters.length - 1]?.quarter.slice(0, 4)}
              </p>
              <QuarterBars quarters={totals.quarters} since={since} />
            </div>
          )}
          <div className="flex items-start gap-2">
            <span className={`${LABEL} pt-1.5`}>Status</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sale status">
              {STATES.map(({ key: state, label }) => (
                <button
                  key={state}
                  type="button"
                  aria-pressed={states.has(state)}
                  onClick={() => {
                    setStates((before) => {
                      const next = new Set(before);
                      if (next.has(state)) next.delete(state);
                      else next.add(state);
                      return next;
                    });
                  }}
                  className="rounded-md border bg-card px-2 py-1 text-xs hover:bg-muted aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background"
                >
                  {label}
                </button>
              ))}
            </div>
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
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none hover:text-foreground">
              About this data
            </summary>
            <div className="mt-1.5 flex flex-col gap-1.5">
              <p>
                The Crown’s public offerings of petroleum and natural gas rights: each sale’s
                parcels from its notice, and their results once the sale is held (status, bonus,
                price per hectare, buyers), as published. A buyer is often a land broker bidding for
                someone else. The totals are of every parcel loaded that the rights and the period
                keep, not of the map’s view; the bonus by quarter covers every year.
              </p>
              <p>
                A parcel’s shape is its land placed on the province’s township grid; quarters and
                legal subdivisions are an even division of their section, so an edge can be a few
                metres off. Corrections and withdrawals published after a notice are not applied
                yet: a withdrawn parcel can still show as upcoming until its sale has results.
                Rights include: read from the parcel’s rights as for the agreements (Land today,
                About this data).
              </p>
              <p>
                {answer?.source.loadedAt
                  ? `${answer.source.name}; sales of ${answer.source.firstSale ?? ''} to ${answer.source.lastSale ?? ''}, loaded ${formatAlberta(answer.source.loadedAt, { weekday: false })}, for the area of the Duvernay's wells only so far. Not an official record.`
                  : 'Alberta Energy and Minerals, Government of Alberta, public offerings of petroleum and natural gas rights.'}
              </p>
            </div>
          </details>
        </>
      )}
    </div>
  );

  const legend = () =>
    !on ? null : (
      <div
        className="w-64 rounded-card border bg-card/95 p-3 text-xs shadow-xs"
        role="group"
        aria-label="Land sales legend"
      >
        <p className={LABEL}>Bonus per hectare</p>
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

  return { view, onViewChange, setPicked, cardRow, panel, legend };
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
