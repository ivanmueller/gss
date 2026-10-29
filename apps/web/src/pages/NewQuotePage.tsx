import {
  QUOTE_SIDE_LABELS,
  SIDE_COUNTERPARTY_TYPES,
  type Commodity,
  type QuoteDetail,
  type QuoteSide,
} from '@grain/domain';
import { useId, useState } from 'react';

import { BackLink } from '../components/BackLink';
import { Field } from '../components/DirectoryFields';
import { PageHeader } from '../components/PageHeader';
import { QuoteForm } from '../components/QuoteForm';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Select } from '../components/ui/select';
import { SegmentedControl } from '../components/ui/segmented-control';
import { sendJson, type CounterpartyDetail, type CounterpartyList } from '../lib/api';
import { countryName } from '../lib/directory';
import { canEnterQuotes } from '../lib/quotes';
import { Link, navigate, useSearch } from '../lib/router';
import { useApiResource } from '../lib/useApiResource';
import type { DirectorySession } from './CounterpartiesPage';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function locationLabel(facility: CounterpartyDetail['facilities'][number]): string {
  const parts = [facility.name, facility.city, facility.region ?? countryName(facility.country)];
  return parts.filter((part) => part !== null && part !== '').join(', ') || 'Unnamed location';
}

/**
 * /quotes/new: a bid or offer from one counterparty, optionally at one of its locations, with
 * its first terms. `?counterparty=<id>&side=bid` comes from a counterparty's page.
 */
export function NewQuotePage({ session }: { session: DirectorySession }) {
  const { token, organization } = session;
  const baseId = useId();
  const params = new URLSearchParams(useSearch());
  const sideParam = params.get('side');
  const counterpartyParam = params.get('counterparty');
  const [side, setSide] = useState<QuoteSide>(sideParam === 'offer' ? 'offer' : 'bid');
  const [counterpartyId, setCounterpartyId] = useState(
    counterpartyParam !== null && UUID.test(counterpartyParam) ? counterpartyParam : '',
  );
  const [facilityId, setFacilityId] = useState('');
  const [commodity, setCommodity] = useState('');

  const [list] = useApiResource<CounterpartyList>(
    `/counterparties?organization_id=${organization.id}`,
    token,
  );
  const [commodities] = useApiResource<{ commodities: Commodity[] }>('/commodities', token);
  const [detail] = useApiResource<CounterpartyDetail>(
    counterpartyId === '' ? null : `/counterparties/${counterpartyId}`,
    token,
  );

  if (!canEnterQuotes(organization.role)) {
    return (
      <p role="alert" className="text-sm">
        Only traders and admins of {organization.name} enter bids and offers.
      </p>
    );
  }

  const wanted = SIDE_COUNTERPARTY_TYPES[side];
  // Counterparties that can quote this side and are not archived.
  const choices =
    list.status === 'ok'
      ? list.data.counterparties.filter(
          (item) =>
            item.archivedAt === null && item.types.some((type) => wanted.includes(type as never)),
        )
      : [];
  const chosen = choices.find((item) => item.id === counterpartyId);
  const facilities = detail.status === 'ok' ? detail.data.facilities : [];
  const id = (suffix: string) => `${baseId}-${suffix}`;
  const sideWord = QUOTE_SIDE_LABELS[side].toLowerCase();
  const back = counterpartyParam && chosen ? `/counterparties/${chosen.id}` : '/quotes';

  return (
    <section aria-labelledby="new-quote-heading" className="flex flex-col gap-4">
      <PageHeader
        id="new-quote-heading"
        back={
          <BackLink href={back}>
            {back === '/quotes' ? 'All bids and offers' : (chosen?.legalName ?? 'Back')}
          </BackLink>
        }
        title={`New ${sideWord}`}
        description="A bid comes from a buyer, an offer from a seller. Later changes to price, quantity or timing are recorded as new terms; the first terms are kept."
      />
      <Card>
        <CardContent className="pt-4">
          <QuoteForm
            initial={{ firmness: 'indicative', priceUnit: 'MT' }}
            submitLabel={`Save ${sideWord}`}
            busyLabel="Saving…"
            checkBefore={() =>
              chosen === undefined
                ? `Choose the counterparty the ${sideWord} comes from.`
                : commodity === ''
                  ? 'Choose a commodity.'
                  : null
            }
            onSubmit={async (values) => {
              const created = await sendJson<QuoteDetail>('/quotes', token, 'POST', {
                organizationId: organization.id,
                counterpartyId,
                facilityId: facilityId === '' ? null : facilityId,
                side,
                commodity,
                values,
              });
              navigate(`/quotes/${created.id}`);
            }}
            onCancel={
              <Button asChild variant="outline">
                <Link href={back}>Cancel</Link>
              </Button>
            }
            before={
              <fieldset className="flex flex-col gap-3">
                <legend className="mb-1 text-sm font-semibold">What and who</legend>
                <SegmentedControl
                  label="Bid or offer"
                  options={[
                    { value: 'bid', label: 'Bid · a buyer buys' },
                    { value: 'offer', label: 'Offer · a seller sells' },
                  ]}
                  value={side}
                  onChange={(next) => {
                    setSide(next);
                  }}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field
                    id={id('counterparty')}
                    label="Counterparty"
                    required
                    error={undefined}
                    hint={
                      list.status === 'ok' && choices.length === 0
                        ? `No ${side === 'bid' ? 'buyers' : 'sellers'} or brokers yet; add one under Counterparties.`
                        : side === 'bid'
                          ? 'Buyers and brokers.'
                          : 'Sellers and brokers.'
                    }
                  >
                    <Select
                      id={id('counterparty')}
                      value={chosen ? counterpartyId : ''}
                      onValueChange={(next) => {
                        setCounterpartyId(next);
                        setFacilityId('');
                      }}
                      placeholder={list.status === 'loading' ? 'Loading…' : 'Choose…'}
                      options={choices.map((item) => ({ value: item.id, label: item.legalName }))}
                    />
                  </Field>
                  <Field
                    id={id('location')}
                    label="Location"
                    error={undefined}
                    hint="Optional: where the grain is bought or sold."
                  >
                    <Select
                      id={id('location')}
                      value={facilityId}
                      disabled={chosen === undefined}
                      onValueChange={setFacilityId}
                      options={[
                        { value: '', label: 'No particular location' },
                        ...(chosen
                          ? facilities.map((facility) => ({
                              value: facility.id,
                              label: locationLabel(facility),
                            }))
                          : []),
                      ]}
                    />
                  </Field>
                  <Field id={id('commodity')} label="Commodity" required error={undefined}>
                    <Select
                      id={id('commodity')}
                      value={commodity}
                      onValueChange={setCommodity}
                      options={
                        commodities.status === 'ok'
                          ? commodities.data.commodities.map((item) => ({
                              value: item.code,
                              label: item.name,
                            }))
                          : []
                      }
                    />
                  </Field>
                </div>
              </fieldset>
            }
          />
        </CardContent>
      </Card>
    </section>
  );
}
