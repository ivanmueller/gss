import { ChevronDown, CircleDashed, TriangleAlert } from 'lucide-react';
import { useContext, type ReactNode } from 'react';

import { formatAmount, formatPrice, formatQuantityShort, formatSignedAmount } from '../lib/format';
import { displayStatus, type BookQuote, type CommodityBook } from '../lib/orderBook';
import { cn } from '../lib/utils';
import { conversionText, NoRateContext } from './CadPrice';
import { Card } from './ui/card';

interface Selection {
  selectedId: string | null;
  onSelect: (facilityId: string) => void;
  now: Date;
}

// Asks (what sellers offer, what we buy at) on the left, bids (what buyers pay, what we sell
// at) on the right: the owner's reading order, from the seller to the new buyer.
const COLUMNS = 'grid grid-cols-2 gap-2';

const SPREAD_CAVEAT = 'Best bid minus best ask, before freight and basis: not a margin.';

/** The mark for an indicative price; firm prices carry none. The book's footer explains it. */
function IndicativeMark({ label = false }: { label?: boolean }) {
  return (
    <>
      <CircleDashed aria-hidden="true" className="size-3 shrink-0 text-caution" />
      {label && <span className="sr-only">indicative</span>}
    </>
  );
}

/** "FX": a price converted from USD; the original price and rate are in its tooltip. */
function FxMark({ text }: { text: string }) {
  return (
    <span
      aria-hidden="true"
      title={`Converted from ${text}`}
      className="rounded-xs border px-0.5 font-sans text-2xs leading-none font-medium text-muted-foreground"
    >
      FX
    </span>
  );
}

/**
 * One ask or bid, in a box tinted red (ask) or green (bid): who, where, then the price per
 * tonne and the quantity. The panel's heading gives the currency.
 */
function QuoteCell({ entry, selectedId, onSelect, now }: { entry: BookQuote } & Selection) {
  const { facility, quote, fx } = entry;
  const ask = quote.side === 'OFFER';
  const status = displayStatus(quote, now);
  const converted = fx && conversionText(quote, fx);
  const quantity = formatQuantityShort(quote.quantityMt);
  // Screen readers hear the whole entry, with the currency, unit and status in words.
  const label = [
    `${ask ? 'Ask' : 'Bid'}: ${facility.name}`,
    formatPrice({ amount: entry.cadDisplay, currency: 'CAD', unit: quote.price.unit }),
    converted && `converted from ${converted}`,
    status,
    `${facility.region}, ${quote.deliveryBasis}`,
    quantity,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <button
      type="button"
      aria-pressed={selectedId === facility.id}
      aria-label={label}
      onClick={() => {
        onSelect(facility.id);
      }}
      className={cn(
        'flex min-w-0 flex-col gap-0.5 rounded-control border px-2.5 py-2 text-left transition-colors aria-pressed:ring-2 aria-pressed:ring-ring',
        ask
          ? 'border-offer-border bg-offer-subtle hover:border-offer-accent'
          : 'border-bid-border bg-bid-subtle hover:border-bid-accent',
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium" title={facility.name}>
          {facility.name}
        </span>
        {status === 'indicative' && <IndicativeMark />}
      </span>
      <span
        className="truncate text-xs text-muted-foreground"
        title={`${facility.region} · ${quote.deliveryBasis}`}
      >
        {facility.region} · {quote.deliveryBasis}
      </span>
      <span className="mt-1 flex flex-wrap items-center justify-between gap-x-2">
        <span className="flex items-center gap-1 font-price text-sm font-semibold tabular-nums">
          {formatAmount(entry.cadDisplay)}/{quote.price.unit}
          {converted && <FxMark text={converted} />}
        </span>
        <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {quantity}
        </span>
      </span>
    </button>
  );
}

/** The gross spread in the section's heading, or which side is missing. */
function Spread({ book }: { book: CommodityBook }) {
  const { spread } = book;
  if (spread.status !== 'ok') {
    return (
      <span className="text-xs text-muted-foreground">
        {spread.status === 'missing'
          ? `No ${spread.side} yet`
          : spread.reason === 'UNIT_MISMATCH'
            ? 'No spread: units differ'
            : 'No spread'}
      </span>
    );
  }
  return (
    <span title={SPREAD_CAVEAT} className="flex items-center gap-1.5 text-xs text-muted-foreground">
      Spread
      <span className="font-price text-sm font-semibold text-foreground tabular-nums">
        {formatSignedAmount(spread.amount)}
      </span>
      {book.indicative && <IndicativeMark label />}
    </span>
  );
}

/** Asks on the left and bids on the right, best first, level by level. */
function Ladder({ book, ...selection }: { book: CommodityBook } & Selection) {
  const levels = Math.max(book.asks.length, book.bids.length);
  return (
    <ol aria-label="Asks and bids" className="flex flex-col gap-2">
      {Array.from({ length: levels }, (_, level) => {
        const ask = book.asks[level];
        const bid = book.bids[level];
        return (
          <li key={level} className={COLUMNS}>
            {ask ? <QuoteCell entry={ask} {...selection} /> : <span />}
            {bid ? <QuoteCell entry={bid} {...selection} /> : <span />}
          </li>
        );
      })}
    </ol>
  );
}

function CommoditySection({ book, ...selection }: { book: CommodityBook } & Selection) {
  const live = book.asks.length + book.bids.length;
  const noRate = book.outOfBook.some((entry) => entry.reason === 'FX_MISSING');
  const otherUnit = book.outOfBook.some((entry) => entry.reason === 'UNIT_NOT_MT');
  const why = useContext(NoRateContext).long;
  return (
    <details open className="group border-b last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {book.commodity}
          {book.grade && <span className="font-normal text-muted-foreground"> · {book.grade}</span>}
        </span>
        {live > 0 && <Spread book={book} />}
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      {live === 0 ? (
        <p className="px-4 pb-3 text-xs text-muted-foreground">No live asks or bids.</p>
      ) : (
        <div className="flex flex-col gap-2 px-4 pb-4">
          <div
            aria-hidden="true"
            className={cn(
              COLUMNS,
              'text-2xs font-medium tracking-wider text-muted-foreground uppercase',
            )}
          >
            <span>Asks · sellers</span>
            <span>Bids · buyers</span>
          </div>
          <Ladder book={book} {...selection} />
        </div>
      )}
      {noRate && (
        <p className="flex items-start gap-1.5 px-4 pb-3 text-xs text-caution">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          USD quotes are left out of the book: {why}
        </p>
      )}
      {otherUnit && (
        <p className="flex items-start gap-1.5 px-4 pb-3 text-xs text-caution">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          Prices per bushel, short ton or hundredweight are left out of the book, which is per
          tonne: converting them needs a conversion factor that is not set up yet.
        </p>
      )}
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
  selected,
  empty,
  id,
  inert,
  className,
  ...selection
}: {
  books: readonly CommodityBook[];
  /** The selected facility's details, shown above the books. */
  selected?: ReactNode;
  /** What to say when there are no books; by default, to choose a commodity. */
  empty?: ReactNode;
  id?: string;
  /** Hidden from keyboard and screen readers while tucked away. */
  inert?: boolean;
  className?: string;
} & Selection) {
  const entries = books.flatMap((book) => [...book.asks, ...book.bids]);
  const anyIndicative = entries.some((entry) => entry.quote.status === 'indicative');
  // Every converted price in the book uses the same rate; the footer names it.
  const rate = entries.find((entry) => entry.fx !== null)?.fx ?? null;
  return (
    <Card asChild>
      <aside
        id={id}
        inert={inert}
        aria-labelledby="order-book-heading"
        className={cn('flex flex-col overflow-hidden', className)}
      >
        <div className="flex items-baseline justify-between gap-3 border-b px-4 py-3">
          <h2 id="order-book-heading" className="text-base font-semibold">
            Order book
          </h2>
          <span className="text-xs text-muted-foreground">CAD</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {selected}
          {books.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {empty ?? 'Choose a commodity to see its asks and bids.'}
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
        {(anyIndicative || rate) && (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2 text-2xs text-muted-foreground">
            {anyIndicative && (
              <span className="flex items-center gap-1">
                <IndicativeMark />
                Indicative, not firm
              </span>
            )}
            {rate && (
              <span className="flex items-center gap-1">
                <span className="rounded-xs border px-0.5 leading-none font-medium">FX</span>
                Converted from USD at {rate.cadPerUsd} CAD per USD, {rate.source}
              </span>
            )}
          </p>
        )}
      </aside>
    </Card>
  );
}
