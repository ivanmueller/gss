import type { Facility } from '../data/types';
import { latestQuote, noQuoteText } from '../lib/facility';
import { formatPrice, formatUtc } from '../lib/format';
import { cn } from '../lib/utils';
import { QuoteStatusBadge } from './QuoteStatusBadge';
import { RoleLabel } from './RoleLabel';
import { Card, CardDescription, CardHeader, CardTitle } from './ui/card';

interface FacilityListProps {
  facilities: readonly Facility[];
  selectedId: string;
  onSelect: (id: string) => void;
}

/** Narrow-screen alternative to FacilityTable: one stacked entry per facility, no sideways scroll. */
export function FacilityList({ facilities, selectedId, onSelect }: FacilityListProps) {
  return (
    <Card asChild>
      <section aria-labelledby="facility-list-heading" className="overflow-hidden">
        <CardHeader>
          <CardTitle id="facility-list-heading">Facilities</CardTitle>
          <CardDescription>{facilities.length} shown · synthetic</CardDescription>
        </CardHeader>
        {facilities.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No facilities match this filter.
          </p>
        ) : (
          <ul className="divide-y">
            {facilities.map((facility) => {
              const quote = latestQuote(facility);
              const selected = facility.id === selectedId;
              return (
                <li key={facility.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      onSelect(facility.id);
                    }}
                    className={cn(
                      'flex w-full flex-col gap-1 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:-outline-offset-2',
                      selected && 'bg-accent hover:bg-accent',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium">{facility.name}</span>
                      {quote && <QuoteStatusBadge status={quote.status} />}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-3">
                      {facility.roles.map((role) => (
                        <RoleLabel key={role} role={role} />
                      ))}
                      <span>
                        {facility.region}, {facility.country}
                      </span>
                    </span>
                    {quote ? (
                      <span>
                        <span className="font-mono font-medium tabular-nums">
                          {formatPrice(quote.price)}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          Quoted {formatUtc(quote.quotedAt)} · valid until{' '}
                          {formatUtc(quote.validUntil)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{noQuoteText(facility)}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Card>
  );
}
