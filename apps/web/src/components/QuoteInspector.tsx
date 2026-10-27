import type { Facility, Quote } from '../data/types';
import { latestQuote, noQuoteText } from '../lib/facility';
import { formatPrice, formatQuantityRange, formatUtc } from '../lib/format';
import { QuoteStatusBadge } from './QuoteStatusBadge';
import { RoleLabel } from './RoleLabel';
import { Card } from './ui/card';

function QuoteDetails({ quote }: { quote: Quote }) {
  const isOffer = quote.side === 'OFFER';
  return (
    <section
      aria-label={isOffer ? 'Seller offer' : 'Buyer bid'}
      className="rounded-control border p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <RoleLabel role={isOffer ? 'seller' : 'buyer'} suffix={isOffer ? 'offer' : 'bid'} />
        <QuoteStatusBadge status={quote.status} />
      </div>
      <p className="mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums">
        {formatPrice(quote.price)}
      </p>
      <p className="text-xs text-muted-foreground">
        Quoted {formatUtc(quote.quotedAt)} · valid until {formatUtc(quote.validUntil)}
      </p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Commodity</dt>
        <dd>{quote.commodity}</dd>
        <dt className="text-muted-foreground">Grade</dt>
        <dd>{quote.grade}</dd>
        <dt className="text-muted-foreground">Delivery basis</dt>
        <dd>{quote.deliveryBasis}</dd>
        <dt className="text-muted-foreground">Delivery window</dt>
        <dd>
          {quote.deliveryWindow.start} to {quote.deliveryWindow.end}
        </dd>
        <dt className="text-muted-foreground">Quantity</dt>
        <dd className="tabular-nums">{formatQuantityRange(quote.quantityMt)}</dd>
        <dt className="text-muted-foreground">Source</dt>
        <dd>Manual entry · revision {quote.revision}</dd>
      </dl>
      {quote.status !== 'firm' && (
        <p className="mt-3 text-xs text-muted-foreground">
          Not executable: only a firm, current quote can be acted on.
        </p>
      )}
    </section>
  );
}

export function QuoteInspector({ facility }: { facility: Facility | undefined }) {
  if (!facility) {
    return (
      <Card asChild>
        <aside className="p-4 text-sm text-muted-foreground">
          Select a facility to see its quotes.
        </aside>
      </Card>
    );
  }
  const quote = latestQuote(facility);
  return (
    <Card asChild>
      <aside aria-labelledby="inspector-heading" className="flex flex-col gap-4 p-4">
        <div>
          <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Quote inspector
          </p>
          <h2 id="inspector-heading" className="text-lg font-semibold">
            {facility.name}
          </h2>
          <p className="flex flex-wrap items-center gap-x-3 text-sm">
            {facility.roles.map((role) => (
              <RoleLabel key={role} role={role} />
            ))}
            <span>
              {facility.region}, {facility.country}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            {facility.locationPrecision === 'approximate'
              ? 'Approximate location (municipality level)'
              : 'Exact location'}
          </p>
        </div>
        {quote ? (
          <QuoteDetails quote={quote} />
        ) : (
          <div className="rounded-control border border-dashed p-3 text-sm">
            <p className="font-medium">{noQuoteText(facility)}</p>
            <p className="text-muted-foreground">
              Known facility with no recorded price, so it cannot be paired in a scenario.
            </p>
          </div>
        )}
      </aside>
    </Card>
  );
}
