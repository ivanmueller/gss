import type { Facility } from '../data/types';
import { latestQuote, noQuoteText } from '../lib/facility';
import { formatPrice, formatUtc } from '../lib/format';
import { QuoteStatusBadge } from './QuoteStatusBadge';
import { RoleLabel } from './RoleLabel';
import { Card, CardDescription, CardHeader, CardTitle } from './ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHeader,
} from './ui/table';

interface FacilityTableProps {
  facilities: readonly Facility[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export function FacilityTable({ facilities, selectedId, onSelect }: FacilityTableProps) {
  return (
    <Card asChild>
      <section aria-labelledby="facilities-heading" className="overflow-hidden">
        <CardHeader>
          <CardTitle id="facilities-heading">Facilities</CardTitle>
          <CardDescription>{facilities.length} shown · synthetic</CardDescription>
        </CardHeader>
        <Table className="min-w-[40rem]">
          <TableHeader>
            <tr>
              <TableHead>Facility</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>Latest quote</TableHead>
              <TableHead>Status</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {facilities.map((facility) => {
              const quote = latestQuote(facility);
              const selected = facility.id === selectedId;
              return (
                <TableRow key={facility.id} selected={selected} className="align-top">
                  <TableRowHeader>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        onSelect(facility.id);
                      }}
                      className="rounded-xs text-left underline-offset-4 hover:underline"
                    >
                      {facility.name}
                    </button>
                  </TableRowHeader>
                  <TableCell>
                    <span className="flex flex-col gap-0.5">
                      {facility.roles.map((role) => (
                        <RoleLabel key={role} role={role} />
                      ))}
                    </span>
                  </TableCell>
                  <TableCell>
                    {facility.region}, {facility.country}
                  </TableCell>
                  <TableCell>
                    {quote ? (
                      <>
                        <span className="font-mono font-medium">{formatPrice(quote.price)}</span>
                        <span className="block text-xs text-muted-foreground">
                          Quoted {formatUtc(quote.quotedAt)} · valid until{' '}
                          {formatUtc(quote.validUntil)}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">{noQuoteText(facility)}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {quote ? (
                      <QuoteStatusBadge status={quote.status} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {facilities.length === 0 && (
              <tr className="border-t">
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  No facilities match this filter.
                </TableCell>
              </tr>
            )}
          </TableBody>
        </Table>
      </section>
    </Card>
  );
}
