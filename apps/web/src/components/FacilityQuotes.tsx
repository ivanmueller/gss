import type { Facility, FxRate } from '../data/types';
import { formatUtc } from '../lib/format';
import { displayStatus } from '../lib/orderBook';
import { CadPrice } from './CadPrice';
import { QuoteStatusBadge } from './QuoteStatusBadge';

/** A facility's quotes in the chosen commodities, in CAD, each with its times and status. */
export function FacilityQuotes({
  facility,
  commodities,
  fx,
  now,
}: {
  facility: Facility;
  commodities: readonly string[];
  fx: FxRate | null;
  now: Date;
}) {
  const quotes = facility.quotes.filter((quote) => commodities.includes(quote.commodity));
  if (quotes.length === 0) {
    return (
      <span className="text-muted-foreground">
        {facility.roles.includes('seller') ? 'No active ask' : 'No active bid'}
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-2">
      {quotes.map((quote) => (
        <span key={quote.id} className="flex flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-muted-foreground">{quote.commodity}</span>
            <CadPrice quote={quote} fx={fx} className="font-medium" />
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
