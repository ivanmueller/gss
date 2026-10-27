import type { Facility } from '../data/types';
import { formatPrice, formatUtc } from '../lib/format';
import { displayStatus } from '../lib/orderBook';
import { QuoteStatusBadge } from './QuoteStatusBadge';

/** A facility's quotes in the chosen commodities, each with its times and status. */
export function FacilityQuotes({
  facility,
  commodities,
  now,
}: {
  facility: Facility;
  commodities: readonly string[];
  now: Date;
}) {
  const quotes = facility.quotes.filter((quote) => commodities.includes(quote.commodity));
  if (quotes.length === 0) {
    return (
      <span className="text-muted-foreground">
        {facility.roles.includes('seller') ? 'No active offer' : 'No active bid'}
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-2">
      {quotes.map((quote) => (
        <span key={quote.id} className="flex flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-muted-foreground">{quote.commodity}</span>
            <span className="font-mono font-medium tabular-nums">{formatPrice(quote.price)}</span>
            <QuoteStatusBadge status={displayStatus(quote, now)} />
          </span>
          <span className="text-xs text-muted-foreground">
            Quoted {formatUtc(quote.quotedAt)} · valid until {formatUtc(quote.validUntil)}
          </span>
        </span>
      ))}
    </span>
  );
}
