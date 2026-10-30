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
 * Freight on a counterparty's page: a carrier's own rates, with a button to enter a new one;
 * for any other counterparty with locations, the rates to and from those locations. With
 * `folded`, it starts closed and loads its rates only when opened (a buyer's or seller's page).
 */
export function CounterpartyFreight({
  session,
  counterparty,
  folded = false,
}: {
  session: DirectorySession;
  counterparty: { id: string; types: string[]; archived: boolean; facilityCount: number };
  folded?: boolean;
}) {
  const { token, organization } = session;
  const [everything, setEverything] = useState(false);
  const [open, setOpen] = useState(!folded);
  const carrier = counterparty.types.includes('carrier');
  const shown = carrier || counterparty.facilityCount > 0;
  const [list] = useApiResource<FreightListResponse>(
    shown && open
      ? `/freight-quotes?${carrier ? 'carrier_id' : 'counterparty_id'}=${counterparty.id}${everything ? '&status=all' : ''}`
      : null,
    token,
  );
  if (!shown) return null;
  const canAdd = carrier && canEnterFreight(organization.role) && !counterparty.archived;
  const count = list.status === 'ok' ? list.data.freight.length : null;
  const title = carrier ? 'Freight rates' : 'Freight to and from its locations';

  if (!open) {
    return (
      <Card asChild className="overflow-hidden">
        <section aria-labelledby="counterparty-freight-heading">
          <h2 id="counterparty-freight-heading" className="text-sm font-semibold">
            <button
              type="button"
              aria-expanded={false}
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-accent/50"
              onClick={() => {
                setOpen(true);
              }}
            >
              {title}
              <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground" />
            </button>
          </h2>
        </section>
      </Card>
    );
  }

  return (
    <Card asChild className="overflow-hidden">
      <section aria-labelledby="counterparty-freight-heading">
        <CardHeader>
          <CardTitle id="counterparty-freight-heading">
            {title}
            {count !== null && ` (${String(count)})`}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {folded && (
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={true}
                onClick={() => {
                  setOpen(false);
                }}
              >
                <ChevronUp aria-hidden="true" />
                Hide
              </Button>
            )}
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
          </div>
        </CardHeader>
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
              caption={
                carrier ? 'Freight rates of this carrier' : 'Freight to and from its locations'
              }
              showCarrier={!carrier}
            />
          ))}
      </section>
    </Card>
  );
}
