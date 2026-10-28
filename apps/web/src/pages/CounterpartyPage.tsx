import {
  normalizeCountry,
  parseContactFields,
  parseCounterpartyFields,
  parseFacilityFields,
  type FieldIssue,
} from '@grain/domain';
import { Archive, ArchiveRestore, ImageUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type ChangeEvent, type SyntheticEvent, type ReactNode } from 'react';

import { BackLink } from '../components/BackLink';
import { CounterpartyLogo } from '../components/CounterpartyLogo';
import {
  CompanyFields,
  ContactFields,
  FormIssues,
  LocationFields,
  type FieldsProps,
  type FormValues,
} from '../components/DirectoryFields';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Callout } from '../components/ui/callout';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { FileButton } from '../components/ui/file-button';
import { VerificationBadge } from '../components/VerificationBadge';
import {
  apiFetch,
  ApiError,
  fieldIssues,
  sendJson,
  type Contact,
  type CounterpartyDetail,
  type Facility,
} from '../lib/api';
import {
  canEditDirectory,
  coordinatesSourceLabel,
  countryName,
  facilityTypeLabel,
  sourceLabel,
  typeLabel,
} from '../lib/directory';
import { formatUtc } from '../lib/format';
import { logoAsPng } from '../lib/logoImage';
import { useApiResource } from '../lib/useApiResource';
import type { DirectorySession } from './CounterpartiesPage';

/** Uploads a PNG or JPG logo (a JPG is saved as a PNG). */
function LogoUpload({
  counterpartyId,
  token,
  label,
  onUploaded,
}: {
  counterpartyId: string;
  token: string;
  label: string;
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
    setState({ kind: 'saving' });
    const logo = await logoAsPng(file);
    if (!logo.ok) {
      setState({ kind: 'error', message: logo.message });
      return;
    }
    const bytes = logo.png;
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
        accept="image/png,image/jpeg,.png,.jpg,.jpeg"
        size="sm"
        disabled={state.kind === 'saving'}
        onChange={(event) => void upload(event)}
      >
        <ImageUp aria-hidden="true" />
        {state.kind === 'saving' ? 'Uploading…' : label}
      </FileButton>
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

// Form values from what the API returned, for the edit forms.
function companyValues(detail: CounterpartyDetail): FormValues {
  return {
    legalName: detail.legalName,
    tradingName: detail.tradingName ?? '',
    types: detail.types.join(','),
    country: detail.primaryCountry,
    verificationStatus: detail.verificationStatus,
    notes: detail.notes ?? '',
  };
}

function contactValues(contact: Contact | null): FormValues {
  return {
    contactName: contact?.name ?? '',
    contactRole: contact?.role ?? '',
    contactEmail: contact?.email ?? '',
    contactPhone: contact?.phone ?? '',
  };
}

function locationValues(facility: Facility | null, country: string): FormValues {
  return {
    facilityName: facility?.name ?? '',
    facilityType: facility?.facilityType ?? '',
    addressLine: facility?.addressLine ?? '',
    city: facility?.city ?? '',
    region: facility?.region ?? '',
    postalCode: facility?.postalCode ?? '',
    facilityCountry: facility?.country ?? country,
    latitude: facility?.latitude ?? '',
    longitude: facility?.longitude ?? '',
    locationPrecision: facility?.locationPrecision ?? '',
  };
}

type Check = (values: FormValues) => FieldIssue[];

/**
 * A form that checks its values with the same rules as the API, sends them, and on success
 * reports back so the page reloads. A record someone else changed meanwhile is never
 * overwritten: the API refuses it, and the form offers to load the latest version.
 */
function EditForm({
  label,
  initial,
  check,
  save,
  submitLabel,
  onSaved,
  onCancel,
  onReload,
  children,
}: {
  label: string;
  initial: FormValues;
  check: Check;
  save: (values: FormValues) => Promise<unknown>;
  submitLabel: string;
  onSaved: () => void;
  onCancel: () => void;
  onReload: () => void;
  children: (fields: FieldsProps) => ReactNode;
}) {
  const [values, setValues] = useState(initial);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; stale: boolean } | null>(null);

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    setError(null);
    const problems = check(values);
    setIssues(problems);
    if (problems.length > 0) return;
    setBusy(true);
    try {
      await save(values);
      onSaved();
    } catch (failure) {
      setIssues(fieldIssues(failure));
      setError({
        message: failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.',
        stale: failure instanceof ApiError && failure.code === 'RECORD_CHANGED',
      });
      setBusy(false);
    }
  }

  return (
    <form
      aria-label={label}
      noValidate
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-4 border-b bg-muted/40 px-4 py-4 last:border-b-0"
    >
      {children({
        values,
        issues,
        disabled: busy,
        onChange: (changes) => {
          setValues((current) => ({ ...current, ...changes }));
        },
      })}
      <FormIssues issues={issues} />
      {error && issues.length === 0 && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
          <span>{error.message}</span>
          {error.stale && (
            <Button size="sm" variant="outline" onClick={onReload}>
              Load the latest version
            </Button>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** "Remove …?" with a confirm and a cancel button, in place of the item's actions. */
function ConfirmRemove({
  what,
  onConfirm,
  onCancel,
}: {
  what: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div role="group" aria-label={`Remove ${what}`} className="flex flex-col gap-2 text-sm">
      <p>
        Remove <strong>{what}</strong>? This cannot be undone here; the audit trail keeps who
        removed it and when.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="danger"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            onConfirm().catch((failure: unknown) => {
              setError(
                failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.',
              );
              setBusy(false);
            });
          }}
        >
          {busy ? 'Removing…' : 'Remove'}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>
          Keep it
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

type Editing =
  | { kind: 'details' }
  | { kind: 'contact'; id: string | null }
  | { kind: 'location'; id: string | null }
  | { kind: 'remove-contact'; id: string }
  | { kind: 'remove-location'; id: string }
  | { kind: 'archive' }
  | null;

/** The problems a form check found; none when it passed. */
const issuesOf = (result: { status: 'ok' } | { status: 'invalid'; issues: FieldIssue[] }) =>
  result.status === 'invalid' ? result.issues : [];

function locationName(facility: Facility): string {
  return (
    facility.name ?? facilityTypeLabel(facility.facilityType) ?? facility.city ?? 'this location'
  );
}

/** /counterparties/:id: one counterparty with its contacts and locations; editors change them here. */
export function CounterpartyPage({ session, id }: { session: DirectorySession; id: string }) {
  const { token, organization } = session;
  const [resource, reload] = useApiResource<CounterpartyDetail>(`/counterparties/${id}`, token);
  const [editing, setEditing] = useState<Editing>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const editor = canEditDirectory(organization.role);
  const path = `/counterparties/${id}`;

  function done(message: string) {
    setEditing(null);
    setNotice(message);
    reload();
  }

  function start(next: Editing) {
    setNotice(null);
    setEditing(next);
  }

  function reloadAndClose() {
    setEditing(null);
    setNotice(null);
    reload();
  }

  async function setArchived(archived: boolean) {
    setArchiving(true);
    setArchiveError(null);
    try {
      await sendJson(`${path}/${archived ? 'archive' : 'restore'}`, token, 'POST');
      done(archived ? 'Archived.' : 'Restored.');
    } catch (failure) {
      setArchiveError(
        failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.',
      );
    } finally {
      setArchiving(false);
    }
  }

  return (
    <section aria-labelledby="counterparty-heading" className="flex flex-col gap-4">
      <BackLink href="/counterparties">All counterparties</BackLink>

      {resource.status === 'loading' && <p className="text-sm text-muted-foreground">Loading…</p>}
      {resource.status === 'error' && (
        <p role="alert" className="text-sm text-danger">
          {resource.error.status === 404
            ? 'This counterparty does not exist.'
            : `Could not load the counterparty: ${resource.error.message}`}
        </p>
      )}
      {resource.status === 'ok' &&
        (() => {
          const detail = resource.data;
          const archived = detail.archivedAt !== null;
          const canChange = editor && !archived;
          const country = normalizeCountry(detail.primaryCountry) ?? 'CA';
          return (
            <>
              <p role="status" className="sr-only">
                {notice}
              </p>
              {archived && (
                <Callout variant="warning" icon={Archive}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p>
                      <strong>Archived</strong> on {formatUtc(detail.archivedAt ?? '')}. It is left
                      off the list and the map, and cannot be changed until it is restored.
                    </p>
                    {editor && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={archiving}
                        onClick={() => void setArchived(false)}
                      >
                        <ArchiveRestore aria-hidden="true" />
                        Restore
                      </Button>
                    )}
                  </div>
                </Callout>
              )}
              {archiveError && (
                <p role="alert" className="text-sm text-danger">
                  {archiveError}
                </p>
              )}

              <Card className="flex flex-wrap items-start gap-4 p-4">
                <CounterpartyLogo
                  counterpartyId={detail.id}
                  name={detail.legalName}
                  sha256={detail.logoSha256}
                  token={token}
                  size="lg"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <h1 id="counterparty-heading" className="text-2xl font-semibold tracking-tight">
                    {detail.legalName}
                  </h1>
                  {detail.tradingName && (
                    <p className="text-sm text-muted-foreground">Trading as {detail.tradingName}</p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    <VerificationBadge status={detail.verificationStatus} />
                    {archived && <Badge>Archived</Badge>}
                  </div>
                  {/* With a logo already, it is changed under Edit details. */}
                  {canChange && detail.logoSha256 === null && (
                    <LogoUpload
                      counterpartyId={detail.id}
                      token={token}
                      label="Upload logo"
                      onUploaded={reload}
                    />
                  )}
                </div>
                {canChange && editing?.kind !== 'archive' && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        start({ kind: 'details' });
                      }}
                    >
                      <Pencil aria-hidden="true" />
                      Edit details
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        start({ kind: 'archive' });
                      }}
                    >
                      <Archive aria-hidden="true" />
                      Archive
                    </Button>
                  </div>
                )}
                {canChange && editing?.kind === 'archive' && (
                  <div
                    role="group"
                    aria-label="Archive this counterparty"
                    className="flex w-full flex-col gap-2 rounded-control border bg-muted/40 p-3 text-sm"
                  >
                    <p>
                      Archive <strong>{detail.legalName}</strong>? It leaves the list and the map,
                      and nothing about it is deleted. You can restore it at any time.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={archiving} onClick={() => void setArchived(true)}>
                        {archiving ? 'Archiving…' : 'Archive'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditing(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </Card>

              {editing?.kind === 'details' ? (
                <Card className="overflow-hidden">
                  {detail.logoSha256 !== null && (
                    <div className="border-b bg-muted/40 px-4 pt-4 pb-3">
                      <LogoUpload
                        counterpartyId={detail.id}
                        token={token}
                        label="Change logo"
                        onUploaded={reload}
                      />
                    </div>
                  )}
                  <EditForm
                    label="Edit details"
                    initial={companyValues(detail)}
                    check={(values) => issuesOf(parseCounterpartyFields(values))}
                    save={(values) =>
                      sendJson(path, token, 'PATCH', { version: detail.version, values })
                    }
                    submitLabel="Save details"
                    onSaved={() => {
                      done('Details saved.');
                    }}
                    onCancel={() => {
                      setEditing(null);
                    }}
                    onReload={reloadAndClose}
                  >
                    {(fields) => <CompanyFields {...fields} />}
                  </EditForm>
                </Card>
              ) : (
                <Card asChild>
                  <dl className="grid grid-cols-1 gap-4 p-4 text-sm sm:grid-cols-2">
                    <Field label="Type">{detail.types.map(typeLabel).join(', ')}</Field>
                    <Field label="Country">{countryName(detail.primaryCountry)}</Field>
                    <Field label="Source">{sourceLabel(detail.source)}</Field>
                    <Field label="Added">{formatUtc(detail.createdAt)}</Field>
                    {detail.notes && (
                      <div className="sm:col-span-2">
                        <Field label="Notes">
                          <span className="whitespace-pre-line">{detail.notes}</span>
                        </Field>
                      </div>
                    )}
                  </dl>
                </Card>
              )}

              <Card asChild>
                <section aria-labelledby="contacts-heading">
                  <CardHeader>
                    <CardTitle id="contacts-heading">Contacts ({detail.contacts.length})</CardTitle>
                    {canChange && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          start({ kind: 'contact', id: null });
                        }}
                      >
                        <Plus aria-hidden="true" />
                        Add contact
                      </Button>
                    )}
                  </CardHeader>
                  {editing?.kind === 'contact' && editing.id === null && (
                    <EditForm
                      label="New contact"
                      initial={contactValues(null)}
                      check={(values) => issuesOf(parseContactFields(values))}
                      save={(values) => sendJson(`${path}/contacts`, token, 'POST', { values })}
                      submitLabel="Add contact"
                      onSaved={() => {
                        done('Contact added.');
                      }}
                      onCancel={() => {
                        setEditing(null);
                      }}
                      onReload={reloadAndClose}
                    >
                      {(fields) => <ContactFields {...fields} required />}
                    </EditForm>
                  )}
                  {detail.contacts.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-muted-foreground">No contacts recorded.</p>
                  ) : (
                    <ul className="divide-y text-sm">
                      {detail.contacts.map((contact) =>
                        editing?.kind === 'contact' && editing.id === contact.id ? (
                          <li key={contact.id}>
                            <EditForm
                              label={`Edit ${contact.name}`}
                              initial={contactValues(contact)}
                              check={(values) => issuesOf(parseContactFields(values))}
                              save={(values) =>
                                sendJson(`${path}/contacts/${contact.id}`, token, 'PATCH', {
                                  version: contact.version,
                                  values,
                                })
                              }
                              submitLabel="Save contact"
                              onSaved={() => {
                                done('Contact saved.');
                              }}
                              onCancel={() => {
                                setEditing(null);
                              }}
                              onReload={reloadAndClose}
                            >
                              {(fields) => <ContactFields {...fields} required />}
                            </EditForm>
                          </li>
                        ) : (
                          <li
                            key={contact.id}
                            className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
                          >
                            <div className="flex min-w-0 flex-col gap-0.5">
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
                            </div>
                            {canChange &&
                              (editing?.kind === 'remove-contact' && editing.id === contact.id ? (
                                <ConfirmRemove
                                  what={contact.name}
                                  onConfirm={async () => {
                                    await sendJson(
                                      `${path}/contacts/${contact.id}`,
                                      token,
                                      'DELETE',
                                    );
                                    done('Contact removed.');
                                  }}
                                  onCancel={() => {
                                    setEditing(null);
                                  }}
                                />
                              ) : (
                                <ItemActions
                                  name={contact.name}
                                  onEdit={() => {
                                    start({ kind: 'contact', id: contact.id });
                                  }}
                                  onRemove={() => {
                                    start({ kind: 'remove-contact', id: contact.id });
                                  }}
                                />
                              ))}
                          </li>
                        ),
                      )}
                    </ul>
                  )}
                </section>
              </Card>

              <Card asChild>
                <section aria-labelledby="locations-heading">
                  <CardHeader>
                    <CardTitle id="locations-heading">
                      Locations ({detail.facilities.length})
                    </CardTitle>
                    {canChange && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          start({ kind: 'location', id: null });
                        }}
                      >
                        <Plus aria-hidden="true" />
                        Add location
                      </Button>
                    )}
                  </CardHeader>
                  {editing?.kind === 'location' && editing.id === null && (
                    <EditForm
                      label="New location"
                      initial={locationValues(null, country)}
                      check={(values) => issuesOf(parseFacilityFields(values, country))}
                      save={(values) => sendJson(`${path}/facilities`, token, 'POST', { values })}
                      submitLabel="Add location"
                      onSaved={() => {
                        done('Location added.');
                      }}
                      onCancel={() => {
                        setEditing(null);
                      }}
                      onReload={reloadAndClose}
                    >
                      {(fields) => <LocationFields {...fields} />}
                    </EditForm>
                  )}
                  {detail.facilities.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-muted-foreground">
                      No locations recorded.
                    </p>
                  ) : (
                    <ul className="divide-y text-sm">
                      {detail.facilities.map((facility) =>
                        editing?.kind === 'location' && editing.id === facility.id ? (
                          <li key={facility.id}>
                            <EditForm
                              label={`Edit ${locationName(facility)}`}
                              initial={locationValues(facility, country)}
                              check={(values) => issuesOf(parseFacilityFields(values, country))}
                              save={(values) =>
                                sendJson(`${path}/facilities/${facility.id}`, token, 'PATCH', {
                                  version: facility.version,
                                  values,
                                })
                              }
                              submitLabel="Save location"
                              onSaved={() => {
                                done('Location saved.');
                              }}
                              onCancel={() => {
                                setEditing(null);
                              }}
                              onReload={reloadAndClose}
                            >
                              {(fields) => <LocationFields {...fields} />}
                            </EditForm>
                          </li>
                        ) : (
                          <li
                            key={facility.id}
                            className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
                          >
                            <div className="flex min-w-0 flex-col gap-0.5">
                              <span className="font-medium">
                                {facility.name ??
                                  facilityTypeLabel(facility.facilityType) ??
                                  'Location'}
                                {facility.name && facility.facilityType && (
                                  <span className="font-normal text-muted-foreground">
                                    {' '}
                                    · {facilityTypeLabel(facility.facilityType)}
                                  </span>
                                )}
                              </span>
                              <span>{address(facility)}</span>
                              {facility.latitude && facility.longitude ? (
                                <span className="text-xs text-muted-foreground">
                                  {facility.latitude}, {facility.longitude} ·{' '}
                                  {facility.locationPrecision === 'exact'
                                    ? 'exact location'
                                    : 'approximate location'}
                                  {coordinatesSourceLabel(facility.geocodingSource) &&
                                    ` · ${coordinatesSourceLabel(facility.geocodingSource) ?? ''}`}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  No coordinates yet
                                </span>
                              )}
                            </div>
                            {canChange &&
                              (editing?.kind === 'remove-location' && editing.id === facility.id ? (
                                <ConfirmRemove
                                  what={locationName(facility)}
                                  onConfirm={async () => {
                                    await sendJson(
                                      `${path}/facilities/${facility.id}`,
                                      token,
                                      'DELETE',
                                    );
                                    done('Location removed.');
                                  }}
                                  onCancel={() => {
                                    setEditing(null);
                                  }}
                                />
                              ) : (
                                <ItemActions
                                  name={locationName(facility)}
                                  onEdit={() => {
                                    start({ kind: 'location', id: facility.id });
                                  }}
                                  onRemove={() => {
                                    start({ kind: 'remove-location', id: facility.id });
                                  }}
                                />
                              ))}
                          </li>
                        ),
                      )}
                    </ul>
                  )}
                </section>
              </Card>
            </>
          );
        })()}
    </section>
  );
}

/** Edit and Remove for one contact or location, named for screen readers. */
function ItemActions({
  name,
  onEdit,
  onRemove,
}: {
  name: string;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex gap-1">
      <Button size="sm" variant="ghost" aria-label={`Edit ${name}`} onClick={onEdit}>
        <Pencil aria-hidden="true" />
        Edit
      </Button>
      <Button size="sm" variant="ghost" aria-label={`Remove ${name}`} onClick={onRemove}>
        <Trash2 aria-hidden="true" />
        Remove
      </Button>
    </div>
  );
}
