import { formatPlace } from '../lib/format';
import type { Facility, FxRate } from '../data/types';
import { FacilityQuotes } from './FacilityQuotes';
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
  commodities: readonly string[];
  /** The rate that puts USD quotes in CAD; null when there is none. */
  fx: FxRate | null;
  /** What to say when no facility is shown; by default, that none match the filters. */
  emptyText?: string;
  now: Date;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** The facilities on the map, as a table, with their quotes in the chosen commodities. */
export function FacilityTable({
  facilities,
  commodities,
  fx,
  emptyText = 'No facilities match these filters.',
  now,
  selectedId,
  onSelect,
}: FacilityTableProps) {
  return (
    <Card asChild>
      <section aria-labelledby="facilities-heading" className="overflow-hidden">
        <CardHeader>
          <CardTitle id="facilities-heading">Facilities</CardTitle>
          <CardDescription>{facilities.length} shown</CardDescription>
        </CardHeader>
        <Table className="min-w-[44rem]">
          <TableHeader>
            <tr>
              <TableHead>Facility</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>Quotes</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {facilities.map((facility) => {
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
                  <TableCell>{formatPlace(facility.region, facility.country)}</TableCell>
                  <TableCell>
                    <FacilityQuotes
                      facility={facility}
                      commodities={commodities}
                      fx={fx}
                      now={now}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
            {facilities.length === 0 && (
              <tr className="border-t">
                <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                  {emptyText}
                </TableCell>
              </tr>
            )}
          </TableBody>
        </Table>
      </section>
    </Card>
  );
}
