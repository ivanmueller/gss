import type { FreightDetail, FreightMode } from '@grain/domain';
import { useId, useState } from 'react';

import { BackLink } from '../components/BackLink';
import { Field } from '../components/DirectoryFields';
import { FreightForm } from '../components/FreightForm';
import {
  EMPTY_AREA,
  FreightRouteEnd,
  routeEndProblem,
  routeEndRequest,
  type RouteEndValue,
} from '../components/FreightRouteEnd';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { SearchSelect } from '../components/ui/search-select';
import { SegmentedControl } from '../components/ui/segmented-control';
import { sendJson, type CounterpartyList } from '../lib/api';
import { counterpartyOptions } from '../lib/directory';
import { canEnterFreight } from '../lib/freight';
import { Link, navigate, useSearch } from '../lib/router';
import { useApiResource } from '../lib/useApiResource';
import type { DirectorySession } from './CounterpartiesPage';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /freight/new: one company's rate from one place to another, by truck or rail, with its first
 * terms. Any company may quote one, and each end is a saved location or a town or area
 * (F-235). `?carrier=<id>` comes from the quoting company's page.
 */
export function NewFreightPage({ session }: { session: DirectorySession }) {
  const { token, organization } = session;
  const baseId = useId();
  const params = new URLSearchParams(useSearch());
  const carrierParam = params.get('carrier');
  const [carrierId, setCarrierId] = useState(
    carrierParam !== null && UUID.test(carrierParam) ? carrierParam : '',
  );
  const [mode, setMode] = useState<FreightMode>('truck');
  const [origin, setOrigin] = useState<RouteEndValue>(EMPTY_AREA);
  const [destination, setDestination] = useState<RouteEndValue>(EMPTY_AREA);

  const [list] = useApiResource<CounterpartyList>(
    `/counterparties?organization_id=${organization.id}`,
    token,
  );

  if (!canEnterFreight(organization.role)) {
    return (
      <p role="alert" className="text-sm">
        Only traders, operations and admins of {organization.name} enter freight rates.
      </p>
    );
  }

  const active =
    list.status === 'ok' ? list.data.counterparties.filter((item) => item.archivedAt === null) : [];
  const located = active.filter((item) => item.facilityCount > 0);
  const chosen = active.find((item) => item.id === carrierId);
  const back = carrierParam && chosen ? `/counterparties/${chosen.id}` : '/freight';
  const loading = list.status === 'loading';

  return (
    <section aria-labelledby="new-freight-heading" className="flex flex-col gap-4">
      <PageHeader
        id="new-freight-heading"
        back={
          <BackLink href={back}>
            {back === '/freight' ? 'All freight rates' : (chosen?.legalName ?? 'Back')}
          </BackLink>
        }
        title="New freight rate"
        description="A company’s rate from one place to another, as it quoted it: between towns or areas, or saved locations. Later changes to the rate or its validity are recorded as new terms; the first terms are kept."
      />
      <Card>
        <CardContent className="pt-4">
          <FreightForm
            initial={{ firmness: 'indicative', rateUnit: 'MT' }}
            submitLabel="Save freight rate"
            busyLabel="Saving…"
            checkBefore={() =>
              chosen === undefined
                ? 'Choose the company that quoted the rate.'
                : (routeEndProblem(origin, 'leaves from') ??
                  routeEndProblem(destination, 'goes to') ??
                  (origin.kind === 'facility' &&
                  destination.kind === 'facility' &&
                  origin.facilityId === destination.facilityId
                    ? 'A route goes from one place to another; choose two different places.'
                    : null))
            }
            onSubmit={async (values) => {
              const created = await sendJson<FreightDetail>('/freight-quotes', token, 'POST', {
                organizationId: organization.id,
                carrierId,
                origin: routeEndRequest(origin),
                destination: routeEndRequest(destination),
                mode,
                values,
              });
              navigate(`/freight/${created.id}`);
            }}
            onCancel={
              <Button asChild variant="outline">
                <Link href={back}>Cancel</Link>
              </Button>
            }
            before={
              <div className="flex flex-col gap-6">
                <fieldset className="flex flex-col gap-3">
                  <legend className="mb-1 text-sm font-semibold">Company and mode</legend>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field
                      id={`${baseId}-carrier`}
                      label="Company quoting the rate"
                      required
                      error={undefined}
                      hint="A carrier, or any company that quoted a freight rate."
                    >
                      <SearchSelect
                        id={`${baseId}-carrier`}
                        value={chosen ? carrierId : ''}
                        onValueChange={setCarrierId}
                        placeholder={loading ? 'Loading…' : 'Choose…'}
                        options={counterpartyOptions(active)}
                      />
                    </Field>
                    <div className="flex flex-col gap-1.5">
                      <span aria-hidden="true" className="text-sm font-medium">
                        Truck or rail
                      </span>
                      <SegmentedControl
                        label="Truck or rail"
                        options={[
                          { value: 'truck', label: 'Truck' },
                          { value: 'rail', label: 'Rail' },
                        ]}
                        value={mode}
                        onChange={setMode}
                      />
                    </div>
                  </div>
                </fieldset>
                <FreightRouteEnd
                  label="From"
                  verb="leaves from"
                  hint="Where the grain is picked up, e.g. the seller’s elevator."
                  token={token}
                  organizationId={organization.id}
                  choices={located}
                  loading={loading}
                  value={origin}
                  onChange={setOrigin}
                />
                <FreightRouteEnd
                  label="To"
                  verb="goes to"
                  hint="Where it is delivered, e.g. the buyer’s plant."
                  token={token}
                  organizationId={organization.id}
                  choices={located}
                  loading={loading}
                  value={destination}
                  onChange={setDestination}
                />
              </div>
            }
          />
        </CardContent>
      </Card>
    </section>
  );
}
