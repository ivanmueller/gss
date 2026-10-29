import type { FreightSummary } from '@grain/domain';
import { Plus, Truck } from 'lucide-react';

import { FreightListCard } from '../components/FreightList';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Select } from '../components/ui/select';
import { SegmentedControl } from '../components/ui/segmented-control';
import type { CounterpartyList } from '../lib/api';
import { canEnterFreight } from '../lib/freight';
import { Link, setSearchParams, useSearch } from '../lib/router';
import { useApiResource } from '../lib/useApiResource';
import type { DirectorySession } from './CounterpartiesPage';

type Mode = 'all' | 'truck' | 'rail';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FreightListResponse {
  freight: FreightSummary[];
  truncated: boolean;
}

/**
 * /freight: carriers' freight rates by route, live ones by default. Withdrawn and expired
 * rates only when asked for, so neither ever passes for a live rate.
 */
export function FreightPage({ session }: { session: DirectorySession }) {
  const { token, organization } = session;
  // The filters live in the address (?mode=truck&carrier=<id>&status=all).
  const params = new URLSearchParams(useSearch());
  const modeParam = params.get('mode');
  const mode: Mode = modeParam === 'truck' || modeParam === 'rail' ? modeParam : 'all';
  const carrierParam = params.get('carrier');
  const carrier = carrierParam !== null && UUID.test(carrierParam) ? carrierParam : null;
  const everything = params.get('status') === 'all';

  const query = new URLSearchParams({ organization_id: organization.id });
  if (mode !== 'all') query.set('mode', mode);
  if (carrier) query.set('carrier_id', carrier);
  if (everything) query.set('status', 'all');
  const [list] = useApiResource<FreightListResponse>(`/freight-quotes?${query.toString()}`, token);
  const [counterparties] = useApiResource<CounterpartyList>(
    `/counterparties?organization_id=${organization.id}`,
    token,
  );
  const carriers =
    counterparties.status === 'ok'
      ? counterparties.data.counterparties.filter((item) => item.types.includes('carrier'))
      : [];
  const entrant = canEnterFreight(organization.role);
  const filtered = mode !== 'all' || carrier !== null;

  return (
    <section aria-labelledby="freight-heading" className="flex flex-col gap-4">
      <h1 id="freight-heading" className="sr-only">
        Freight
      </h1>
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          label="Show"
          options={[
            { value: 'all', label: 'All' },
            { value: 'truck', label: 'Truck' },
            { value: 'rail', label: 'Rail' },
          ]}
          value={mode}
          onChange={(next) => {
            setSearchParams({ mode: next === 'all' ? null : next });
          }}
        />
        <Select
          aria-label="Carrier"
          className="w-64"
          icon={<Truck aria-hidden="true" className="text-muted-foreground" />}
          value={carrier ?? ''}
          onValueChange={(next) => {
            setSearchParams({ carrier: next || null });
          }}
          options={[
            { value: '', label: 'All carriers' },
            ...carriers.map((item) => ({ value: item.id, label: item.legalName })),
          ]}
        />
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
        {entrant && (
          <div className="ml-auto">
            <Button asChild>
              <Link href={carrier ? `/freight/new?carrier=${carrier}` : '/freight/new'}>
                <Plus aria-hidden="true" />
                New freight rate
              </Link>
            </Button>
          </div>
        )}
      </div>

      {list.status === 'loading' && (
        <p className="text-sm text-muted-foreground">Loading freight rates…</p>
      )}
      {list.status === 'error' && (
        <p role="alert" className="text-sm text-danger">
          Could not load freight rates: {list.error.message}
        </p>
      )}
      {list.status === 'ok' && list.data.freight.length === 0 && (
        <Card className="px-4 py-10 text-center text-sm">
          <p className="font-medium">
            {filtered || !everything ? 'No live freight rates here.' : 'No freight rates yet.'}
          </p>
          <p className="text-muted-foreground">
            {entrant
              ? counterparties.status === 'ok' && carriers.length === 0
                ? 'First add your carriers under Counterparties, marked as carriers; then enter their rates here.'
                : 'Enter a carrier’s rate from New freight rate, or from the carrier’s page.'
              : 'Traders, operations and admins enter them.'}
          </p>
        </Card>
      )}
      {list.status === 'ok' && list.data.freight.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {list.data.freight.length} {everything ? 'freight rates' : 'live freight rates'}
            {list.data.truncated && ' · the list is cut at 2,000; filter to narrow it'}
          </p>
          <FreightListCard freight={list.data.freight} caption="Freight rates" />
        </>
      )}
    </section>
  );
}
