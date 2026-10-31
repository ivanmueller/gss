import {
  CONTACT_CHANNEL_LABELS,
  formatAlberta,
  normalizeCountry,
  parseContactFields,
  parseCounterpartyFields,
  parseFacilityFields,
  MARKET_LABELS,
  TRANSPORT_ACCESS_LABELS,
  type FieldIssue,
  type Market,
  type TransportAccess,
} from '@grain/domain';
import {
  Archive,
  ArchiveRestore,
  CalendarPlus,
  ClipboardPaste,
  Ellipsis,
  ImageUp,
  Layers,
  Mail,
  MapPin,
  MessageSquarePlus,
  PawPrint,
  Pencil,
  Phone,
  Plus,
  Star,
  StarOff,
  TrainFront,
  Trash2,
  Truck,
} from 'lucide-react';
import {
  useMemo,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

import { BackLink } from '../components/BackLink';
import {
  ContactHistoryCard,
  CrmMessage,
  FollowUpsCard,
  lastContact,
  nextFollowUp,
  useCounterpartyCrm,
  type CounterpartyCrmState,
} from '../components/CounterpartyCrm';
import { CounterpartyCommodities } from '../components/CounterpartyCommodities';
import { CounterpartyFreight } from '../components/CounterpartyFreight';
import { CounterpartyLocationsMap } from '../components/CounterpartyLocationsMap';
import { CounterpartyLogo } from '../components/CounterpartyLogo';
import {
  CounterpartyQuotesCard,
  quoteSides,
  useCounterpartyQuotes,
} from '../components/CounterpartyQuotes';
import { CounterpartyWebsite } from '../components/CounterpartyWebsite';
import {
  CompanyFields,
  ContactFields,
  FormIssues,
  LocationFields,
  splitAccess,
  type FieldsProps,
  type FormValues,
} from '../components/DirectoryFields';
import { FindCoordinates } from '../components/FindCoordinates';
import { Badge, type BadgeVariant } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Callout } from '../components/ui/callout';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent } from '../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
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
import { dueState } from '../lib/crm';
import {
  canDeleteCounterparties,
  canEditDirectory,
  countryName,
  facilityTypeLabel,
  sourceLabel,
  typeLabel,
} from '../lib/directory';
import { logoAsPng } from '../lib/logoImage';
import { canEnterQuotes } from '../lib/quotes';
import { Link, navigate } from '../lib/router';
import { forgetApiAnswers, useApiResource } from '../lib/useApiResource';
import { useMediaQuery } from '../lib/useMediaQuery';
import { cn } from '../lib/utils';
import type { DirectorySession } from './CounterpartiesPage';

/**
 * Uploads a PNG, JPG or WebP logo (JPG and WebP are saved as PNG), chosen from a file or
 * pasted: on a website, right-click the logo → Copy image, then Paste logo here, or Ctrl+V
 * (Cmd+V) on that button (owner's choice, 2026-10-31). The app never fetches the website.
 */
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

  async function upload(file: File) {
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

  function chosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void upload(file);
  }

  /** The copied image, read when the button is clicked (the browser may ask first). */
  async function pasteFromClipboard() {
    // Missing in older browsers and on pages not served over https.
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (typeof clipboard?.read !== 'function') {
      setState({ kind: 'error', message: PASTE_WITH_KEYS });
      return;
    }
    try {
      for (const item of await clipboard.read()) {
        const type = item.types.find((kind) => kind.startsWith('image/'));
        if (type) {
          const blob = await item.getType(type);
          await upload(new File([blob], 'pasted logo', { type }));
          return;
        }
      }
      setState({ kind: 'error', message: NOTHING_COPIED });
    } catch {
      setState({ kind: 'error', message: PASTE_WITH_KEYS });
    }
  }

  /** Ctrl+V or Cmd+V while the button is selected. */
  function pasted(event: ClipboardEvent<HTMLButtonElement>) {
    const file = [...event.clipboardData.files].find((item) => item.type.startsWith('image/'));
    event.preventDefault();
    if (file) void upload(file);
    else setState({ kind: 'error', message: NOTHING_COPIED });
  }

  const saving = state.kind === 'saving';
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex flex-wrap gap-2">
        <FileButton
          accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
          size="sm"
          disabled={saving}
          onChange={chosen}
        >
          <ImageUp aria-hidden="true" />
          {saving ? 'Uploading…' : label}
        </FileButton>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={saving}
          title="On the website, right-click the logo, choose Copy image, then click here."
          onClick={() => void pasteFromClipboard()}
          onPaste={pasted}
        >
          <ClipboardPaste aria-hidden="true" />
          Paste logo
        </Button>
      </div>
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

const NOTHING_COPIED =
  'No copied image found. On the website, right-click the logo, choose Copy image, then paste again.';
const PASTE_WITH_KEYS =
  'This browser did not let the app read the copied image. Click Paste logo, then press Ctrl+V (Cmd+V on a Mac).';

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
    website: detail.website ?? '',
    companyPhone: detail.phone ?? '',
    markets: detail.markets.join(','),
    tier: detail.tier ?? '',
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
    transportAccess: facility?.transportAccess ?? '',
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
  /** After a save, with the values saved. */
  onSaved: (values: FormValues) => void;
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
      onSaved(values);
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
  | { kind: 'delete' }
  | { kind: 'coordinates' }
  | null;

/** The problems a form check found; none when it passed. */
const issuesOf = (result: { status: 'ok' } | { status: 'invalid'; issues: FieldIssue[] }) =>
  result.status === 'invalid' ? result.issues : [];

function locationName(facility: Facility): string {
  return (
    facility.name ?? facilityTypeLabel(facility.facilityType) ?? facility.city ?? 'this location'
  );
}

/** Counterparties that trade grain get the trading layout; a carrier only keeps the plain one. */
export function tradingLayout(types: readonly string[]): boolean {
  return types.some((type) => type !== 'carrier');
}

const TYPE_BADGES: Record<string, BadgeVariant> = { buyer: 'bid', seller: 'offer', broker: 'info' };

/** /counterparties/:id: one counterparty with its contacts and locations; editors change them here. */
export function CounterpartyPage({ session, id }: { session: DirectorySession; id: string }) {
  const [resource, reload] = useApiResource<CounterpartyDetail>(
    `/counterparties/${id}`,
    session.token,
  );

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
      {resource.status === 'ok' && (
        <CounterpartyView session={session} detail={resource.data} reload={reload} />
      )}
    </section>
  );
}

function CounterpartyView({
  session,
  detail,
  reload,
}: {
  session: DirectorySession;
  detail: CounterpartyDetail;
  reload: () => void;
}) {
  const { token, organization } = session;
  const [editing, setEditing] = useState<Editing>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The first logo's upload button goes away once the logo is saved, so the page keeps its
  // "Logo saved." in that spot.
  const [firstLogoSaved, setFirstLogoSaved] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [mainError, setMainError] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const editor = canEditDirectory(organization.role);
  const path = `/counterparties/${detail.id}`;
  const archived = detail.archivedAt !== null;
  const canChange = editor && !archived;
  const country = normalizeCountry(detail.primaryCountry) ?? 'CA';
  const trading = tradingLayout(detail.types);
  const contactNames = useMemo(() => detail.contacts.map((contact) => contact.name), [detail]);
  const crm = useCounterpartyCrm(session, { id: detail.id, archived, contactNames });
  const quotes = useCounterpartyQuotes(session, detail.id);
  // Two columns on a computer screen (Tailwind's `xl`); one, in order of use, below it.
  const wide = useMediaQuery('(min-width: 1280px)', true);

  function done(message: string) {
    setEditing(null);
    setNotice(message);
    reload();
  }

  function start(next: Editing) {
    setNotice(null);
    setFirstLogoSaved(false);
    setMainError(null);
    setEditing(next);
  }

  function reloadAndClose() {
    setEditing(null);
    setNotice(null);
    reload();
  }

  async function setArchived(archive: boolean) {
    setArchiving(true);
    setArchiveError(null);
    try {
      await sendJson(`${path}/${archive ? 'archive' : 'restore'}`, token, 'POST');
      done(archive ? 'Archived.' : 'Restored.');
    } catch (failure) {
      setArchiveError(
        failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.',
      );
    } finally {
      setArchiving(false);
    }
  }

  async function deleteCounterparty() {
    setDeleting(true);
    setDeleteError(null);
    try {
      // 204, with no body to read.
      await apiFetch(path, token, { method: 'DELETE' });
      forgetApiAnswers('/counterparties');
      navigate('/counterparties');
    } catch (failure) {
      setDeleteError(
        failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.',
      );
      setDeleting(false);
    }
  }

  async function setMainContact(contactId: string | null) {
    setMainError(null);
    try {
      await sendJson(`${path}/main-contact`, token, 'PUT', { contactId });
      done(contactId === null ? 'No main contact now.' : 'Main contact saved.');
    } catch (failure) {
      setMainError(
        failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.',
      );
    }
  }

  const logo = (
    <>
      {/* With a logo already, it is changed under Edit details. */}
      {canChange && detail.logoSha256 === null && (
        <LogoUpload
          counterpartyId={detail.id}
          token={token}
          label="Upload logo"
          onUploaded={() => {
            setFirstLogoSaved(true);
            reload();
          }}
        />
      )}
      {canChange && detail.logoSha256 !== null && firstLogoSaved && (
        <p role="status" className="text-xs text-success">
          Logo saved.
        </p>
      )}
    </>
  );

  const archiveConfirm = canChange && editing?.kind === 'archive' && (
    <div
      role="group"
      aria-label="Archive this counterparty"
      className="flex w-full flex-col gap-2 rounded-control border bg-muted/40 p-3 text-sm"
    >
      <p>
        Archive <strong>{detail.legalName}</strong>? It leaves the list and the map, and nothing
        about it is deleted. You can restore it at any time.
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
  );

  const name = (
    <>
      <h1 id="counterparty-heading" className="text-2xl font-semibold tracking-tight">
        {detail.legalName}
      </h1>
    </>
  );

  // A carrier's header: its name, website and the changes it allows, as before.
  const plainHeader = (
    <Card className="flex flex-wrap items-start gap-4 p-4">
      <CounterpartyLogo
        counterpartyId={detail.id}
        name={detail.legalName}
        sha256={detail.logoSha256}
        token={token}
        size="lg"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {name}
        <MarketsAndTier detail={detail} />
        <WebsiteAndPhone detail={detail} />
        <div className="flex flex-wrap gap-1.5">
          <VerificationBadge status={detail.verificationStatus} />
          {archived && <Badge>Archived</Badge>}
        </div>
        {logo}
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
      {archiveConfirm}
    </Card>
  );

  const main = detail.contacts.find((contact) => contact.isMain) ?? null;
  const sides = quoteSides(detail.types);
  const canQuote = canEnterQuotes(organization.role) && !archived;
  const places = [detail.regions.join(', '), countryName(detail.primaryCountry)].filter(Boolean);

  // A buyer's or seller's header: who they are, whom to call, and the day's actions.
  const tradingHeader = (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start gap-4">
        <CounterpartyLogo
          counterpartyId={detail.id}
          name={detail.legalName}
          sha256={detail.logoSha256}
          token={token}
          size="lg"
        />
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1.5">
          {name}
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            {detail.types.map((type) => (
              <Badge key={type} variant={TYPE_BADGES[type] ?? 'neutral'}>
                {typeLabel(type)}
              </Badge>
            ))}
            <VerificationBadge status={detail.verificationStatus} />
            {archived && <Badge>Archived</Badge>}
            <span className="text-muted-foreground">{places.join(' · ')}</span>
          </div>
          <MarketsAndTier detail={detail} />
          <WebsiteAndPhone detail={detail} />
          {logo}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {crm.writer && crm.adding !== 'contact' && (
            <Button
              size="sm"
              onClick={() => {
                crm.startAdding('contact');
              }}
            >
              <MessageSquarePlus aria-hidden="true" />
              Log contact
            </Button>
          )}
          {canQuote &&
            sides.map((side) => (
              <Button key={side} asChild size="sm" variant="outline">
                <Link href={`/quotes/new?counterparty=${detail.id}&side=${side}`}>
                  <Plus aria-hidden="true" />
                  {side === 'bid' ? 'New bid' : 'New offer'}
                </Link>
              </Button>
            ))}
          {crm.canPlan && crm.adding !== 'follow-up' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                crm.startAdding('follow-up');
              }}
            >
              <CalendarPlus aria-hidden="true" />
              Plan follow-up
            </Button>
          )}
          {canChange && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="outline" aria-label="More actions">
                  <Ellipsis aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    start({ kind: 'details' });
                  }}
                >
                  <Pencil aria-hidden="true" />
                  Edit details
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    start({ kind: 'archive' });
                  }}
                >
                  <Archive aria-hidden="true" />
                  Archive
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      <div className="grid gap-x-6 gap-y-3 border-t pt-3 text-sm md:grid-cols-3">
        <MainContact contact={main} hint={canChange && detail.contacts.length > 0} />
        <NextFollowUp crm={crm} />
        <LastContact crm={crm} />
      </div>
      {archiveConfirm}
    </Card>
  );

  const editDetails = editing?.kind === 'details' && (
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
        save={(values) => sendJson(path, token, 'PATCH', { version: detail.version, values })}
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
  );

  const detailsCard = (
    <Card asChild>
      <section aria-label="Details">
        <dl className="grid grid-cols-1 gap-4 p-4 text-sm sm:grid-cols-2">
          <Field label="Type">{detail.types.map(typeLabel).join(', ')}</Field>
          <Field label="Country">{countryName(detail.primaryCountry)}</Field>
          <Field label="Source">{sourceLabel(detail.source)}</Field>
          <Field label="Added">{formatAlberta(detail.createdAt, { weekday: false })}</Field>
          {detail.notes && (
            <div className="sm:col-span-2">
              <Field label="Notes">
                <span className="whitespace-pre-line">{detail.notes}</span>
              </Field>
            </div>
          )}
        </dl>
      </section>
    </Card>
  );

  const contactsCard = (
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
        {mainError && (
          <p role="alert" className="border-b px-4 py-3 text-sm text-danger">
            {mainError}
          </p>
        )}
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
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {contact.name}
                      {contact.isMain && (
                        <Badge variant="info">
                          <Star aria-hidden="true" />
                          Main contact
                        </Badge>
                      )}
                    </span>
                    {contact.role && <span className="text-muted-foreground">{contact.role}</span>}
                    <ContactLinks contact={contact} />
                  </div>
                  {canChange &&
                    (editing?.kind === 'remove-contact' && editing.id === contact.id ? (
                      <ConfirmRemove
                        what={contact.name}
                        onConfirm={async () => {
                          await sendJson(`${path}/contacts/${contact.id}`, token, 'DELETE');
                          done('Contact removed.');
                        }}
                        onCancel={() => {
                          setEditing(null);
                        }}
                      />
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {contact.isMain ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`${contact.name} is no longer the main contact`}
                            onClick={() => void setMainContact(null)}
                          >
                            <StarOff aria-hidden="true" />
                            Not main
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Make ${contact.name} the main contact`}
                            onClick={() => void setMainContact(contact.id)}
                          >
                            <Star aria-hidden="true" />
                            Make main
                          </Button>
                        )}
                        <ItemActions
                          name={contact.name}
                          onEdit={() => {
                            start({ kind: 'contact', id: contact.id });
                          }}
                          onRemove={() => {
                            start({ kind: 'remove-contact', id: contact.id });
                          }}
                        />
                      </div>
                    ))}
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    </Card>
  );

  const locationsCard = (
    <Card asChild className="overflow-hidden">
      <section aria-labelledby="locations-heading">
        <CardHeader>
          <CardTitle id="locations-heading">Locations ({detail.facilities.length})</CardTitle>
          {canChange && (
            <div className="flex flex-wrap gap-2">
              {detail.facilities.some((facility) => facility.latitude === null) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    start({ kind: 'coordinates' });
                  }}
                >
                  <MapPin aria-hidden="true" />
                  Find coordinates
                </Button>
              )}
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
            </div>
          )}
        </CardHeader>
        <Dialog
          open={editing?.kind === 'coordinates'}
          onOpenChange={(open) => {
            if (!open) reloadAndClose();
          }}
        >
          {editing?.kind === 'coordinates' && (
            <DialogContent
              title="Find coordinates"
              description={`For ${detail.legalName}'s locations without coordinates, from their addresses.`}
            >
              <FindCoordinates
                session={session}
                scope={{ counterpartyId: detail.id }}
                doneLabel="Done"
                onDone={reloadAndClose}
              />
            </DialogContent>
          )}
        </Dialog>
        {trading && (
          <CounterpartyLocationsMap
            facilities={detail.facilities}
            types={detail.types}
            selectedId={selectedLocation}
            onSelect={setSelectedLocation}
          />
        )}
        {editing?.kind === 'location' && editing.id === null && (
          <EditForm
            label="New location"
            initial={locationValues(null, country)}
            check={(values) => issuesOf(parseFacilityFields(values, country))}
            save={async (values) => {
              await sendJson(`${path}/facilities`, token, 'POST', splitAccess(values));
              return values;
            }}
            submitLabel="Add location"
            onSaved={(values) => {
              // Without coordinates, they are found from its address straight away.
              if (!values.latitude?.trim()) {
                setNotice(null);
                setEditing({ kind: 'coordinates' });
              } else {
                done('Location added.');
              }
            }}
            onCancel={() => {
              setEditing(null);
            }}
            onReload={reloadAndClose}
          >
            {(fields) => <LocationFields {...fields} access={trading} />}
          </EditForm>
        )}
        {detail.facilities.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">No locations recorded.</p>
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
                        ...splitAccess(values),
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
                    {(fields) => <LocationFields {...fields} access={trading} />}
                  </EditForm>
                </li>
              ) : (
                <li
                  key={facility.id}
                  className={cn(
                    'flex flex-wrap items-start justify-between gap-3 px-4 py-3',
                    facility.id === selectedLocation && 'bg-accent',
                  )}
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
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
                    {facility.transportAccess && <AccessBadges access={facility.transportAccess} />}
                    {facility.latitude && facility.longitude ? (
                      <span className="text-xs text-muted-foreground">
                        {facility.latitude}, {facility.longitude} ·{' '}
                        {facility.locationPrecision === 'exact'
                          ? 'exact location'
                          : 'approximate location'}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">No coordinates yet</span>
                    )}
                  </div>
                  {canChange &&
                    (editing?.kind === 'remove-location' && editing.id === facility.id ? (
                      <ConfirmRemove
                        what={locationName(facility)}
                        onConfirm={async () => {
                          await sendJson(`${path}/facilities/${facility.id}`, token, 'DELETE');
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
  );

  const commoditiesCard = <CounterpartyCommodities token={token} detail={detail} onSaved={done} />;

  const counterparty = { id: detail.id, types: detail.types, archived };
  const quotesCard = (
    <CounterpartyQuotesCard
      session={session}
      counterparty={counterparty}
      state={quotes}
      // In a column the table's later columns (valid until, status) would be cut off.
      stacked={trading}
    />
  );
  const freightCard = (
    <CounterpartyFreight
      session={session}
      counterparty={{ ...counterparty, facilityCount: detail.facilities.length }}
      folded={trading}
    />
  );

  return (
    <>
      <p role="status" className="sr-only">
        {notice}
      </p>
      {archived && (
        <Callout variant="warning" icon={Archive}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>
              <strong>Archived</strong> on {formatAlberta(detail.archivedAt ?? '')}. It is left off
              the list and the map, and cannot be changed until it is restored.
            </p>
            <div className="flex flex-wrap gap-2">
              {editor && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={archiving || deleting}
                  onClick={() => void setArchived(false)}
                >
                  <ArchiveRestore aria-hidden="true" />
                  Restore
                </Button>
              )}
              {canDeleteCounterparties(organization.role) && editing?.kind !== 'delete' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={archiving}
                  onClick={() => {
                    setDeleteError(null);
                    start({ kind: 'delete' });
                  }}
                >
                  <Trash2 aria-hidden="true" />
                  Delete
                </Button>
              )}
            </div>
          </div>
          {editing?.kind === 'delete' && (
            <div
              role="group"
              aria-label="Delete this counterparty"
              className="mt-3 flex flex-col gap-2 border-t border-warning-border pt-3"
            >
              <p>
                Delete <strong>{detail.legalName}</strong> permanently? Its contacts, locations,
                commodities and logo are deleted with it, and this cannot be undone. The audit trail
                keeps who deleted it and when. A counterparty with bids or offers, freight rates, a
                contact history or follow-ups cannot be deleted; it stays archived.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  disabled={deleting}
                  onClick={() => void deleteCounterparty()}
                >
                  {deleting ? 'Deleting…' : 'Delete permanently'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={deleting}
                  onClick={() => {
                    setEditing(null);
                    setDeleteError(null);
                  }}
                >
                  Keep it
                </Button>
              </div>
              {deleteError && (
                <p role="alert" className="text-danger">
                  {deleteError}
                </p>
              )}
            </div>
          )}
        </Callout>
      )}
      {archiveError && (
        <p role="alert" className="text-sm text-danger">
          {archiveError}
        </p>
      )}

      {!trading && (
        <>
          {plainHeader}
          {editDetails || detailsCard}
          {contactsCard}
          <CrmMessage crm={crm} />
          <FollowUpsCard crm={crm} />
          <ContactHistoryCard crm={crm} />
          {locationsCard}
          {quotesCard}
          {freightCard}
        </>
      )}

      {trading && (
        <>
          {tradingHeader}
          {editDetails}
          <CrmMessage crm={crm} />
          {wide ? (
            <div className="grid grid-cols-[minmax(0,1fr)_24rem] items-start gap-4">
              <div className="flex min-w-0 flex-col gap-4">
                {quotesCard}
                <FollowUpsCard crm={crm} />
                <ContactHistoryCard crm={crm} />
              </div>
              <div className="flex min-w-0 flex-col gap-4">
                {contactsCard}
                {commoditiesCard}
                {locationsCard}
                {detailsCard}
                {freightCard}
              </div>
            </div>
          ) : (
            <>
              <FollowUpsCard crm={crm} />
              {quotesCard}
              {contactsCard}
              <ContactHistoryCard crm={crm} />
              {commoditiesCard}
              {locationsCard}
              {detailsCard}
              {freightCard}
            </>
          )}
        </>
      )}
    </>
  );
}

/** Phone and email as links, so a tap on a phone calls or writes. */
function ContactLinks({ contact }: { contact: Contact }) {
  return (
    <>
      {contact.phone && (
        <a
          href={`tel:${contact.phone.replace(/[^0-9+]/g, '')}`}
          className="flex w-fit items-center gap-1.5 underline underline-offset-4"
        >
          <Phone aria-hidden="true" className="size-3.5 text-muted-foreground" />
          {contact.phone}
        </a>
      )}
      {contact.email && (
        <a
          href={`mailto:${contact.email}`}
          className="flex w-fit items-center gap-1.5 break-all underline underline-offset-4"
        >
          <Mail aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          {contact.email}
        </a>
      )}
    </>
  );
}

/** The main contact at the top of a buyer's or seller's page; a hint to editors when none. */
function MainContact({ contact, hint }: { contact: Contact | null; hint: boolean }) {
  return (
    <HeaderFact label="Main contact">
      {contact ? (
        <>
          <span>
            <span className="font-medium">{contact.name}</span>
            {contact.role && <span className="text-muted-foreground"> · {contact.role}</span>}
          </span>
          <ContactLinks contact={contact} />
        </>
      ) : (
        <span className="text-muted-foreground">
          {hint ? (
            <>
              None yet: choose one under Contacts with <strong>Make main</strong>.
            </>
          ) : (
            'None yet.'
          )}
        </span>
      )}
    </HeaderFact>
  );
}

/** One of the three facts at the bottom of the header, with its label above. */
function HeaderFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}

/** The soonest open follow-up, due time in MT and overdue or due today in words. */
function NextFollowUp({ crm }: { crm: CounterpartyCrmState }) {
  const { followUps } = crm;
  const next = followUps.status === 'ok' ? nextFollowUp(followUps.data.followUps) : null;
  const due = next ? dueState(next) : null;
  return (
    <HeaderFact label="Next follow-up">
      {followUps.status === 'loading' && <span className="text-muted-foreground">Loading…</span>}
      {followUps.status === 'error' && (
        <span className="text-muted-foreground">Could not be loaded.</span>
      )}
      {followUps.status === 'ok' &&
        (next ? (
          <>
            <span className="flex flex-wrap items-center gap-1.5">
              {due === 'overdue' && <Badge variant="danger">Overdue</Badge>}
              {due === 'today' && <Badge variant="caution">Due today</Badge>}
              <span className="font-medium">{formatAlberta(next.dueAt)}</span>
            </span>
            <span className="break-words text-muted-foreground">
              {next.task} · {next.assignedTo.name}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">None planned.</span>
        ))}
    </HeaderFact>
  );
}

/** The latest contact logged: when, how and with whom. */
function LastContact({ crm }: { crm: CounterpartyCrmState }) {
  const { log } = crm;
  const last = log.status === 'ok' ? lastContact(log.data.entries) : null;
  return (
    <HeaderFact label="Last contact">
      {log.status === 'loading' && <span className="text-muted-foreground">Loading…</span>}
      {log.status === 'error' && (
        <span className="text-muted-foreground">Could not be loaded.</span>
      )}
      {log.status === 'ok' &&
        (last ? (
          <>
            <span className="font-medium">{formatAlberta(last.current.occurredAt)}</span>
            <span className="break-words text-muted-foreground">
              {CONTACT_CHANNEL_LABELS[last.current.channel]} with {last.current.contactName}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">None logged.</span>
        ))}
    </HeaderFact>
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

/** "tel:" for a phone as saved, e.g. "+1 (403) 555-0100 x12" → tel:+14035550100;ext=12. */
export function telHref(phone: string): string {
  const [number = '', extension] = phone.split('x');
  const digits = number.replace(/[^0-9+]/g, '');
  const ext = extension?.replace(/[^0-9]/g, '');
  return `tel:${digits}${ext ? `;ext=${ext}` : ''}`;
}

/** The company's website and main phone, side by side under its name. */
function WebsiteAndPhone({ detail }: { detail: CounterpartyDetail }) {
  if (!detail.website && !detail.phone) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      {detail.website && <CounterpartyWebsite website={detail.website} />}
      {detail.phone && (
        <a
          href={telHref(detail.phone)}
          className="flex w-fit items-center gap-1.5 underline underline-offset-4"
          aria-label={`Company phone ${detail.phone}`}
        >
          <Phone aria-hidden="true" className="size-3.5 text-muted-foreground" />
          {detail.phone}
        </a>
      )}
    </div>
  );
}

/** Whether rail, trucks or both serve a location, as badges with their icons. */
function AccessBadges({ access }: { access: TransportAccess }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5 py-0.5">
      <span className="sr-only">Served by {TRANSPORT_ACCESS_LABELS[access].toLowerCase()}</span>
      {(access === 'rail' || access === 'rail_and_truck') && (
        <Badge variant="info" aria-hidden="true">
          <TrainFront />
          Rail
        </Badge>
      )}
      {(access === 'truck' || access === 'rail_and_truck') && (
        <Badge variant="neutral" aria-hidden="true">
          <Truck />
          Truck
        </Badge>
      )}
    </span>
  );
}

/** The markets it serves and its tier, under its name; nothing when neither is set. */
function MarketsAndTier({ detail }: { detail: CounterpartyDetail }) {
  if (detail.markets.length === 0 && detail.tier === null) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      {detail.tier && (
        <Badge variant="outline" title="Tier">
          <Layers aria-hidden="true" />
          Tier {detail.tier}
        </Badge>
      )}
      {detail.markets.length > 0 && (
        <ul aria-label="Markets" className="flex flex-wrap gap-1.5">
          {detail.markets.map((market) => (
            <li key={market}>
              <Badge variant="neutral">
                <PawPrint aria-hidden="true" />
                {MARKET_LABELS[market as Market]}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
