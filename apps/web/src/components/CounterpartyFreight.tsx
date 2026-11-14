import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { useState } from 'react';

import { canEnterFreight } from '../lib/freight';
import { Link } from '../lib/router';
import { useApiResource } from '../lib/useApiResource';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import type { FreightListResponse } from '../pages/FreightPage';
import { FreightList } from './FreightList';
import { Button } from './ui/button';
import { Card, CardHeader, CardTitle } from './ui/card';

/**
 * Freight on a counterparty's page: the rates it quoted (any company may quote one since
 * F-235) and the rates to and from its locations, with a button to enter a new one. With
 * `folded`, it starts closed and loads its rates only when opened (a buyer's or seller's page).
 */
export function CounterpartyFreight({
  session,
  counterparty,
  folded = false,
  hideNew = false,
}: {
  session: DirectorySession;
  counterparty: { id: string; types: string[]; archived: boolean; facilityCount: number };
  folded?: boolean;
  /** Leaves out New freight rate when the page has it already (a carrier's header). */
  hideNew?: boolean;
}) {
  const { token, organization } = session;
  const [everything, setEverything] = useState(false);
  const [open, setOpen] = useState(!folded);
  const carrier = counterparty.types.includes('carrier');
  const [list] = useApiResource<FreightListResponse>(
    open
      ? `/freight-quotes?counterparty_id=${counterparty.id}${everything ? '&status=all' : ''}`
      : null,
    token,
  );
  const canAdd = !hideNew && canEnterFreight(organization.role) && !counterparty.archived;
  const count = list.status === 'ok' ? list.data.freight.length : null;
  const title = 'Freight rates';

  const options = (
    <>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={everything}
          onChange={(event) => {
            setEverything(event.target.checked);
          }}
        />
        Include withdrawn and expired
      </label>
      {canAdd && (
        <Button asChild size="sm" variant="outline">
          <Link href={`/freight/new?carrier=${counterparty.id}`}>
            <Plus aria-hidden="true" />
            New freight rate
          </Link>
        </Button>
      )}
    </>
  );

  // Folded (a buyer's or seller's page): the heading row opens and closes it, with Show or
  // Hide in the same place on the right either way (owner's request, 2026-10-30).
  const header = folded ? (
    <>
      <h2 id="counterparty-freight-heading" className="text-sm font-semibold">
        <button
          type="button"
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-accent/50"
          onClick={() => {
            setOpen(!open);
          }}
        >
          <span>
            {title}
            {open && count !== null && ` (${String(count)})`}
          </span>
          <span
            aria-hidden="true"
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground"
          >
            {open ? 'Hide' : 'Show'}
            {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </span>
        </button>
      </h2>
      {open && (
        <div className="flex flex-wrap items-center gap-2 border-y px-4 py-2">{options}</div>
      )}
    </>
  ) : (
    <CardHeader>
      <CardTitle id="counterparty-freight-heading">
        {title}
        {count !== null && ` (${String(count)})`}
      </CardTitle>
      <div className="flex flex-wrap items-center gap-2">{options}</div>
    </CardHeader>
  );

  return (
    <Card asChild className="overflow-hidden">
      <section aria-labelledby="counterparty-freight-heading">
        {header}
        {open && (
          <>
            {list.status === 'loading' && (
              <p className="px-4 py-4 text-sm text-muted-foreground">Loading…</p>
            )}
            {list.status === 'error' && (
              <p role="alert" className="px-4 py-4 text-sm text-danger">
                Could not load freight rates: {list.error.message}
              </p>
            )}
            {list.status === 'ok' &&
              (list.data.freight.length === 0 ? (
                <p className="px-4 py-4 text-sm text-muted-foreground">
                  {everything ? 'No freight rates recorded.' : 'No live freight rates.'}
                </p>
              ) : (
                <FreightList
                  freight={list.data.freight}
                  caption="Freight rates it quoted, and to and from its locations"
                  showCarrier={!carrier}
                />
              ))}
          </>
        )}
      </section>
    </Card>
  );
}
