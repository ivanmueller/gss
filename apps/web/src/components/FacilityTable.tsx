import type { Facility } from '../data/types';
import { latestQuote, noQuoteText } from '../lib/facility';
import { formatPrice, formatUtc } from '../lib/format';
import { cn } from '../lib/utils';
import { QuoteStatusBadge } from './QuoteStatusBadge';
import { RoleLabel } from './RoleLabel';

interface FacilityTableProps {
  facilities: readonly Facility[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export function FacilityTable({ facilities, selectedId, onSelect }: FacilityTableProps) {
  return (
    <section aria-labelledby="facilities-heading" className="rounded-xl border bg-card">
      <div className="flex items-baseline justify-between gap-4 border-b px-4 py-3">
        <h2 id="facilities-heading" className="text-sm font-semibold">
          Facilities
        </h2>
        <p className="text-xs text-muted-foreground">{facilities.length} shown · synthetic</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Facility
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Role
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Region
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Latest quote
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {facilities.map((facility) => {
              const quote = latestQuote(facility);
              const selected = facility.id === selectedId;
              return (
                <tr key={facility.id} className={cn('border-t align-top', selected && 'bg-accent')}>
                  <th scope="row" className="px-4 py-2 text-left font-medium">
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        onSelect(facility.id);
                      }}
                      className="rounded-sm text-left underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {facility.name}
                    </button>
                  </th>
                  <td className="px-4 py-2">
                    <span className="flex flex-col gap-0.5">
                      {facility.roles.map((role) => (
                        <RoleLabel key={role} role={role} />
                      ))}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {facility.region}, {facility.country}
                  </td>
                  <td className="px-4 py-2">
                    {quote ? (
                      <>
                        <span className="font-mono font-medium tabular-nums">
                          {formatPrice(quote.price)}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          Quoted {formatUtc(quote.quotedAt)} · valid until{' '}
                          {formatUtc(quote.validUntil)}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">{noQuoteText(facility)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {quote ? (
                      <QuoteStatusBadge status={quote.status} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {facilities.length === 0 && (
              <tr className="border-t">
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  No facilities match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
