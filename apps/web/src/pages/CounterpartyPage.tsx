import { inspectPng, MAX_LOGO_DIMENSION } from '@grain/domain';
import { ImageUp } from 'lucide-react';
import { useState, type ChangeEvent, type ReactNode } from 'react';

import { BackLink } from '../components/BackLink';
import { CounterpartyLogo } from '../components/CounterpartyLogo';
import { RealDataNote } from '../components/RealDataNote';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { FileButton } from '../components/ui/file-button';
import { VerificationBadge } from '../components/VerificationBadge';
import { apiFetch, ApiError, type CounterpartyDetail, type Facility } from '../lib/api';
import {
  canEditDirectory,
  countryName,
  facilityTypeLabel,
  sourceLabel,
  typeLabel,
} from '../lib/directory';
import { formatUtc } from '../lib/format';
import { useApiResource } from '../lib/useApiResource';
import type { DirectorySession } from './CounterpartiesPage';

const PNG_PROBLEMS = {
  TOO_LARGE: 'The logo must be 512 KB or smaller.',
  NOT_PNG: 'The file is not a PNG image. Export the logo as PNG and try again.',
  BAD_DIMENSIONS: `The logo must be at most ${String(MAX_LOGO_DIMENSION)} pixels wide and high.`,
} as const;

function LogoUpload({
  counterpartyId,
  token,
  onUploaded,
}: {
  counterpartyId: string;
  token: string;
  onUploaded: () => void;
}) {
  const [state, setState] = useState<
    { kind: 'idle' | 'saving' | 'saved' } | { kind: 'error'; message: string }
  >({
    kind: 'idle',
  });

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = await inspectPng(bytes);
    if (!check.ok) {
      setState({ kind: 'error', message: PNG_PROBLEMS[check.reason] });
      return;
    }
    setState({ kind: 'saving' });
    try {
      await apiFetch(`/counterparties/${counterpartyId}/logo`, token, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: bytes,
      });
      setState({ kind: 'saved' });
      onUploaded();
    } catch (error) {
      setState({
        kind: 'error',
        message: error instanceof ApiError ? error.message : 'The logo could not be saved.',
      });
    }
  }

  return (
    <div className="flex flex-col gap-1 text-sm">
      <FileButton
        accept="image/png"
        size="sm"
        disabled={state.kind === 'saving'}
        onChange={(event) => void upload(event)}
      >
        <ImageUp aria-hidden="true" />
        {state.kind === 'saving' ? 'Uploading…' : 'Upload PNG logo'}
      </FileButton>
      <p className="text-xs text-muted-foreground">PNG only, up to 512 KB.</p>
      {state.kind === 'saved' && (
        <p role="status" className="text-xs text-success">
          Logo saved.
        </p>
      )}
      {state.kind === 'error' && (
        <p role="alert" className="text-xs text-danger">
          {state.message}
        </p>
      )}
    </div>
  );
}

function address(facility: Facility): string {
  const parts = [
    facility.addressLine,
    facility.city,
    [facility.region, facility.postalCode].filter(Boolean).join(' '),
    countryName(facility.country),
  ];
  return parts.filter((part) => part !== null && part !== '').join(', ');
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

/** /counterparties/:id: one counterparty with its contacts and locations. */
export function CounterpartyPage({ session, id }: { session: DirectorySession; id: string }) {
  const { token, organization } = session;
  const [resource, reload] = useApiResource<CounterpartyDetail>(`/counterparties/${id}`, token);
  const editor = canEditDirectory(organization.role);

  return (
    <section aria-labelledby="counterparty-heading" className="flex flex-col gap-4">
      <BackLink href="/counterparties">All counterparties</BackLink>
      <RealDataNote organization={organization.name} />

      {resource.status === 'loading' && <p className="text-sm text-muted-foreground">Loading…</p>}
      {resource.status === 'error' && (
        <p role="alert" className="text-sm text-danger">
          {resource.error.status === 404
            ? 'This counterparty does not exist or is not in your organization.'
            : `Could not load the counterparty: ${resource.error.message}`}
        </p>
      )}
      {resource.status === 'ok' && (
        <>
          <Card className="flex flex-wrap items-start gap-4 p-4">
            <CounterpartyLogo
              counterpartyId={resource.data.id}
              name={resource.data.legalName}
              sha256={resource.data.logoSha256}
              token={token}
              size="lg"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <h1 id="counterparty-heading" className="text-2xl font-semibold tracking-tight">
                {resource.data.legalName}
              </h1>
              {resource.data.tradingName && (
                <p className="text-sm text-muted-foreground">
                  Trading as {resource.data.tradingName}
                </p>
              )}
              <VerificationBadge status={resource.data.verificationStatus} />
              {editor && (
                <LogoUpload counterpartyId={resource.data.id} token={token} onUploaded={reload} />
              )}
            </div>
          </Card>

          <Card asChild>
            <dl className="grid grid-cols-1 gap-4 p-4 text-sm sm:grid-cols-2">
              <Field label="Type">{resource.data.types.map(typeLabel).join(', ')}</Field>
              <Field label="Country">{countryName(resource.data.primaryCountry)}</Field>
              <Field label="Source">{sourceLabel(resource.data.source)}</Field>
              <Field label="Added">{formatUtc(resource.data.createdAt)}</Field>
              {resource.data.notes && (
                <div className="sm:col-span-2">
                  <Field label="Notes">{resource.data.notes}</Field>
                </div>
              )}
            </dl>
          </Card>

          <Card asChild>
            <section aria-labelledby="contacts-heading">
              <CardHeader>
                <CardTitle id="contacts-heading">
                  Contacts ({resource.data.contacts.length})
                </CardTitle>
              </CardHeader>
              {resource.data.contacts.length === 0 ? (
                <p className="px-4 py-4 text-sm text-muted-foreground">No contacts recorded.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {resource.data.contacts.map((contact) => (
                    <li key={contact.id} className="flex flex-col gap-0.5 px-4 py-3">
                      <span className="font-medium">{contact.name}</span>
                      {contact.role && (
                        <span className="text-muted-foreground">{contact.role}</span>
                      )}
                      {contact.email && (
                        <a
                          href={`mailto:${contact.email}`}
                          className="w-fit underline underline-offset-4"
                        >
                          {contact.email}
                        </a>
                      )}
                      {contact.phone && (
                        <a
                          href={`tel:${contact.phone.replace(/[^0-9+]/g, '')}`}
                          className="w-fit underline underline-offset-4"
                        >
                          {contact.phone}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </Card>

          <Card asChild>
            <section aria-labelledby="locations-heading">
              <CardHeader>
                <CardTitle id="locations-heading">
                  Locations ({resource.data.facilities.length})
                </CardTitle>
              </CardHeader>
              {resource.data.facilities.length === 0 ? (
                <p className="px-4 py-4 text-sm text-muted-foreground">No locations recorded.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {resource.data.facilities.map((facility) => (
                    <li key={facility.id} className="flex flex-col gap-0.5 px-4 py-3">
                      <span className="font-medium">
                        {facility.name ?? facilityTypeLabel(facility.facilityType) ?? 'Location'}
                        {facility.name && facility.facilityType && (
                          <span className="font-normal text-muted-foreground">
                            {' '}
                            · {facilityTypeLabel(facility.facilityType)}
                          </span>
                        )}
                      </span>
                      <span>{address(facility)}</span>
                      {facility.latitude && facility.longitude && (
                        <span className="text-xs text-muted-foreground">
                          {facility.latitude}, {facility.longitude} ·{' '}
                          {facility.locationPrecision === 'exact'
                            ? 'exact location'
                            : 'approximate location'}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </Card>
        </>
      )}
    </section>
  );
}
