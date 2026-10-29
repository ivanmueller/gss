import { formatAlberta } from '@grain/domain';
import { X } from 'lucide-react';

import type { Facility, FxRate, Quote } from '../data/types';
import { formatPlace, formatQuantityRange } from '../lib/format';
import { cadPrice, displayStatus, isLive } from '../lib/orderBook';
import { Link } from '../lib/router';
import { CadPrice, conversionText } from './CadPrice';
import { QuoteStatusBadge } from './QuoteStatusBadge';
import { RoleLabel } from './RoleLabel';
import { Button } from './ui/button';

/** "2026-11-01 to 2026-11-30", "From 2026-11-01", or "Not stated". */
function deliveryWindow(quote: Quote): string {
  const { start, end } = quote.deliveryWindow;
  if (start && end) return `${start} to ${end}`;
  if (start) return `From ${start}`;
  if (end) return `By ${end}`;
  return 'Not stated';
}

function QuoteDetails({ quote, fx, now }: { quote: Quote; fx: FxRate | null; now: Date }) {
  const isAsk = quote.side === 'OFFER';
  const converted = cadPrice(quote, fx)?.fx;
  return (
    <section
      aria-label={isAsk ? 'Seller ask' : 'Buyer bid'}
      className="rounded-control border bg-card p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <RoleLabel role={isAsk ? 'seller' : 'buyer'} suffix={isAsk ? 'ask' : 'bid'} />
        <QuoteStatusBadge status={displayStatus(quote, now)} />
      </div>
      <p className="mt-2 text-xl font-semibold tracking-tight">
        <CadPrice quote={quote} fx={fx} />
      </p>
      {converted && (
        <p className="text-xs text-muted-foreground">
          Quoted as {conversionText(quote, converted)}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Quoted {formatAlberta(quote.quotedAt)} · valid until {formatAlberta(quote.validUntil)}
      </p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Commodity</dt>
        <dd>{quote.commodity}</dd>
        <dt className="text-muted-foreground">Grade</dt>
        <dd>{quote.grade || 'Not stated'}</dd>
        <dt className="text-muted-foreground">Delivery basis</dt>
        <dd>{quote.deliveryBasis}</dd>
        <dt className="text-muted-foreground">Delivery window</dt>
        <dd>{deliveryWindow(quote)}</dd>
        <dt className="text-muted-foreground">Quantity</dt>
        <dd className="tabular-nums">{formatQuantityRange(quote.quantityMt)}</dd>
        <dt className="text-muted-foreground">Source</dt>
        <dd>
          {quote.source} · revision {quote.revision}
        </dd>
      </dl>
      {quote.href && (
        <Link
          href={quote.href}
          className="mt-2 inline-block text-xs font-medium underline underline-offset-4"
        >
          Open this {isAsk ? 'offer' : 'bid'} and its history
        </Link>
      )}
      {!(quote.status === 'firm' && isLive(quote, now)) && (
        <p className="mt-2 text-xs text-muted-foreground">
          Not executable: only a firm, current quote can be acted on.
        </p>
      )}
    </section>
  );
}

/**
 * The facility picked on the map or in a list: where it is and its quotes in the chosen
 * commodities. Shown at the top of the order book.
 */
export function SelectedFacility({
  facility,
  commodities,
  fx,
  now,
  onClose,
}: {
  facility: Facility;
  commodities: readonly string[];
  /** The rate that puts USD quotes in CAD; null when there is none. */
  fx: FxRate | null;
  now: Date;
  onClose: () => void;
}) {
  const quotes = facility.quotes.filter((quote) => commodities.includes(quote.commodity));
  return (
    <section
      aria-labelledby="selected-facility-heading"
      className="flex flex-col gap-3 border-b bg-muted/40 px-4 py-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Selected
          </p>
          <h3 id="selected-facility-heading" className="text-base font-semibold">
            {facility.href ? (
              <Link href={facility.href} className="underline-offset-4 hover:underline">
                {facility.name}
              </Link>
            ) : (
              facility.name
            )}
          </h3>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X aria-hidden="true" />
          <span className="sr-only">Clear selection</span>
        </Button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">Role</dt>
        <dd className="flex flex-wrap gap-x-3">
          {facility.roles.map((role) => (
            <RoleLabel key={role} role={role} />
          ))}
        </dd>
        <dt className="text-muted-foreground">Location</dt>
        <dd>
          {formatPlace(facility.region, facility.country)} ·{' '}
          {facility.locationPrecision === null
            ? 'no coordinates, so not on the map'
            : facility.locationPrecision === 'approximate'
              ? 'approximate (municipality level)'
              : 'exact'}
        </dd>
        <dt className="text-muted-foreground">Trades</dt>
        <dd>{facility.commodities.join(', ')}</dd>
      </dl>
      {quotes.length > 0 ? (
        quotes.map((quote) => <QuoteDetails key={quote.id} quote={quote} fx={fx} now={now} />)
      ) : (
        <p className="rounded-control border border-dashed bg-card p-3 text-xs">
          <span className="block font-medium">
            {facility.roles.includes('seller') ? 'No active ask' : 'No active bid'}
          </span>
          <span className="text-muted-foreground">
            Known facility with no recorded price in the chosen commodities, so it cannot be paired
            in a scenario.
          </span>
        </p>
      )}
    </section>
  );
}
