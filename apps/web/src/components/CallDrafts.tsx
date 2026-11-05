import {
  COMMODITIES,
  commodityName,
  formatAlberta,
  parseContactFields,
  QUOTE_SIDE_LABELS,
  utcToAlberta,
  type CallDraftView,
  type CallRecordingView,
  type ContactChecks,
  type ContactFormValues,
  type DraftInput,
  type FollowUpFormValues,
  type QuoteDetail,
  type QuoteChecks,
  type QuoteFormValues,
  type SaidCheck,
} from '@grain/domain';
import { Bot, CircleAlert, Voicemail } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';

import { ApiError, fieldIssues, sendJson, type Contact, type CounterpartyDetail } from '../lib/api';
import { canLogContacts, defaultDueInput, noteFollowUpsChanged } from '../lib/crm';
import { canEditDirectory } from '../lib/directory';
import { canEnterQuotes } from '../lib/quotes';
import type { CounterpartyCrmState } from './CounterpartyCrm';
import { FollowUpForm } from './CrmForms';
import { ContactFields, FormIssues, type FormValues } from './DirectoryFields';
import { QuoteForm } from './QuoteForm';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Select } from './ui/select';

// Claude's reading of a call, under its entry in the contact history (the owner's request and
// choices of 2026-11-05, docs/DECISIONS.md): whether it reached a voicemail, Claude's notes,
// and its drafts of bids and offers, follow-ups and contacts. Nothing is saved until a person
// opens a draft in the usual form and saves it; each filled-in number shows the transcript line
// it came from, the words copied marked, and when unusual why to look twice.

type QuoteFields = Extract<DraftInput, { kind: 'quote' }>['fields'];
type FollowUpFields = Extract<DraftInput, { kind: 'follow_up' }>['fields'];
type ContactFieldsValues = Extract<DraftInput, { kind: 'contact' }>['fields'];

/** How many drafts of a call wait for a person, over all its recordings. */
export function openDrafts(recordings: readonly CallRecordingView[]): number {
  return recordings.reduce(
    (sum, recording) =>
      sum + (recording.reading?.drafts.filter((draft) => draft.status === 'open').length ?? 0),
    0,
  );
}

/** Whether Claude (or a person's correction) says the call reached a voicemail. */
export function reachedVoicemail(recordings: readonly CallRecordingView[]): boolean {
  return recordings.some((recording) => recording.reading?.voicemail === true);
}

/** A transcript line with the copied words marked, when they are found in it. */
function SaidLine({ text, said }: { text: string; said: string | null }) {
  const at = said === null ? -1 : text.toLowerCase().indexOf(said.toLowerCase());
  if (said === null || at === -1) return <q className="italic">{text}</q>;
  return (
    <q className="italic">
      {text.slice(0, at)}
      <mark className="rounded-inset bg-info-subtle px-0.5 text-foreground not-italic">
        {text.slice(at, at + said.length)}
      </mark>
      {text.slice(at + said.length)}
    </q>
  );
}

/** Where a filled-in value was said, and the reason to look twice at it. */
function Evidence({
  label,
  check,
  recording,
}: {
  label: string;
  check: SaidCheck;
  recording: CallRecordingView;
}) {
  const line = recording.lines?.[check.line]?.text ?? null;
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
function SourceLines({ draft, recording }: { draft: CallDraftView; recording: CallRecordingView }) {
  const lines = draft.lines
    .map((n) => recording.lines?.[n]?.text)
    .filter((text): text is string => text !== undefined)
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

function draftTitle(draft: CallDraftView, contacts: readonly Contact[]): string {
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
  return listed ? `New details for ${listed.name}` : `New contact: ${values.contactName ?? ''}`;
}

/** A short line of what a draft says. */
function draftSummary(draft: CallDraftView): string {
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

/** Whether the person's role may save a draft of this kind (the API checks again). */
function maySave(kind: CallDraftView['kind'], role: string): boolean {
  if (kind === 'quote') return canEnterQuotes(role);
  if (kind === 'follow_up') return canLogContacts(role);
  return canEditDirectory(role);
}

const WHO_SAVES: Record<CallDraftView['kind'], string> = {
  quote: 'Traders and admins save bids and offers.',
  follow_up: 'Traders, operations and admins plan follow-ups.',
  contact: 'Operations and admins save contacts.',
};

/** One draft: what it says, where it came from, and Review or Dismiss while open. */
function DraftCard({
  crm,
  draft,
  recording,
}: {
  crm: CounterpartyCrmState;
  draft: CallDraftView;
  recording: CallRecordingView;
}) {
  const { session, counterparty } = crm;
  const contacts = counterparty.contacts ?? [];
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const role = session.organization.role;
  const allowed = maySave(draft.kind, role) && !counterparty.archived;
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

  async function decide(decision: 'accepted' | 'dismissed', resultId: string | null) {
    await sendJson(`/calls/drafts/${draft.id}/decision`, session.token, 'POST', {
      decision,
      ...(resultId !== null && { resultId }),
    });
  }

  async function dismiss() {
    setBusy(true);
    setError(null);
    try {
      await decide('dismissed', null);
      crm.changed('Draft dismissed.');
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  /** After the usual form saved: the draft is accepted with what was saved from it. */
  async function saved(resultId: string, message: string) {
    try {
      await decide('accepted', resultId);
      setReviewing(false);
      crm.changed(message);
    } catch (failure) {
      setError(
        `Saved, but the draft could not be marked as saved: ${failure instanceof ApiError ? failure.message : 'try Dismiss'}.`,
      );
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-control border bg-card px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm font-medium">{draftTitle(draft, contacts)}</p>
          <p className="text-xs text-muted-foreground">{draftSummary(draft)}</p>
        </div>
        {draft.status === 'open' && !reviewing && allowed && (
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-7 px-2"
              disabled={busy}
              onClick={() => {
                setReviewing(true);
              }}
            >
              Review
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2"
              disabled={busy}
              onClick={() => void dismiss()}
            >
              Dismiss
            </Button>
          </div>
        )}
        {draft.status !== 'open' && (
          <Badge variant={draft.status === 'accepted' ? 'success' : 'neutral'}>
            {draft.status === 'accepted' ? 'Saved' : 'Dismissed'} by {draft.decidedByName}
            {draft.decidedAt !== null && `, ${formatAlberta(draft.decidedAt, { weekday: false })}`}
          </Badge>
        )}
      </div>
      {evidence.length > 0 ? (
        evidence.map(([label, check]) => (
          <Evidence key={label} label={label} check={check} recording={recording} />
        ))
      ) : (
        <SourceLines draft={draft} recording={recording} />
      )}
      {draft.status === 'open' && !allowed && (
        <p className="text-xs text-muted-foreground">{WHO_SAVES[draft.kind]}</p>
      )}
      {error !== null && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {reviewing && draft.kind === 'quote' && (
        <QuoteReview
          crm={crm}
          fields={draft.fields as QuoteFields}
          onCancel={() => {
            setReviewing(false);
          }}
          onSaved={(id) => void saved(id, 'Saved from the call.')}
        />
      )}
      {reviewing && draft.kind === 'follow_up' && (
        <FollowUpReview
          crm={crm}
          fields={draft.fields as FollowUpFields}
          onCancel={() => {
            setReviewing(false);
          }}
          onSaved={(id) => void saved(id, 'Follow-up planned from the call.')}
        />
      )}
      {reviewing && draft.kind === 'contact' && (
        <ContactReview
          crm={crm}
          contactId={draft.contactId}
          fields={draft.fields as ContactFieldsValues}
          onCancel={() => {
            setReviewing(false);
          }}
          onSaved={(id) => void saved(id, 'Contact saved from the call.')}
        />
      )}
    </li>
  );
}

/** The usual bid or offer form, filled in from the draft; times shown in Alberta time. */
function QuoteReview({
  crm,
  fields,
  onCancel,
  onSaved,
}: {
  crm: CounterpartyCrmState;
  fields: QuoteFields;
  onCancel: () => void;
  onSaved: (id: string) => void;
}) {
  const { session, counterparty } = crm;
  const [commodity, setCommodity] = useState<string>(fields.commodity ?? '');
  const initial: QuoteFormValues = {
    firmness: 'indicative',
    priceUnit: 'MT',
    ...fields.values,
    quotedAt: utcToAlberta(fields.values.quotedAt),
    validUntil: utcToAlberta(fields.values.validUntil),
  };
  return (
    <div className="border-t pt-3">
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
        onSubmit={async (values) => {
          const created = await sendJson<QuoteDetail>('/quotes', session.token, 'POST', {
            organizationId: session.organization.id,
            counterpartyId: counterparty.id,
            facilityId: null,
            side: fields.side,
            commodity,
            values,
          });
          counterparty.reload?.();
          onSaved(created.id);
        }}
        onCancel={
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        }
      />
    </div>
  );
}

/** The usual follow-up form, filled in from the draft. */
function FollowUpReview({
  crm,
  fields,
  onCancel,
  onSaved,
}: {
  crm: CounterpartyCrmState;
  fields: FollowUpFields;
  onCancel: () => void;
  onSaved: (id: string) => void;
}) {
  const { session, counterparty, team } = crm;
  if (team === null) return <p className="text-xs text-muted-foreground">Loading the team…</p>;
  const initial: FollowUpFormValues = {
    task: fields.values.task ?? '',
    dueAt:
      fields.values.dueAt === undefined ? defaultDueInput() : utcToAlberta(fields.values.dueAt),
    assignedTo: fields.values.assignedTo ?? session.userId ?? '',
  };
  return (
    <div className="border-t pt-3">
      <FollowUpForm
        initial={initial}
        team={team}
        submitLabel="Plan follow-up"
        busyLabel="Saving…"
        onSubmit={async (values) => {
          const created = await sendJson<{ id: string }>('/follow-ups', session.token, 'POST', {
            counterpartyId: counterparty.id,
            values,
          });
          noteFollowUpsChanged();
          onSaved(created.id);
        }}
        onCancel={onCancel}
      />
    </div>
  );
}

/** The usual contact fields, filled in from the draft over the contact's own when listed. */
function ContactReview({
  crm,
  contactId,
  fields,
  onCancel,
  onSaved,
}: {
  crm: CounterpartyCrmState;
  contactId: string | null;
  fields: ContactFieldsValues;
  onCancel: () => void;
  onSaved: (id: string) => void;
}) {
  const { session, counterparty } = crm;
  const contacts = counterparty.contacts ?? [];
  const listed = contacts.find((contact) => contact.id === contactId) ?? null;
  const drafted: ContactFormValues = fields.values;
  const [values, setValues] = useState<FormValues>({
    contactName: drafted.contactName ?? listed?.name ?? '',
    contactRole: drafted.contactRole ?? listed?.role ?? '',
    contactEmail: drafted.contactEmail ?? listed?.email ?? '',
    contactPhone: drafted.contactPhone ?? listed?.phone ?? '',
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
    const path = `/counterparties/${counterparty.id}/contacts`;
    try {
      if (listed === null) {
        const detail = await sendJson<CounterpartyDetail>(path, session.token, 'POST', { values });
        const before = new Set(contacts.map((contact) => contact.id));
        const added = detail.contacts.find((contact) => !before.has(contact.id));
        counterparty.reload?.();
        if (added === undefined) throw new Error('The new contact could not be found.');
        onSaved(added.id);
      } else {
        await sendJson(`${path}/${listed.id}`, session.token, 'PATCH', {
          version: listed.version,
          values,
        });
        counterparty.reload?.();
        onSaved(listed.id);
      }
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
      className="flex flex-col gap-3 border-t pt-3"
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

/**
 * Claude's reading of one recording: the voicemail mark with its correction, Claude's notes
 * with Use as notes, and the drafts. `saveAsNotes` saves the notes as the entry's own (a new
 * version), when the entry has none.
 */
export function CallReadingPanel({
  crm,
  recording,
  saveAsNotes,
}: {
  crm: CounterpartyCrmState;
  recording: CallRecordingView;
  saveAsNotes: ((notes: string) => Promise<void>) | null;
}) {
  const { session, writer } = crm;
  const reading = recording.reading;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (reading === null) {
    return recording.readingFailed ? (
      <p className="text-xs text-muted-foreground">Claude could not read this call.</p>
    ) : recording.transcript !== null && recording.transcript.trim() !== '' ? (
      <p className="text-xs text-muted-foreground">Claude is reading this call…</p>
    ) : null;
  }

  async function act(run: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await run();
      crm.changed(message);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const voicemail = (value: boolean) =>
    act(
      () =>
        sendJson(`/calls/recordings/${recording.id}/voicemail`, session.token, 'POST', {
          voicemail: value,
        }),
      value ? 'Marked as a voicemail.' : 'Marked as not a voicemail.',
    );
  const drafts = [...reading.drafts].sort(
    (a, b) => Number(a.status !== 'open') - Number(b.status !== 'open'),
  );

  return (
    <section
      aria-label="Claude's reading of the call"
      className="flex flex-col gap-2 rounded-control border border-info-border bg-info-subtle/40 px-3 py-2"
    >
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Bot aria-hidden="true" className="size-3.5" />
        Drafted by Claude, {formatAlberta(reading.readAt, { weekday: false })}. Nothing is saved
        until you save it.
      </p>
      {(reading.voicemail || reading.claudeVoicemail) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {reading.voicemail ? (
            <Badge variant="caution">
              <Voicemail aria-hidden="true" />
              Voicemail
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">
              Not a voicemail, said {reading.voicemailCorrectedByName}
            </span>
          )}
          {writer && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2"
              disabled={busy}
              onClick={() => void voicemail(!reading.voicemail)}
            >
              {reading.voicemail ? 'Not a voicemail' : 'It was a voicemail'}
            </Button>
          )}
        </div>
      )}
      {reading.summary !== null && (
        <div className="flex flex-col gap-1">
          <p className="text-sm whitespace-pre-line">{reading.summary}</p>
          {saveAsNotes !== null && writer && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-fit px-2"
              disabled={busy}
              onClick={() => void act(() => saveAsNotes(reading.summary ?? ''), 'Notes saved.')}
            >
              Use as notes
            </Button>
          )}
        </div>
      )}
      {drafts.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Drafts from the call">
          {drafts.map((draft) => (
            <DraftCard key={draft.id} crm={crm} draft={draft} recording={recording} />
          ))}
        </ul>
      )}
      {error !== null && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
