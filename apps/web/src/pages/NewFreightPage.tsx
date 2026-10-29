import type { FreightDetail, FreightMode } from '@grain/domain';
import { useId, useState } from 'react';

import { BackLink } from '../components/BackLink';
import { Field } from '../components/DirectoryFields';
import { FreightForm } from '../components/FreightForm';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Select } from '../components/ui/select';
import { SegmentedControl } from '../components/ui/segmented-control';
import {
  sendJson,
  type CounterpartyDetail,
  type CounterpartyList,
  type CounterpartySummary,
} from '../lib/api';
import { canEnterFreight, freightPlace } from '../lib/freight';
import { Link, navigate, useSearch } from '../lib/router';
import { useApiResource } from '../lib/useApiResource';
import type { DirectorySession } from './CounterpartiesPage';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface End {
  counterpartyId: string;
  facilityId: string;
}

/**
 * One end of the route: a counterparty, then one of its locations (a specific address, as the
 * owner asked). Only counterparties that are not archived and have a location are offered.
 */
function RouteEnd({
  label,
  hint,
  token,
  choices,
  loading,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  token: string;
  choices: CounterpartySummary[];
  loading: boolean;
  value: End;
  onChange: (next: End) => void;
}) {
  const baseId = useId();
  const chosen = choices.find((item) => item.id === value.counterpartyId);
  const [detail] = useApiResource<CounterpartyDetail>(
    chosen ? `/counterparties/${chosen.id}` : null,
    token,
  );
  const facilities = chosen && detail.status === 'ok' ? detail.data.facilities : [];
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-semibold">{label}</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          id={`${baseId}-counterparty`}
          label={`${label}: company`}
          required
          error={undefined}
          hint={hint}
        >
          <Select
            id={`${baseId}-counterparty`}
            value={chosen ? value.counterpartyId : ''}
            onValueChange={(next) => {
              onChange({ counterpartyId: next, facilityId: '' });
            }}
            placeholder={loading ? 'Loading…' : 'Choose…'}
            options={choices.map((item) => ({ value: item.id, label: item.legalName }))}
          />
        </Field>
        <Field id={`${baseId}-location`} label={`${label}: location`} required error={undefined}>
          <Select
            id={`${baseId}-location`}
            value={value.facilityId}
            disabled={chosen === undefined}
            onValueChange={(next) => {
              onChange({ ...value, facilityId: next });
            }}
            options={facilities.map((facility) => ({
              value: facility.id,
              label: [freightPlace(facility), facility.addressLine]
                .filter((part) => part !== null && part !== '')
                .join(' · '),
            }))}
          />
        </Field>
      </div>
    </fieldset>
  );
}

/**
 * /freight/new: one carrier's rate from one location to another, by truck or rail, with its
 * first terms. `?carrier=<id>` comes from a carrier's page.
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
  const [origin, setOrigin] = useState<End>({ counterpartyId: '', facilityId: '' });
  const [destination, setDestination] = useState<End>({ counterpartyId: '', facilityId: '' });

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
  const carriers = active.filter((item) => item.types.includes('carrier'));
  const located = active.filter((item) => item.facilityCount > 0);
  const chosen = carriers.find((item) => item.id === carrierId);
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
        description="A carrier’s rate from one location to another, as the carrier quoted it. Later changes to the rate or its validity are recorded as new terms; the first terms are kept."
      />
      <Card>
        <CardContent className="pt-4">
          <FreightForm
            initial={{ firmness: 'indicative', rateUnit: 'MT' }}
            submitLabel="Save freight rate"
            busyLabel="Saving…"
            checkBefore={() =>
              chosen === undefined
                ? 'Choose the carrier that quoted the rate.'
                : origin.facilityId === ''
                  ? 'Choose the location the freight leaves from.'
                  : destination.facilityId === ''
                    ? 'Choose the location the freight goes to.'
                    : origin.facilityId === destination.facilityId
                      ? 'A route goes from one location to another; choose two different locations.'
                      : null
            }
            onSubmit={async (values) => {
              const created = await sendJson<FreightDetail>('/freight-quotes', token, 'POST', {
                organizationId: organization.id,
                carrierId,
                originFacilityId: origin.facilityId,
                destinationFacilityId: destination.facilityId,
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
                  <legend className="mb-1 text-sm font-semibold">Carrier and mode</legend>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field
                      id={`${baseId}-carrier`}
                      label="Carrier"
                      required
                      error={undefined}
                      hint={
                        list.status === 'ok' && carriers.length === 0
                          ? 'No carriers yet; add one under Counterparties, marked as a carrier.'
                          : 'Counterparties marked as carriers.'
                      }
                    >
                      <Select
                        id={`${baseId}-carrier`}
                        value={chosen ? carrierId : ''}
                        onValueChange={setCarrierId}
                        placeholder={loading ? 'Loading…' : 'Choose…'}
                        options={carriers.map((item) => ({
                          value: item.id,
                          label: item.legalName,
                        }))}
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
                <RouteEnd
                  label="From"
                  hint="Where the grain is picked up, e.g. the seller’s elevator."
                  token={token}
                  choices={located}
                  loading={loading}
                  value={origin}
                  onChange={setOrigin}
                />
                <RouteEnd
                  label="To"
                  hint="Where it is delivered, e.g. the buyer’s plant."
                  token={token}
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
