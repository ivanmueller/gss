import type { Commodity, QuoteSummary } from '@grain/domain';
import { Plus } from 'lucide-react';

import { QuoteListCard } from '../components/QuoteList';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Select } from '../components/ui/input';
import { SegmentedControl } from '../components/ui/segmented-control';
import { canEnterQuotes } from '../lib/quotes';
import { Link, setSearchParams, useSearch } from '../lib/router';
import { useApiResource } from '../lib/useApiResource';
import type { DirectorySession } from './CounterpartiesPage';

type Side = 'all' | 'bid' | 'offer';

export interface QuoteListResponse {
  quotes: QuoteSummary[];
  truncated: boolean;
}

/**
 * /quotes: GSS's bids and offers, live ones by default. Withdrawn and expired ones only when
 * asked for, so neither ever passes for a live quote (specification section 13, Phase 3).
 */
export function QuotesPage({ session }: { session: DirectorySession }) {
  const { token, organization } = session;
  // The filters live in the address (?side=bid&commodity=flaxseed&status=all).
  const params = new URLSearchParams(useSearch());
  const sideParam = params.get('side');
  const side: Side = sideParam === 'bid' || sideParam === 'offer' ? sideParam : 'all';
  const commodity = params.get('commodity');
  const everything = params.get('status') === 'all';

  const query = new URLSearchParams({ organization_id: organization.id });
  if (side !== 'all') query.set('side', side);
  if (commodity) query.set('commodity', commodity);
  if (everything) query.set('status', 'all');
  const [list] = useApiResource<QuoteListResponse>(`/quotes?${query.toString()}`, token);
  const [commodities] = useApiResource<{ commodities: Commodity[] }>('/commodities', token);
  const trader = canEnterQuotes(organization.role);
  const filtered = side !== 'all' || commodity !== null;

  return (
    <section aria-labelledby="quotes-heading" className="flex flex-col gap-4">
      <h1 id="quotes-heading" className="sr-only">
        Bids and offers
      </h1>
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          label="Show"
          options={[
            { value: 'all', label: 'All' },
            { value: 'bid', label: 'Bids' },
            { value: 'offer', label: 'Offers' },
          ]}
          value={side}
          onChange={(next) => {
            setSearchParams({ side: next === 'all' ? null : next });
          }}
        />
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only sm:not-sr-only">Commodity</span>
          <Select
            className="w-48"
            value={commodity ?? ''}
            onChange={(event) => {
              setSearchParams({ commodity: event.target.value || null });
            }}
          >
            <option value="">All commodities</option>
            {commodities.status === 'ok' &&
              commodities.data.commodities.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
          </Select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={everything}
            onChange={(event) => {
              setSearchParams({ status: event.target.checked ? 'all' : null });
            }}
          />
          Include withdrawn and expired
        </label>
        {trader && (
          <div className="ml-auto">
            <Button asChild>
              <Link href={side === 'all' ? '/quotes/new' : `/quotes/new?side=${side}`}>
                <Plus aria-hidden="true" />
                New bid or offer
              </Link>
            </Button>
          </div>
        )}
      </div>

      {list.status === 'loading' && (
        <p className="text-sm text-muted-foreground">Loading bids and offers…</p>
      )}
      {list.status === 'error' && (
        <p role="alert" className="text-sm text-danger">
          Could not load bids and offers: {list.error.message}
        </p>
      )}
      {list.status === 'ok' && list.data.quotes.length === 0 && (
        <Card className="px-4 py-10 text-center text-sm">
          <p className="font-medium">
            {filtered || !everything ? 'No live bids or offers here.' : 'No bids or offers yet.'}
          </p>
          <p className="text-muted-foreground">
            {trader
              ? 'Enter one from New bid or offer, or from a counterparty’s page.'
              : 'Traders and admins enter them.'}
          </p>
        </Card>
      )}
      {list.status === 'ok' && list.data.quotes.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {list.data.quotes.length} {everything ? 'bids and offers' : 'live bids and offers'}
            {list.data.truncated && ' · the list is cut at 2,000; filter to narrow it'}
          </p>
          <QuoteListCard quotes={list.data.quotes} caption="Bids and offers" />
        </>
      )}
    </section>
  );
}
