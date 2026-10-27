import type { Facility, FxRate } from '../data/types';
import { cn } from '../lib/utils';
import { FacilityQuotes } from './FacilityQuotes';
import { RoleLabel } from './RoleLabel';
import { Card, CardDescription, CardHeader, CardTitle } from './ui/card';

interface FacilityListProps {
  facilities: readonly Facility[];
  commodities: readonly string[];
  /** The rate that puts USD quotes in CAD; null when there is none. */
  fx: FxRate | null;
  now: Date;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Narrow-screen alternative to FacilityTable: one stacked entry per facility, no sideways scroll. */
export function FacilityList({
  facilities,
  commodities,
  fx,
  now,
  selectedId,
  onSelect,
}: FacilityListProps) {
  return (
    <Card asChild>
      <section aria-labelledby="facility-list-heading" className="overflow-hidden">
        <CardHeader>
          <CardTitle id="facility-list-heading">Facilities</CardTitle>
          <CardDescription>{facilities.length} shown · synthetic</CardDescription>
        </CardHeader>
        {facilities.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No facilities match these filters.
          </p>
        ) : (
          <ul className="divide-y">
            {facilities.map((facility) => {
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
                    <span className="font-medium">{facility.name}</span>
                    <span className="flex flex-wrap items-center gap-x-3">
                      {facility.roles.map((role) => (
                        <RoleLabel key={role} role={role} />
                      ))}
                      <span>
                        {facility.region}, {facility.country}
                      </span>
                    </span>
                    <FacilityQuotes
                      facility={facility}
                      commodities={commodities}
                      fx={fx}
                      now={now}
                    />
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
