import { SIDE_COUNTERPARTY_TYPES, type QuoteSide } from '@grain/domain';
import { Plus } from 'lucide-react';
import { useState } from 'react';

import { canEnterQuotes } from '../lib/quotes';
import { Link } from '../lib/router';
import { useApiResource } from '../lib/useApiResource';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import type { QuoteListResponse } from '../pages/QuotesPage';
import { QuoteList } from './QuoteList';
import { Button } from './ui/button';
import { Card, CardHeader, CardTitle } from './ui/card';

/** A counterparty's bids and offers on its page, with buttons to enter new ones. */
export function CounterpartyQuotes({
  session,
  counterparty,
}: {
  session: DirectorySession;
  counterparty: { id: string; types: string[]; archived: boolean };
}) {
  const { token, organization } = session;
  const [everything, setEverything] = useState(false);
  const [list] = useApiResource<QuoteListResponse>(
    `/quotes?counterparty_id=${counterparty.id}${everything ? '&status=all' : ''}`,
    token,
  );
  const canAdd = canEnterQuotes(organization.role) && !counterparty.archived;
  const sides = (['bid', 'offer'] as const).filter((side: QuoteSide) =>
    SIDE_COUNTERPARTY_TYPES[side].some((type) => counterparty.types.includes(type)),
  );
  const count = list.status === 'ok' ? list.data.quotes.length : null;

  return (
    <Card asChild className="overflow-hidden">
      <section aria-labelledby="counterparty-quotes-heading">
        <CardHeader>
          <CardTitle id="counterparty-quotes-heading">
            Bids and offers{count !== null && ` (${String(count)})`}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
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
            {canAdd &&
              sides.map((side) => (
                <Button key={side} asChild size="sm" variant="outline">
                  <Link href={`/quotes/new?counterparty=${counterparty.id}&side=${side}`}>
                    <Plus aria-hidden="true" />
                    {side === 'bid' ? 'New bid' : 'New offer'}
                  </Link>
                </Button>
              ))}
          </div>
        </CardHeader>
        {list.status === 'loading' && (
          <p className="px-4 py-4 text-sm text-muted-foreground">Loading…</p>
        )}
        {list.status === 'error' && (
          <p role="alert" className="px-4 py-4 text-sm text-danger">
            Could not load bids and offers: {list.error.message}
          </p>
        )}
        {list.status === 'ok' &&
          (list.data.quotes.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">
              {everything ? 'No bids or offers recorded.' : 'No live bids or offers.'}
              {sides.length === 0 &&
                ' Bids come from buyers and offers from sellers: mark this counterparty as one under Edit details.'}
            </p>
          ) : (
            <QuoteList
              quotes={list.data.quotes}
              caption={`Bids and offers of this counterparty`}
              showCounterparty={false}
            />
          ))}
      </section>
    </Card>
  );
}
