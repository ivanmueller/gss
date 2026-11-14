import {
  CONTACT_CHANNEL_LABELS,
  EQUIPMENT_LABELS,
  formatAlberta,
  normalizeCountry,
  parseContactFields,
  parseCounterpartyFields,
  parseFacilityFields,
  GRAIN_TYPE_LABELS,
  MARKET_LABELS,
  SELLER_KIND_LABELS,
  TRANSPORT_ACCESS_LABELS,
  type Equipment,
  type FieldIssue,
  type GrainType,
  type Market,
  type SellerKind,
  type TransportAccess,
} from '@grain/domain';
import {
  Archive,
  ArchiveRestore,
  CalendarPlus,
  ClipboardPaste,
  Container,
  Ellipsis,
  ImageUp,
  Factory,
  Layers,
  Leaf,
  Mail,
  MapPin,
  MessageSquarePlus,
  PawPrint,
  Pencil,
  Plus,
  Star,
  StarOff,
  Tractor,
  TrainFront,
  Trash2,
  Truck,
  Warehouse,
  Waypoints,
  Wheat,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

import { BackLink } from '../components/BackLink';
import { CarrierLanes, isCrossBorder } from '../components/CarrierLanes';
import { CallingProvider, PhoneNumber } from '../components/Calling';
import {
  ContactEmail,
  EmailProvider,
  EmailsCard,
  useEmailComposer,
  useEmailsSent,
} from '../components/Emails';
import {
  ContactHistoryCard,
  crmDraftPlace,
  CrmMessage,
  FollowUpsCard,
  lastContact,
  nextFollowUp,
  useCounterpartyCrm,
  type CounterpartyCrmState,
} from '../components/CounterpartyCrm';
import { ClaudeDraftList, draftsOf } from '../components/ClaudeDrafts';
import { CounterpartyCommodities } from '../components/CounterpartyCommodities';
import { CounterpartyFreight } from '../components/CounterpartyFreight';
import { CounterpartyLocationsMap } from '../components/CounterpartyLocationsMap';
import { CounterpartyLogo } from '../components/CounterpartyLogo';
import { CounterpartySummary } from '../components/CounterpartySummary';
import {
  CounterpartyQuotesCard,
  quoteSides,
  useCounterpartyQuotes,
} from '../components/CounterpartyQuotes';
import { CounterpartyWebsite } from '../components/CounterpartyWebsite';
import {
  CompanyFields,
  ContactFields,
  EquipmentFields,
  equipmentOf,
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
import { canEnterFreight } from '../lib/freight';
import {
  canDeleteCounterparties,
  canEditDirectory,
  certificateExpired,
  countryName,
  facilityTypeLabel,
  formatCalendarDate,
  hasMarkets,
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
    grainTypes: detail.grainTypes.join(','),
    sellerKind: detail.sellerKind ?? '',
    annualTonnes: detail.annualTonnes === null ? '' : String(detail.annualTonnes),
    organicCertifier: detail.organicCertifier ?? '',
    organicCertifiedUntil: detail.organicCertifiedUntil ?? '',
    notes: detail.notes ?? '',
    equipment: detail.equipment.join(','),
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
  | { kind: 'logo' }
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

/**
 * Counterparties that trade grain get the trading layout: bids and offers first, what they
 * buy and sell. A counterparty that is only a carrier gets the same page built around its
 * freight: rates first, its lanes and equipment (owner's request, 2026-11-01).
 */
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
        <EmailProvider
          session={session}
          counterpartyId={resource.data.id}
          contacts={resource.data.contacts}
          enabled={resource.data.archivedAt === null}
        >
          <CounterpartyView session={session} detail={resource.data} reload={reload} />
        </EmailProvider>
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
  const carrier = detail.types.includes('carrier');
  const contactNames = useMemo(() => detail.contacts.map((contact) => contact.name), [detail]);
  const quotes = useCounterpartyQuotes(session, detail.id);
  const crm = useCounterpartyCrm(session, {
    id: detail.id,
    archived,
    contactNames,
    contacts: detail.contacts,
    // After a call's draft was saved: its contact or bid or offer shows on the page.
    reload: () => {
      reload();
      quotes.reload();
    },
  });
  // An email sent is logged in the contact history (F-114 step 3): it, and Last contact, are
  // loaded again after each (Codex's review of F-114-3, R1-03).
  const emailsSent = useEmailsSent();
  const crmChanged = useRef(crm.changed);
  useEffect(() => {
    crmChanged.current = crm.changed;
  });
  useEffect(() => {
    if (emailsSent > 0) crmChanged.current('');
  }, [emailsSent]);
  // Two columns on a computer screen (Tailwind's `xl`); one, in order of use, below it.
  const wide = useMediaQuery('(min-width: 1280px)', true);

  function done(message: string) {
    setEditing(null);
    setNotice(message);
    reload();
  }

  function start(next: Editing) {
    setNotice(null);
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

  // Changing the logo: from the logo itself or the "…" menu (the owner's request of
  // 2026-11-03), a file or a copied image.
  const logoPanel = canChange && editing?.kind === 'logo' && (
    <div
      role="group"
      aria-label="Change logo"
      className="flex w-full flex-col gap-2 rounded-control border bg-muted/40 p-3 text-sm"
    >
      <p>
        {detail.logoSha256 === null ? 'Add a logo' : 'Change the logo'}: upload a PNG, JPG or WebP
        file, or on the company's website right-click its logo, choose Copy image, then Paste logo.
      </p>
      <div className="flex flex-wrap items-start gap-2">
        <LogoUpload
          counterpartyId={detail.id}
          token={token}
          label="Upload logo"
          onUploaded={() => {
            done('Logo saved.');
          }}
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setEditing(null);
          }}
        >
          Close
        </Button>
      </div>
    </div>
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

  const main = detail.contacts.find((contact) => contact.isMain) ?? null;
  const sides = quoteSides(detail.types);
  const canQuote = canEnterQuotes(organization.role) && !archived;
  // Any company may quote a freight rate (F-235).
  const canFreight = canEnterFreight(organization.role) && !archived;
  const places = [detail.regions.join(', '), countryName(detail.primaryCountry)].filter(Boolean);
  // Only Log contact stays visible; the rest is in the "…" menu (the owner's request of
  // 2026-11-03).
  const composer = useEmailComposer();
  const menu = canQuote || canFreight || crm.canPlan || canChange || composer !== null;

  // Who they are, whom to call, and the day's actions; a carrier's with its equipment and
  // whether it crosses the border.
  const tradingHeader = (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start gap-4">
        {canChange ? (
          <button
            type="button"
            aria-label={detail.logoSha256 === null ? 'Add logo' : 'Change logo'}
            title={detail.logoSha256 === null ? 'Add a logo' : 'Change the logo'}
            className="shrink-0 cursor-pointer rounded-control outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              start({ kind: 'logo' });
            }}
          >
            <CounterpartyLogo
              counterpartyId={detail.id}
              name={detail.legalName}
              sha256={detail.logoSha256}
              token={token}
              size="lg"
            />
          </button>
        ) : (
          <CounterpartyLogo
            counterpartyId={detail.id}
            name={detail.legalName}
            sha256={detail.logoSha256}
            token={token}
            size="lg"
          />
        )}
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
          {detail.types.includes('seller') && <SellerDetails detail={detail} />}
          {carrier && <EquipmentAndBorder detail={detail} />}
          <WebsiteAndPhone detail={detail} />
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
          {menu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="outline" aria-label="More actions">
                  <Ellipsis aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canQuote &&
                  sides.map((side) => (
                    <DropdownMenuItem key={side} asChild>
                      <Link href={`/quotes/new?counterparty=${detail.id}&side=${side}`}>
                        <Plus aria-hidden="true" />
                        {side === 'bid' ? 'New bid' : 'New offer'}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                {canFreight && (
                  <DropdownMenuItem asChild>
                    <Link href={`/freight/new?carrier=${detail.id}`}>
                      <Plus aria-hidden="true" />
                      New freight rate
                    </Link>
                  </DropdownMenuItem>
                )}
                {composer !== null && (
                  <DropdownMenuItem
                    onSelect={() => {
                      composer.compose();
                    }}
                  >
                    <Mail aria-hidden="true" />
                    New email
                  </DropdownMenuItem>
                )}
                {crm.canPlan && (
                  <DropdownMenuItem
                    onSelect={() => {
                      crm.startAdding('follow-up');
                    }}
                  >
                    <CalendarPlus aria-hidden="true" />
                    Plan follow-up
                  </DropdownMenuItem>
                )}
                {canChange && (
                  <>
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
                        start({ kind: 'logo' });
                      }}
                    >
                      <ImageUp aria-hidden="true" />
                      {detail.logoSha256 === null ? 'Add logo' : 'Change logo'}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        start({ kind: 'archive' });
                      }}
                    >
                      <Archive aria-hidden="true" />
                      Archive
                    </DropdownMenuItem>
                  </>
                )}
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
      {logoPanel}
      {archiveConfirm}
    </Card>
  );

  const editDetails = editing?.kind === 'details' && (
    <Card className="overflow-hidden">
      <EditForm
        label="Edit details"
        initial={companyValues(detail)}
        check={(values) => issuesOf(parseCounterpartyFields(values))}
        save={({ equipment, ...values }) =>
          sendJson(path, token, 'PATCH', {
            version: detail.version,
            values,
            // Only a carrier's; left out, the equipment saved is kept.
            ...(values.types?.split(',').includes('carrier') && {
              equipment: equipmentOf(equipment),
            }),
          })
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
        {(fields) => (
          <>
            <CompanyFields {...fields} />
            {fields.values.types?.split(',').includes('carrier') && (
              <EquipmentFields props={fields} />
            )}
          </>
        )}
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
        <ClaudeDraftList
          drafts={draftsOf(crm.drafts, 'contact')}
          place={crmDraftPlace(crm)}
          className="border-b px-4 py-3"
        />
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
        {detail.facilities.length > 0 && (
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
      drafts={
        <ClaudeDraftList
          drafts={draftsOf(crm.drafts, 'quote')}
          place={crmDraftPlace(crm)}
          className="border-b px-4 py-3"
        />
      }
    />
  );
  const freightCard = (
    <CounterpartyFreight
      session={session}
      counterparty={{ ...counterparty, facilityCount: detail.facilities.length }}
      // A carrier's own rates are what its page is for; a buyer's or seller's start folded.
      folded={!carrier}
      // Its header already has New freight rate.
      hideNew={canFreight}
    />
  );
  const callLogged = () => {
    crm.changed('');
  };

  const lanesCard = carrier && (
    <CarrierLanes token={token} role={organization.role} detail={detail} onSaved={done} />
  );

  return (
    <CallingProvider
      token={token}
      counterpartyId={detail.id}
      enabled={crm.writer}
      onLogged={callLogged}
    >
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
                lanes, commodities and logo are deleted with it, and this cannot be undone. The
                audit trail keeps who deleted it and when. A counterparty with bids or offers,
                freight rates, a contact history or follow-ups cannot be deleted; it stays archived.
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

      {tradingHeader}
      {editDetails}
      <CrmMessage crm={crm} />
      <CounterpartySummary session={session} counterpartyId={detail.id} canAsk={crm.writer} />
      {trading &&
        (wide ? (
          <div className="grid grid-cols-[minmax(0,1fr)_24rem] items-start gap-4">
            <div className="flex min-w-0 flex-col gap-4">
              {quotesCard}
              <FollowUpsCard crm={crm} />
              <ContactHistoryCard crm={crm} />
              <EmailsCard session={session} counterpartyId={detail.id} />
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              {contactsCard}
              {commoditiesCard}
              {lanesCard}
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
            <EmailsCard session={session} counterpartyId={detail.id} />
            {commoditiesCard}
            {lanesCard}
            {locationsCard}
            {detailsCard}
            {freightCard}
          </>
        ))}
      {/* A carrier's page: its freight rates first, then its lanes (owner's request, 2026-11-01). */}
      {!trading &&
        (wide ? (
          <div className="grid grid-cols-[minmax(0,1fr)_26rem] items-start gap-4">
            <div className="flex min-w-0 flex-col gap-4">
              {freightCard}
              <FollowUpsCard crm={crm} />
              <ContactHistoryCard crm={crm} />
              <EmailsCard session={session} counterpartyId={detail.id} />
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              {lanesCard}
              {contactsCard}
              {locationsCard}
              {detailsCard}
            </div>
          </div>
        ) : (
          <>
            <FollowUpsCard crm={crm} />
            {lanesCard}
            {freightCard}
            {contactsCard}
            <ContactHistoryCard crm={crm} />
            <EmailsCard session={session} counterpartyId={detail.id} />
            {locationsCard}
            {detailsCard}
          </>
        ))}
    </CallingProvider>
  );
}

/** Phone and email: clicking the phone calls it through the platform or copies it; the email writes. */
function ContactLinks({ contact }: { contact: Contact }) {
  return (
    <>
      {contact.phone && (
        <PhoneNumber
          contactId={contact.id}
          name={contact.name}
          phone={contact.phone}
          href={telHref(contact.phone)}
        />
      )}
      <ContactEmail contact={contact} />
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
        <PhoneNumber
          contactId={null}
          name={detail.tradingName ?? detail.legalName}
          phone={detail.phone}
          href={telHref(detail.phone)}
        />
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

/**
 * The markets it serves (a buyer's or broker's; a seller's are kept but not shown) and its
 * tier, under its name; nothing when neither is shown.
 */
function MarketsAndTier({ detail }: { detail: CounterpartyDetail }) {
  const markets = hasMarkets(detail.types) ? detail.markets : [];
  if (markets.length === 0 && detail.tier === null) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      {detail.tier && (
        <Badge variant="outline" title="Tier">
          <Layers aria-hidden="true" />
          Tier {detail.tier}
        </Badge>
      )}
      {markets.length > 0 && (
        <ul aria-label="Markets" className="flex flex-wrap gap-1.5">
          {markets.map((market) => (
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

const SELLER_KIND_ICONS: Record<SellerKind, typeof Tractor> = {
  farm: Tractor,
  elevator: Warehouse,
  processor: Factory,
  other: Wheat,
};

/**
 * A seller's details under its name (owner's request, 2026-11-03): what kind of seller, its
 * grain types, about how much it sells a year, and its organic certificate (shown with organic
 * grain only, marked Expired once its last day has passed in Alberta). Nothing when none is set.
 */
function SellerDetails({ detail }: { detail: CounterpartyDetail }) {
  const kind = detail.sellerKind as SellerKind | null;
  const KindIcon = kind ? SELLER_KIND_ICONS[kind] : null;
  const organic = detail.grainTypes.includes('organic');
  const until = organic ? detail.organicCertifiedUntil : null;
  const certifier = organic ? detail.organicCertifier : null;
  if (
    !kind &&
    detail.grainTypes.length === 0 &&
    detail.annualTonnes === null &&
    !until &&
    !certifier
  ) {
    return null;
  }
  const expired = until !== null && certificateExpired(until);
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      {kind && KindIcon && (
        <Badge variant="outline" title="Seller kind">
          <KindIcon aria-hidden="true" />
          {SELLER_KIND_LABELS[kind]}
        </Badge>
      )}
      {detail.grainTypes.length > 0 && (
        <ul aria-label="Grain types" className="flex flex-wrap gap-1.5">
          {detail.grainTypes.map((type) => (
            <li key={type}>
              <Badge variant="neutral">
                <Wheat aria-hidden="true" />
                {GRAIN_TYPE_LABELS[type as GrainType]}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {detail.annualTonnes !== null && (
        <span className="text-muted-foreground">
          About {detail.annualTonnes.toLocaleString('en-CA')} t a year
        </span>
      )}
      {(certifier ?? until) !== null && (
        <span className="flex w-full items-start gap-1.5 text-muted-foreground">
          <Leaf aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
          <span>
            <span>
              Organic certified
              {certifier && <> by {certifier}</>}
              {until && <> until {formatCalendarDate(until)}</>}
            </span>
            {expired && (
              <Badge variant="danger" className="ml-1.5">
                Expired
              </Badge>
            )}
          </span>
        </span>
      )}
    </div>
  );
}

/** A carrier's equipment and, when a lane or freight rate crosses the border, Cross-border. */
function EquipmentAndBorder({ detail }: { detail: CounterpartyDetail }) {
  const border = isCrossBorder(detail);
  if (detail.equipment.length === 0 && !border) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      {border && (
        <Badge variant="info" title="A lane or freight rate crosses the border">
          <Waypoints aria-hidden="true" />
          Cross-border
        </Badge>
      )}
      {detail.equipment.length > 0 && (
        <ul aria-label="Equipment" className="flex flex-wrap gap-1.5">
          {detail.equipment.map((item) => (
            <li key={item}>
              <Badge variant="neutral">
                <Container aria-hidden="true" />
                {EQUIPMENT_LABELS[item as Equipment]}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
