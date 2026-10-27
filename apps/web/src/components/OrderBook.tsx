import { ChevronDown, FlaskConical, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import type { FxRate } from '../data/types';
import { formatQuantityShort, formatSignedPrice, formatUtc } from '../lib/format';
import {
  displayStatus,
  largestQuantity,
  type BookQuote,
  type CommodityBook,
} from '../lib/orderBook';
import { cn } from '../lib/utils';
import { CadPrice } from './CadPrice';
import { QuoteStatusBadge } from './QuoteStatusBadge';
import { Badge } from './ui/badge';
import { Card } from './ui/card';

interface Selection {
  selectedId: string | null;
  onSelect: (facilityId: string) => void;
  now: Date;
}

// Asks (what sellers offer, what we buy at) on the left, bids (what buyers pay, what we sell
// at) on the right: the owner's reading order, from the seller to the new buyer.
const LADDER_COLUMNS = 'grid grid-cols-2 gap-2';

/** Quantity against the largest in the book, as a strip along the bottom of the cell. */
function DepthStrip({
  side,
  max,
  largest,
}: {
  side: 'OFFER' | 'BID';
  max: string;
  largest: string | null;
}) {
  // A display width only; no money is calculated here.
  const share = largest ? Math.min(100, (Number(max) / Number(largest)) * 100) : 0;
  return (
    <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1 bg-muted">
      <span
        className={cn(
          'absolute inset-y-0 left-0',
          side === 'OFFER' ? 'bg-offer-solid' : 'bg-bid-solid',
        )}
        style={{ width: `${String(share)}%` }}
      />
    </span>
  );
}

/** One ask or bid in the ladder: who, where, the price in CAD, status and size. */
function QuoteCell({
  entry,
  largest,
  selectedId,
  onSelect,
  now,
}: { entry: BookQuote; largest: string | null } & Selection) {
  const { facility, quote } = entry;
  const ask = quote.side === 'OFFER';
  return (
    <button
      type="button"
      aria-pressed={selectedId === facility.id}
      onClick={() => {
        onSelect(facility.id);
      }}
      className={cn(
        'relative flex min-w-0 flex-col gap-1 overflow-hidden rounded-control border px-2 pt-2 pb-3 text-left text-xs transition-colors aria-pressed:ring-2 aria-pressed:ring-ring',
        ask
          ? 'border-offer-border bg-offer-subtle hover:border-offer'
          : 'border-bid-border bg-bid-subtle hover:border-bid',
      )}
    >
      <span className="text-sm font-medium text-foreground">
        <span className="sr-only">{ask ? 'Ask: ' : 'Bid: '}</span>
        {facility.name}
      </span>
      <span className="text-muted-foreground">
        {facility.region} · {quote.deliveryBasis}
      </span>
      <CadPrice quote={quote} fx={entry.fx} className="text-sm font-semibold text-foreground" />
      <span className="flex flex-wrap items-center justify-between gap-1">
        <QuoteStatusBadge status={displayStatus(quote, now)} />
        <span className="text-muted-foreground tabular-nums">
          {formatQuantityShort(quote.quantityMt)}
        </span>
      </span>
      <DepthStrip side={quote.side} max={quote.quantityMt.max} largest={largest} />
    </button>
  );
}

function SpreadLine({ book }: { book: CommodityBook }) {
  const { spread } = book;
  if (spread.status === 'ok') {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        Gross spread{' '}
        <span className="font-mono font-semibold text-foreground tabular-nums">
          {formatSignedPrice(spread)}
        </span>
        {book.indicative && <Badge variant="caution">Indicative</Badge>}
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      {spread.status === 'missing'
        ? `No spread: no ${spread.side}`
        : spread.reason === 'UNIT_MISMATCH'
          ? 'No spread: the units differ'
          : 'No spread'}
    </p>
  );
}

/** Asks on the left and bids on the right, best first, level by level. */
function Ladder({
  book,
  largest,
  ...selection
}: { book: CommodityBook; largest: string | null } & Selection) {
  const levels = Math.max(book.asks.length, book.bids.length);
  return (
    <ol aria-label="Asks and bids" className="flex flex-col gap-2">
      {Array.from({ length: levels }, (_, level) => {
        const ask = book.asks[level];
        const bid = book.bids[level];
        return (
          <li key={level} className={LADDER_COLUMNS}>
            {ask ? <QuoteCell entry={ask} largest={largest} {...selection} /> : <span />}
            {bid ? <QuoteCell entry={bid} largest={largest} {...selection} /> : <span />}
          </li>
        );
      })}
    </ol>
  );
}

function CommoditySection({
  book,
  fx,
  ...selection
}: { book: CommodityBook; fx: FxRate | null } & Selection) {
  const largest = largestQuantity([book]);
  const live = book.asks.length + book.bids.length;
  const title = book.grade ? `${book.commodity} · ${book.grade}` : book.commodity;
  const noRate = book.outOfBook.some((entry) => entry.reason === 'FX_MISSING');
  return (
    <details open className="group border-b last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-semibold">{title}</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {live} live {live === 1 ? 'quote' : 'quotes'}
          <ChevronDown
            aria-hidden="true"
            className="size-4 transition-transform group-open:rotate-180"
          />
        </span>
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4">
        {live === 0 ? (
          <p className="text-xs text-muted-foreground">No live asks or bids.</p>
        ) : (
          <>
            <div role="group" aria-label="Spread" className="rounded-control bg-muted/60 p-2">
              <SpreadLine book={book} />
            </div>
            <div
              aria-hidden="true"
              className={cn(
                LADDER_COLUMNS,
                'text-2xs font-medium tracking-wider text-muted-foreground uppercase',
              )}
            >
              <span>Asks · sellers</span>
              <span>Bids · buyers</span>
            </div>
            <Ladder book={book} largest={largest} {...selection} />
          </>
        )}
        {noRate && (
          <p className="flex items-start gap-1.5 text-xs text-caution">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            USD quotes are left out of the book: there is no CAD/USD rate to convert them.
          </p>
        )}
        {book.outOfBook.length > 0 && (
          <div className="flex flex-col gap-1 text-xs">
            <p className="font-medium text-muted-foreground">Not in the book</p>
            <ul className="flex flex-col gap-1">
              {book.outOfBook.map(({ facility, quote, reason }) => (
                <li
                  key={quote.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground"
                >
                  <span className="text-foreground">{facility.name}</span>
                  <CadPrice quote={quote} fx={reason === 'FX_MISSING' ? null : fx} />
                  {reason === 'NOT_LIVE' && (
                    <>
                      <QuoteStatusBadge status={displayStatus(quote, selection.now)} />
                      <span>valid until {formatUtc(quote.validUntil)}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

/**
 * The order book: for each chosen commodity, live asks and bids side by side, best first, in
 * CAD, with the gross spread. A spread is best bid minus best ask before freight, handling and
 * basis, so it is not a margin, and nothing here is a trade.
 */
export function OrderBook({
  books,
  fx,
  selected,
  id,
  inert,
  className,
  ...selection
}: {
  books: readonly CommodityBook[];
  /** The CAD/USD rate the books were built with; null when there is none. */
  fx: FxRate | null;
  /** The selected facility's details, shown above the books. */
  selected?: ReactNode;
  id?: string;
  /** Hidden from keyboard and screen readers while tucked away. */
  inert?: boolean;
  className?: string;
} & Selection) {
  return (
    <Card asChild>
      <aside
        id={id}
        inert={inert}
        aria-labelledby="order-book-heading"
        className={cn('flex flex-col overflow-hidden', className)}
      >
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 id="order-book-heading" className="text-base font-semibold">
              Order book
            </h2>
            <p className="text-xs text-muted-foreground">
              {fx
                ? `In CAD. USD quotes converted at ${fx.cadPerUsd} CAD per USD, ${fx.source}.`
                : 'In CAD. USD quotes are left out: no CAD/USD rate is set up.'}{' '}
              Spread: best bid minus best ask, before freight and basis; not a margin.
            </p>
          </div>
          <Badge variant="caution">
            <FlaskConical aria-hidden="true" />
            Synthetic
          </Badge>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {selected}
          {books.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Choose a commodity to see its asks and bids.
            </p>
          ) : (
            books.map((book) => (
              <CommoditySection
                key={`${book.commodity}:${book.grade}`}
                book={book}
                fx={fx}
                {...selection}
              />
            ))
          )}
        </div>
      </aside>
    </Card>
  );
}
