import {
  COMMODITIES,
  commodityName,
  draftContactValues,
  draftQuoteValues,
  draftReadiness,
  formatAlberta,
  parseContactFields,
  QUOTE_SIDE_LABELS,
  utcToAlberta,
  type ContactChecks,
  type DraftInput,
  type DraftKind,
  type FollowUpFormValues,
  type OpenDraftList,
  type OpenDraftView,
  type QuoteChecks,
  type QuoteFormValues,
  type SaidCheck,
  type TeamMemberName,
  type VerifiedDraft,
} from '@grain/domain';
import { ChevronDown, CircleAlert } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';

import { ApiError, fieldIssues, sendJson, type Contact } from '../lib/api';
import { canLogContacts, defaultDueInput, noteFollowUpsChanged } from '../lib/crm';
import { canEditDirectory } from '../lib/directory';
import { canEnterQuotes } from '../lib/quotes';
import { Link } from '../lib/router';
import { cn } from '../lib/utils';
import { forgetApiAnswers, useApiResource, type Resource } from '../lib/useApiResource';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import { ClaudeMark } from './ClaudeMark';
import { FollowUpForm } from './CrmForms';
import { ContactFields, FormIssues, type FormValues } from './DirectoryFields';
import { QuoteForm } from './QuoteForm';
import { Button } from './ui/button';
import { Select } from './ui/select';

// Claude's drafts from calls, shown where they belong (the owner's request and answers of
// 2026-11-06, docs/DECISIONS.md, F-115): bids and offers among bids and offers, follow-ups among
// follow-ups, contacts among contacts, on a company's page and on the main Bids & offers and
// Follow-ups pages. Each is marked as Claude's (Claude's warm colour and mark, "Drafted by
// Claude"; F-116), folded to its main information until opened, and is not a
// record until a person verifies it: Verify saves exactly what was drafted in one step, Edit or
// Finish in the form opens the usual form filled in and saves what the person confirms through
// Verify too (one transaction either way; Codex's review of 88e09df), and Dismiss sets it aside. Each filled-in amount shows the
// transcript line it came from, and why to look twice when unusual.

type QuoteFields = Extract<DraftInput, { kind: 'quote' }>['fields'];
type FollowUpFields = Extract<DraftInput, { kind: 'follow_up' }>['fields'];
type ContactFieldsValues = Extract<DraftInput, { kind: 'contact' }>['fields'];

/** Where drafts are shown, and what they need there. */
export interface DraftPlace {
  session: DirectorySession;
  /** The company's contacts (its page), for drafts of a listed contact's new details. */
  contacts?: readonly Contact[];
  /** The team, for a follow-up's form; null while it loads. */
  team: TeamMemberName[] | null;
  /** After a draft was saved or dismissed: the message to show, and what kind it was. */
  onChanged: (message: string, kind: DraftKind) => void;
}

/** An organization's open drafts, optionally of one company or one kind. */
export function useOpenDrafts(
  session: DirectorySession,
  filter: { counterpartyId?: string; kind?: DraftKind },
): [Resource<OpenDraftList>, () => void] {
  const query = new URLSearchParams({ organization_id: session.organization.id });
  if (filter.counterpartyId !== undefined) query.set('counterparty_id', filter.counterpartyId);
  if (filter.kind !== undefined) query.set('kind', filter.kind);
  return useApiResource<OpenDraftList>(`/calls/drafts?${query.toString()}`, session.token);
}

/** The drafts of one kind in a resource, oldest call last. */
export function draftsOf(drafts: Resource<OpenDraftList>, kind: DraftKind): OpenDraftView[] {
  return drafts.status === 'ok' ? drafts.data.drafts.filter((draft) => draft.kind === kind) : [];
}

/** Whether the person's role may save a draft of this kind (the API checks again). */
export function maySaveDraft(kind: DraftKind, role: string): boolean {
  if (kind === 'quote') return canEnterQuotes(role);
  if (kind === 'follow_up') return canLogContacts(role);
  return canEditDirectory(role);
}

const WHO_SAVES: Record<DraftKind, string> = {
  quote: 'Traders and admins verify bids and offers.',
  follow_up: 'Traders, operations and admins verify follow-ups.',
  contact: 'Operations and admins verify contacts.',
};

/** What a draft saved as, in the message after Verify. */
const SAVED_AS: Record<DraftKind, string> = {
  quote: 'Verified: saved as a bid or offer.',
  follow_up: 'Verified: follow-up planned.',
  contact: 'Verified: contact saved.',
};

/** After a draft was saved: the lists that may show it forget what they kept. */
function savedKind(kind: DraftKind) {
  forgetApiAnswers('/calls/drafts');
  if (kind === 'quote') forgetApiAnswers('/quotes');
  if (kind === 'follow_up') {
    forgetApiAnswers('/follow-ups');
    noteFollowUpsChanged();
  }
}

/** A transcript line with the copied words marked, when they are found in it. */
function SaidLine({ text, said }: { text: string; said: string | null }) {
  const at = said === null ? -1 : text.toLowerCase().indexOf(said.toLowerCase());
  if (said === null || at === -1) return <q className="italic">{text}</q>;
  return (
    <q className="italic">
      {text.slice(0, at)}
      <mark className="rounded-inset bg-claude-border px-0.5 text-foreground not-italic">
        {text.slice(at, at + said.length)}
      </mark>
      {text.slice(at + said.length)}
    </q>
  );
}

function lineText(draft: OpenDraftView, n: number): string | null {
  return draft.sourceLines.find((line) => line.line === n)?.text ?? null;
}

/** Where a filled-in value was said, and the reason to look twice at it. */
function Evidence({
  label,
  check,
  draft,
}: {
  label: string;
  check: SaidCheck;
  draft: OpenDraftView;
}) {
  const line = lineText(draft, check.line);
  return (
    <div className="flex flex-col gap-1 text-xs">
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">{label}</span> from the call:{' '}
        {line === null ? (
          <q className="italic">{check.said}</q>
        ) : (
          <SaidLine text={line} said={check.said} />
        )}
      </p>
      {check.doubt !== null && (
        <p
          role="note"
          className="flex items-start gap-1 rounded-inset border border-warning-border bg-warning-subtle px-2 py-1 text-foreground"
        >
          <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <span>
            <strong>Check this:</strong> {check.doubt}
          </span>
        </p>
      )}
    </div>
  );
}

/** The lines a draft came from, when no amount of it points to its own line. */
function SourceLines({ draft }: { draft: OpenDraftView }) {
  const lines = draft.lines
    .map((n) => lineText(draft, n))
    .filter((text): text is string => text !== null)
    .slice(0, 2);
  if (lines.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      From the call:{' '}
      {lines.map((text, index) => (
        <span key={index}>
          {index > 0 && ' … '}
          <q className="italic">{text}</q>
        </span>
      ))}
    </p>
  );
}

export function draftTitle(
  draft: Pick<OpenDraftView, 'kind' | 'fields' | 'contactId'>,
  contacts: readonly Contact[],
): string {
  if (draft.kind === 'quote') {
    const fields = draft.fields as QuoteFields;
    const commodity =
      fields.commodity === null ? 'commodity not said' : commodityName(fields.commodity);
    return `${QUOTE_SIDE_LABELS[fields.side]} · ${commodity}`;
  }
  if (draft.kind === 'follow_up') {
    return `Follow-up: ${(draft.fields as FollowUpFields).values.task ?? ''}`;
  }
  const values = (draft.fields as ContactFieldsValues).values;
  const listed = contacts.find((contact) => contact.id === draft.contactId);
  if (listed) return `New details for ${listed.name}`;
  return draft.contactId === null
    ? `New contact: ${values.contactName ?? ''}`
    : 'New details for a listed contact';
}

/** A short line of what a draft says. */
export function draftSummary(draft: Pick<OpenDraftView, 'kind' | 'fields'>): string {
  if (draft.kind === 'quote') {
    const values = (draft.fields as QuoteFields).values;
    const price =
      values.price === undefined
        ? 'price not said'
        : [values.currency, values.price, values.priceUnit && `/${values.priceUnit}`]
            .filter(Boolean)
            .join(' ');
    const quantity =
      values.quantityMax === undefined ? 'quantity not said' : `${values.quantityMax} MT`;
    const valid =
      values.validUntil === undefined
        ? 'valid-until not said'
        : `valid until ${formatAlberta(values.validUntil)}`;
    return [price, quantity, values.deliveryBasis, values.basisLocation, valid]
      .filter(Boolean)
      .join(' · ');
  }
  if (draft.kind === 'follow_up') {
    const due = (draft.fields as FollowUpFields).values.dueAt;
    return due === undefined ? 'No day or time said' : `Due ${formatAlberta(due)}`;
  }
  const values = (draft.fields as ContactFieldsValues).values;
  return [values.contactRole, values.contactEmail, values.contactPhone].filter(Boolean).join(' · ');
}

/** Claude's drafts of one section, or nothing when there are none. */
export function ClaudeDraftList({
  drafts,
  place,
  showCompany = false,
  className,
}: {
  drafts: readonly OpenDraftView[];
  place: DraftPlace;
  /** Name each draft's company (the main Bids & offers and Follow-ups pages). */
  showCompany?: boolean;
  className?: string;
}) {
  if (drafts.length === 0) return null;
  return (
    <ul
      aria-label={`Claude's drafts to verify (${String(drafts.length)})`}
      className={['flex flex-col gap-2', className].filter(Boolean).join(' ')}
    >
      {drafts.map((draft) => (
        <ClaudeDraftCard key={draft.id} draft={draft} place={place} showCompany={showCompany} />
      ))}
    </ul>
  );
}

/** One draft: what it says, where it came from, and Verify, Edit or Dismiss. */
export function ClaudeDraftCard({
  draft,
  place,
  showCompany = false,
}: {
  draft: OpenDraftView;
  place: DraftPlace;
  showCompany?: boolean;
}) {
  const { session } = place;
  const contacts = place.contacts ?? [];
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowed = maySaveDraft(draft.kind, session.organization.role);
  const listed =
    draft.kind === 'contact' && draft.contactId !== null
      ? (contacts.find((contact) => contact.id === draft.contactId) ?? null)
      : null;
  // New details of a contact this page does not list (removed since the call) cannot be saved.
  const contactGone = draft.kind === 'contact' && draft.contactId !== null && listed === null;
  const readiness = contactGone ? null : draftReadiness(draft, new Date(), listed);

  // Read defensively: a draft kept before checks existed has none.
  const said = (draft.fields as { checks?: QuoteChecks & ContactChecks }).checks ?? {};
  const checks: [string, SaidCheck | undefined][] =
    draft.kind === 'quote'
      ? [
          ['Price', said.price],
          ['Least quantity', said.quantityMin],
          ['Quantity', said.quantityMax],
        ]
      : draft.kind === 'contact'
        ? [['Phone', said.contactPhone]]
        : [];
  const evidence = checks.filter((pair): pair is [string, SaidCheck] => pair[1] !== undefined);

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      savedKind(draft.kind);
      place.onChanged(message, draft.kind);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  // New details of a listed contact are saved only over the version shown here.
  const contactVersion = listed === null ? {} : { contactVersion: listed.version };
  const verify = () =>
    run(
      () =>
        sendJson<VerifiedDraft>(`/calls/drafts/${draft.id}/verify`, session.token, 'POST', {
          ...contactVersion,
        }),
      SAVED_AS[draft.kind],
    );
  const dismiss = () =>
    run(
      () =>
        sendJson(`/calls/drafts/${draft.id}/decision`, session.token, 'POST', {
          decision: 'dismissed',
        }),
      'Draft dismissed.',
    );

  /**
   * What the person confirmed in the usual form, verified like the draft itself: saved and the
   * draft marked in one transaction. A refusal is thrown to the form, which shows it by field.
   */
  async function verifyEdited(edited: { commodity?: string; values: Record<string, string> }) {
    await sendJson<VerifiedDraft>(`/calls/drafts/${draft.id}/verify`, session.token, 'POST', {
      ...contactVersion,
      edited,
    });
    setEditing(false);
    savedKind(draft.kind);
    place.onChanged(SAVED_AS[draft.kind], draft.kind);
  }

  const doubts = evidence.filter(([, check]) => check.doubt !== null).length;
  return (
    <li
      className="@container flex flex-col gap-2 rounded-control border border-l-[3px] border-claude-border border-l-claude-mark bg-claude-subtle px-3 py-2"
      aria-label={`Drafted by Claude: ${draftTitle(draft, contacts)}`}
    >
      {/* In a narrow column (Contacts) the buttons go under the text, not beside it. */}
      <div className="flex flex-col gap-2 @xl:flex-row @xl:items-start @xl:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <ClaudeMark className="mt-0.5" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm font-medium">{draftTitle(draft, contacts)}</p>
            <p className="text-xs text-muted-foreground">
              {showCompany && (
                <>
                  <Link
                    href={`/counterparties/${draft.counterpartyId}`}
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {draft.counterpartyName}
                  </Link>
                  {' · '}
                </>
              )}
              <span className="font-medium text-claude">Drafted by Claude</span>
              {' · '}
              {draftSummary(draft)}
            </p>
            {/* Seen before Verify even while folded: why to look twice, what is missing. */}
            {(doubts > 0 || readiness?.status === 'incomplete' || contactGone) && (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {doubts > 0 && (
                  <span className="inline-flex items-center gap-1 font-medium text-warning">
                    <CircleAlert aria-hidden="true" className="size-3.5" />
                    Check this
                  </span>
                )}
                {readiness?.status === 'incomplete' && (
                  <span className="text-foreground">
                    Not heard on the call: {readiness.missing.join(', ')}
                  </span>
                )}
                {contactGone && (
                  <span className="text-muted-foreground">Contact no longer listed</span>
                )}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pl-6 @xl:pl-0">
          {allowed && !editing && (
            <>
              {readiness?.status === 'ready' && (
                <Button
                  size="sm"
                  className="h-7 px-2"
                  disabled={busy}
                  onClick={() => void verify()}
                >
                  {busy ? 'Saving…' : 'Verify'}
                </Button>
              )}
              {readiness !== null && (
                <Button
                  size="sm"
                  variant={readiness.status === 'ready' ? 'outline' : 'primary'}
                  className="h-7 px-2"
                  disabled={busy || (draft.kind === 'follow_up' && place.team === null)}
                  onClick={() => {
                    setError(null);
                    setEditing(true);
                  }}
                >
                  {readiness.status === 'ready' ? 'Edit' : 'Finish in the form'}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2"
                disabled={busy}
                onClick={() => void dismiss()}
              >
                Dismiss
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-1.5 text-muted-foreground"
            aria-expanded={open}
            aria-label={open ? 'Hide details' : 'Show details'}
            onClick={() => {
              setOpen((current) => !current);
            }}
          >
            <ChevronDown
              aria-hidden="true"
              className={cn('size-4 transition-transform', open && 'rotate-180')}
            />
          </Button>
        </div>
      </div>
      {open && (
        <div className="flex flex-col gap-2 border-t border-claude-border pt-2">
          <p className="text-xs text-muted-foreground">
            From {draft.callerName}’s call with {draft.contactName},{' '}
            {formatAlberta(draft.calledAt, { weekday: false })}
          </p>
          {evidence.length > 0 ? (
            evidence.map(([label, check]) => (
              <Evidence key={label} label={label} check={check} draft={draft} />
            ))
          ) : (
            <SourceLines draft={draft} />
          )}
          {readiness?.status === 'incomplete' && (
            <p className="text-xs text-foreground">
              <strong>Not heard on the call:</strong> {readiness.missing.join(', ')}. Finish it in
              the form to save it.
            </p>
          )}
          {contactGone && (
            <p className="text-xs text-muted-foreground">
              The contact these details were for is no longer listed. Dismiss this draft, or add the
              person again.
            </p>
          )}
        </div>
      )}
      {!allowed && <p className="text-xs text-muted-foreground">{WHO_SAVES[draft.kind]}</p>}
      {error !== null && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {editing && draft.kind === 'quote' && (
        <QuoteReview
          fields={draft.fields as QuoteFields}
          onCancel={() => {
            setEditing(false);
          }}
          onSave={verifyEdited}
        />
      )}
      {editing && draft.kind === 'follow_up' && place.team !== null && (
        <FollowUpReview
          session={session}
          team={place.team}
          fields={draft.fields as FollowUpFields}
          onCancel={() => {
            setEditing(false);
          }}
          onSave={verifyEdited}
        />
      )}
      {editing && draft.kind === 'contact' && (
        <ContactReview
          listed={listed}
          fields={draft.fields as ContactFieldsValues}
          onCancel={() => {
            setEditing(false);
          }}
          onSave={verifyEdited}
        />
      )}
    </li>
  );
}

/** What a form hands back to be verified: the person's values (and a bid's commodity). */
type SaveEdited = (edited: { commodity?: string; values: Record<string, string> }) => Promise<void>;

/** The form's values without unset fields, as the API reads them. */
function present(values: Partial<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/**
 * The usual bid or offer form, filled in from the draft with the form's own defaults (indicative,
 * per tonne), which the person sees before saving; times shown in Alberta time.
 */
function QuoteReview({
  fields,
  onCancel,
  onSave,
}: {
  fields: QuoteFields;
  onCancel: () => void;
  onSave: SaveEdited;
}) {
  const [commodity, setCommodity] = useState<string>(fields.commodity ?? '');
  const drafted = draftQuoteValues(fields.values);
  const initial: QuoteFormValues = { ...drafted };
  if (drafted.quotedAt !== undefined) initial.quotedAt = utcToAlberta(drafted.quotedAt);
  if (drafted.validUntil !== undefined) initial.validUntil = utcToAlberta(drafted.validUntil);
  return (
    <div className="border-t border-claude-border pt-3">
      <QuoteForm
        initial={initial}
        submitLabel={`Save ${QUOTE_SIDE_LABELS[fields.side].toLowerCase()}`}
        busyLabel="Saving…"
        checkBefore={() => (commodity === '' ? 'Choose a commodity.' : null)}
        before={
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">Commodity</span>
            <Select
              aria-label="Commodity"
              value={commodity}
              onValueChange={setCommodity}
              options={COMMODITIES.map((option) => ({ value: option.code, label: option.name }))}
              className="w-full sm:w-72"
            />
          </div>
        }
        onSubmit={(values) => onSave({ commodity, values: present(values) })}
        onCancel={
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        }
      />
    </div>
  );
}

/** The usual follow-up form, filled in from the draft (due tomorrow 9:00 am MT unless said). */
function FollowUpReview({
  session,
  team,
  fields,
  onCancel,
  onSave,
}: {
  session: DirectorySession;
  team: TeamMemberName[];
  fields: FollowUpFields;
  onCancel: () => void;
  onSave: SaveEdited;
}) {
  const initial: FollowUpFormValues = {
    task: fields.values.task ?? '',
    dueAt:
      fields.values.dueAt === undefined ? defaultDueInput() : utcToAlberta(fields.values.dueAt),
    assignedTo: fields.values.assignedTo ?? session.userId ?? '',
  };
  return (
    <div className="border-t border-claude-border pt-3">
      <FollowUpForm
        initial={initial}
        team={team}
        submitLabel="Plan follow-up"
        busyLabel="Saving…"
        onSubmit={(values) => onSave({ values: present(values) })}
        onCancel={onCancel}
      />
    </div>
  );
}

/** The usual contact fields, filled in from the draft over the contact's own when listed. */
function ContactReview({
  listed,
  fields,
  onCancel,
  onSave,
}: {
  listed: Contact | null;
  fields: ContactFieldsValues;
  onCancel: () => void;
  onSave: SaveEdited;
}) {
  const [values, setValues] = useState<FormValues>(() => {
    const merged = draftContactValues(fields.values, listed);
    return {
      contactName: merged.contactName ?? '',
      contactRole: merged.contactRole ?? '',
      contactEmail: merged.contactEmail ?? '',
      contactPhone: merged.contactPhone ?? '',
    };
  });
  const [issues, setIssues] = useState<ReturnType<typeof fieldIssues>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    setError(null);
    const checked = parseContactFields(values);
    setIssues(checked.status === 'invalid' ? checked.issues : []);
    if (checked.status === 'invalid') return;
    setBusy(true);
    try {
      await onSave({
        values: {
          contactName: values.contactName ?? '',
          contactRole: values.contactRole ?? '',
          contactEmail: values.contactEmail ?? '',
          contactPhone: values.contactPhone ?? '',
        },
      });
    } catch (failure) {
      setIssues(fieldIssues(failure));
      setError(failure instanceof Error ? failure.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <form
      aria-label={listed ? `Save new details for ${listed.name}` : 'Add the contact'}
      noValidate
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-3 border-t border-claude-border pt-3"
    >
      <ContactFields
        values={values}
        issues={issues}
        disabled={busy}
        required
        onChange={(changes) => {
          setValues((current) => ({ ...current, ...changes }));
        }}
      />
      <FormIssues issues={issues} />
      {error !== null && issues.length === 0 && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Saving…' : listed ? 'Save contact' : 'Add contact'}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
