import { ChevronDown, FlaskConical, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { formatPrice, formatQuantityRange, formatSignedPrice, formatUtc } from '../lib/format';
import {
  displayStatus,
  largestQuantity,
  type BookQuote,
  type CommodityBook,
  type CurrencyBook,
} from '../lib/orderBook';
import { cn } from '../lib/utils';
import { QuoteStatusBadge } from './QuoteStatusBadge';
import { Badge } from './ui/badge';
import { Card } from './ui/card';

interface Selection {
  selectedId: string | null;
  onSelect: (facilityId: string) => void;
  now: Date;
}

/** Quantity as a bar against the largest in the book, with the range in words. */
function QuantityBar({
  side,
  range,
  largest,
}: {
  side: 'OFFER' | 'BID';
  range: { min: string; max: string };
  largest: string | null;
}) {
  // A display width only; no money is calculated here.
  const share = largest ? Math.min(100, (Number(range.max) / Number(largest)) * 100) : 0;
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
      >
        <span
          className={cn(
            'absolute inset-y-0 left-0 rounded-full',
            side === 'OFFER' ? 'bg-offer-solid' : 'bg-bid-solid',
          )}
          style={{ width: `${String(share)}%` }}
        />
      </span>
      <span className="shrink-0 tabular-nums">{formatQuantityRange(range)}</span>
    </span>
  );
}

/** One offer or bid in the ladder: who, where, the price with its times, status and size. */
function QuoteCell({
  entry,
  largest,
  selectedId,
  onSelect,
  now,
}: { entry: BookQuote; largest: string | null } & Selection) {
  const { facility, quote } = entry;
  const offer = quote.side === 'OFFER';
  return (
    <button
      type="button"
      aria-pressed={selectedId === facility.id}
      onClick={() => {
        onSelect(facility.id);
      }}
      className={cn(
        'flex min-w-0 flex-col gap-1 rounded-control border p-2 text-left text-xs transition-colors aria-pressed:ring-2 aria-pressed:ring-ring',
        offer
          ? 'border-offer-border bg-offer-subtle hover:border-offer'
          : 'border-bid-border bg-bid-subtle hover:border-bid',
      )}
    >
      <span className="flex flex-wrap items-center justify-between gap-1">
        <Badge variant={offer ? 'offer' : 'bid'}>{offer ? 'Offer' : 'Bid'}</Badge>
        <QuoteStatusBadge status={displayStatus(quote, now)} />
      </span>
      <span className="text-sm font-medium text-foreground">{facility.name}</span>
      <span className="text-muted-foreground">
        {facility.region} · {quote.deliveryBasis}
      </span>
      <span className="font-mono text-sm font-semibold text-foreground tabular-nums">
        {formatPrice(quote.price)}
      </span>
      <span className="text-muted-foreground">
        Quoted {formatUtc(quote.quotedAt)} · valid until {formatUtc(quote.validUntil)}
      </span>
      <QuantityBar side={quote.side} range={quote.quantityMt} largest={largest} />
    </button>
  );
}

function SpreadLine({ book }: { book: CurrencyBook }) {
  const { spread, currency } = book;
  let text: ReactNode;
  if (spread.status === 'ok') {
    text = (
      <>
        Gross spread{' '}
        <span className="font-mono font-semibold text-foreground tabular-nums">
          {formatSignedPrice(spread)}
        </span>
      </>
    );
  } else if (spread.status === 'missing') {
    text = `No spread: no ${currency} ${spread.side}`;
  } else {
    text = spread.reason === 'UNIT_MISMATCH' ? 'No spread: the units differ' : 'No spread';
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span className="rounded-xs border px-1 font-mono text-2xs font-medium text-foreground">
        {currency}
      </span>
      <span>{text}</span>
      {spread.status === 'ok' && book.indicative && <Badge variant="caution">Indicative</Badge>}
    </div>
  );
}

function Ladder({
  book,
  largest,
  ...selection
}: { book: CurrencyBook; largest: string | null } & Selection) {
  const levels = Math.max(book.offers.length, book.bids.length);
  return (
    <ol aria-label={`${book.currency} bids and offers`} className="flex flex-col gap-2">
      {Array.from({ length: levels }, (_, level) => {
        const offer = book.offers[level];
        const bid = book.bids[level];
        return (
          <li key={level} className="grid grid-cols-[1.75rem_1fr_1fr] gap-2">
            <span className="flex flex-col items-center gap-0.5 pt-1 text-2xs text-muted-foreground">
              <span className="flex size-6 items-center justify-center rounded-xs border bg-card font-mono font-medium text-foreground">
                {level + 1}
              </span>
              {book.currency}
            </span>
            {offer ? (
              <QuoteCell entry={offer} largest={largest} {...selection} />
            ) : (
              <span className="flex items-center justify-center rounded-control border border-dashed text-xs text-muted-foreground">
                No offer
              </span>
            )}
            {bid ? (
              <QuoteCell entry={bid} largest={largest} {...selection} />
            ) : (
              <span className="flex items-center justify-center rounded-control border border-dashed text-xs text-muted-foreground">
                No bid
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function CommoditySection({ book, ...selection }: { book: CommodityBook } & Selection) {
  const largest = largestQuantity([book]);
  const live = book.currencies.reduce((n, c) => n + c.offers.length + c.bids.length, 0);
  const title = book.grade ? `${book.commodity} · ${book.grade}` : book.commodity;
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
        {book.currencies.length === 0 ? (
          <p className="text-xs text-muted-foreground">No live bids or offers.</p>
        ) : (
          <>
            <div
              role="group"
              aria-label="Spreads"
              className="flex flex-col gap-1.5 rounded-control bg-muted/60 p-2"
            >
              {book.currencies.map((currency) => (
                <SpreadLine key={currency.currency} book={currency} />
              ))}
              {book.needsFx && (
                <p className="flex items-start gap-1.5 text-xs text-caution">
                  <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                  CAD and USD quotes are not compared: that needs a CAD/USD rate, which is not set
                  up yet.
                </p>
              )}
            </div>
            <div className="grid grid-cols-[1.75rem_1fr_1fr] gap-2 text-2xs font-medium tracking-wider text-muted-foreground uppercase">
              <span aria-hidden="true" />
              <span>Offers · sellers</span>
              <span>Bids · buyers</span>
            </div>
            {book.currencies.map((currency) => (
              <Ladder key={currency.currency} book={currency} largest={largest} {...selection} />
            ))}
          </>
        )}
        {book.stale.length > 0 && (
          <div className="flex flex-col gap-1 text-xs">
            <p className="font-medium text-muted-foreground">Not in the book</p>
            <ul className="flex flex-col gap-1">
              {book.stale.map(({ facility, quote }) => (
                <li
                  key={quote.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground"
                >
                  <span className="text-foreground">{facility.name}</span>
                  <span className="font-mono tabular-nums">{formatPrice(quote.price)}</span>
                  <QuoteStatusBadge status={displayStatus(quote, selection.now)} />
                  <span>
                    Quoted {formatUtc(quote.quotedAt)} · valid until {formatUtc(quote.validUntil)}
                  </span>
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
 * The order book: for each chosen commodity, live offers and bids side by side, best first,
 * with the gross spread per currency. A spread is bid minus offer before freight, FX and
 * basis, so it is not a margin, and nothing here is a trade.
 */
export function OrderBook({
  books,
  selected,
  className,
  ...selection
}: {
  books: readonly CommodityBook[];
  /** The selected facility's details, shown above the books. */
  selected?: ReactNode;
  className?: string;
} & Selection) {
  return (
    <Card asChild>
      <aside
        aria-labelledby="order-book-heading"
        className={cn('flex flex-col overflow-hidden', className)}
      >
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 id="order-book-heading" className="text-base font-semibold">
              Order book
            </h2>
            <p className="text-xs text-muted-foreground">
              Best bids and offers by commodity. Gross spread is bid minus offer in one currency,
              before freight, FX and basis: not a margin.
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
              Choose a commodity to see its bids and offers.
            </p>
          ) : (
            books.map((book) => (
              <CommoditySection
                key={`${book.commodity}:${book.grade}`}
                book={book}
                {...selection}
              />
            ))
          )}
        </div>
      </aside>
    </Card>
  );
}
