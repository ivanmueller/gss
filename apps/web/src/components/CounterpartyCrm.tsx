import {
  CONTACT_CHANNEL_LABELS,
  formatAlberta,
  utcToAlberta,
  type ContactLogEntry,
  type FollowUp,
  type TeamMemberName,
  type CallRecordingView,
  type OpenDraftList,
} from '@grain/domain';
import {
  Ellipsis,
  History,
  Mail,
  MapPin,
  MessageSquarePlus,
  Pencil,
  Phone,
  Pin,
  PinOff,
  Plus,
  Trash2,
  Users,
  Voicemail,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { sendJson, type Contact } from '../lib/api';
import {
  canLogContacts,
  canRemoveContactLog,
  defaultDueInput,
  noteFollowUpsChanged,
} from '../lib/crm';
import { albertaNowInput } from '../lib/time';
import { useApiResource, type Resource } from '../lib/useApiResource';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import { ContactLogForm, FollowUpForm } from './CrmForms';
import { CallReadingPanel, reachedVoicemail } from './CallDrafts';
import { ClaudeMark } from './ClaudeMark';
import { ClaudeDraftList, draftsOf, useOpenDrafts, type DraftPlace } from './ClaudeDrafts';
import { CallRecordingDetails } from './Calling';
import { FollowUpItem } from './FollowUpItem';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardHeader, CardTitle } from './ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

export interface ContactLogResponse {
  entries: ContactLogEntry[];
  truncated: boolean;
}

export interface FollowUpListResponse {
  followUps: FollowUp[];
  truncated: boolean;
}

export interface TeamResponse {
  members: TeamMemberName[];
}

const CHANNEL_ICONS = { call: Phone, email: Mail, meeting: Users, visit: MapPin } as const;

/** The team who can be made responsible, for those who plan follow-ups; null for others. */
export function useTeam(session: DirectorySession): TeamMemberName[] | null {
  const { token, organization } = session;
  const [team] = useApiResource<TeamResponse>(
    canLogContacts(organization.role)
      ? `/follow-ups/team?organization_id=${organization.id}`
      : null,
    token,
  );
  return team.status === 'ok' ? team.data.members : null;
}

/** "Call with Pat Buyer": how and with whom. */
function contactTitle(entry: ContactLogEntry['current']): string {
  return `${CONTACT_CHANNEL_LABELS[entry.channel]} with ${entry.contactName}`;
}

function Revision({ revision }: { revision: ContactLogEntry['current'] }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-sm">
        <span className="font-medium">{contactTitle(revision)}</span> ·{' '}
        {formatAlberta(revision.occurredAt)}
      </p>
      {revision.notes && <p className="text-sm whitespace-pre-line">{revision.notes}</p>}
    </div>
  );
}

function Entry({
  crm,
  session,
  entry,
  contactNames,
  canCorrect,
  canRemove,
  onChanged,
  recordings,
}: {
  crm: CounterpartyCrmState;
  session: DirectorySession;
  entry: ContactLogEntry;
  contactNames: readonly string[];
  /** Edit (a correction) and pin: traders, operations and admins, while not archived. */
  canCorrect: boolean;
  /** Remove: admins (the owner's answer of 2026-11-03). */
  canRemove: boolean;
  onChanged: (message: string) => void;
  /** Recordings of the call this entry was written for (a call placed from the platform). */
  recordings: readonly CallRecordingView[];
}) {
  const [mode, setMode] = useState<'view' | 'correct' | 'remove'>('view');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { current } = entry;
  const Icon = CHANNEL_ICONS[current.channel];
  const earlier = entry.revisions.slice(1);
  const title = contactTitle(current);
  const loggedBy = entry.revisions.at(-1)?.recordedByName ?? current.recordedByName;
  const firstLine = (text: string | null | undefined) =>
    text?.split('\n').find((line) => line.trim() !== '') ?? null;
  const summary = firstLine(current.notes);
  // Without notes of its own, the line shows the start of Claude's notes of the call.
  const claudeSummary =
    summary === null
      ? (recordings.map((recording) => firstLine(recording.reading?.summary)).find(Boolean) ?? null)
      : null;
  const voicemail = reachedVoicemail(recordings);
  // Opening shows what the two lines leave out: all the notes (the line can cut even a single
  // paragraph short; Codex's review of ac2d085, finding 1), the call, earlier versions.
  const hasMore = recordings.length > 0 || earlier.length > 0 || summary !== null;
  // Claude's notes become the entry's own (a new version) only while it has none.
  const saveAsNotes =
    canCorrect && (current.notes ?? '').trim() === ''
      ? async (notes: string) => {
          await sendJson(`/contact-log/${entry.id}/revisions`, session.token, 'POST', {
            basedOnRevision: current.revisionNumber,
            values: {
              occurredAt: new Date(current.occurredAt).toISOString(),
              channel: current.channel,
              contactName: current.contactName,
              notes,
            },
          });
        }
      : null;

  async function act(run: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await run();
      setMode('view');
      onChanged(message);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'correct') {
    return (
      <li className="px-4 py-3">
        <p className="mb-3 text-sm font-medium">Edit this entry</p>
        <p className="mb-3 text-xs text-muted-foreground">
          The entry as it was stays in its history.
        </p>
        <ContactLogForm
          initial={{
            occurredAt: utcToAlberta(current.occurredAt),
            channel: current.channel,
            contactName: current.contactName,
            notes: current.notes ?? '',
          }}
          contactNames={contactNames}
          submitLabel="Save correction"
          busyLabel="Saving…"
          onSubmit={async (values) => {
            await sendJson(`/contact-log/${entry.id}/revisions`, session.token, 'POST', {
              basedOnRevision: current.revisionNumber,
              values,
            });
            setMode('view');
            onChanged('Correction saved.');
          }}
          onCancel={() => {
            setMode('view');
          }}
          onReload={() => {
            setMode('view');
            onChanged('');
          }}
        />
      </li>
    );
  }

  const menu = canCorrect || canRemove;
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start gap-3">
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <button
          type="button"
          disabled={!hasMore}
          aria-expanded={hasMore ? open : undefined}
          className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-inset text-left outline-none focus-visible:ring-2 focus-visible:ring-ring enabled:cursor-pointer"
          onClick={() => {
            setOpen((value) => !value);
          }}
        >
          <span className="flex min-w-0 items-center gap-1.5 text-sm">
            {entry.pinned && (
              <Pin aria-label="Pinned" className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="shrink-0 font-medium">{title}</span>
            {voicemail && (
              <Badge variant="caution" className="shrink-0">
                <Voicemail aria-hidden="true" />
                Voicemail
              </Badge>
            )}
            {summary !== null && (
              <span className="min-w-0 truncate text-muted-foreground">· {summary}</span>
            )}
            {claudeSummary !== null && (
              <span className="min-w-0 truncate text-muted-foreground">
                · <ClaudeMark label="Claude's notes" className="inline size-3.5 align-[-2px]" />{' '}
                {claudeSummary}
              </span>
            )}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatAlberta(current.occurredAt)} by {loggedBy}
            {earlier.length > 0 && ' · edited'}
          </span>
        </button>
        {menu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Actions: ${title}, ${formatAlberta(current.occurredAt)}`}
                disabled={busy}
              >
                <Ellipsis aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              {canCorrect && (
                <DropdownMenuItem
                  onSelect={() =>
                    void act(
                      () =>
                        sendJson(
                          `/contact-log/${entry.id}/pin`,
                          session.token,
                          entry.pinned ? 'DELETE' : 'PUT',
                        ),
                      entry.pinned ? 'Unpinned.' : 'Pinned to the top.',
                    )
                  }
                >
                  {entry.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
                  {entry.pinned ? 'Unpin' : 'Pin to the top'}
                </DropdownMenuItem>
              )}
              {canCorrect && (
                <DropdownMenuItem
                  onSelect={() => {
                    setMode('correct');
                  }}
                >
                  <Pencil aria-hidden="true" />
                  Edit
                </DropdownMenuItem>
              )}
              {canRemove && (
                <DropdownMenuItem
                  className="text-danger data-highlighted:text-danger"
                  onSelect={() => {
                    setMode('remove');
                  }}
                >
                  <Trash2 aria-hidden="true" />
                  Remove
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {mode === 'remove' && (
        <div
          role="group"
          aria-label={`Remove: ${title}`}
          className="ml-7 flex flex-col gap-2 rounded-control border bg-muted/40 p-3 text-sm"
        >
          <p>
            Remove <strong>{title}</strong> from the contact history? It is kept in the records with
            its call and transcript, but nobody sees it here again.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={() =>
                void act(
                  () => sendJson(`/contact-log/${entry.id}/removal`, session.token, 'POST'),
                  'Entry removed.',
                )
              }
            >
              {busy ? 'Removing…' : 'Remove'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setMode('view');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error !== null && (
        <p role="alert" className="ml-7 text-xs text-danger">
          {error}
        </p>
      )}
      {open && hasMore && (
        <div className="ml-7 flex flex-col gap-2">
          {current.notes && <p className="text-sm whitespace-pre-line">{current.notes}</p>}
          {recordings.map((recording) => (
            <div key={recording.id} className="flex flex-col gap-2">
              <CallRecordingDetails token={session.token} recording={recording} />
              <CallReadingPanel crm={crm} recording={recording} saveAsNotes={saveAsNotes} />
            </div>
          ))}
          {earlier.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <History aria-hidden="true" className="size-3.5" />
                Edited by {current.recordedByName}, {formatAlberta(current.recordedAt)}. Earlier
                versions:
              </p>
              <ol className="flex flex-col gap-2 border-l-2 pl-3" aria-label="Earlier versions">
                {earlier.map((revision) => (
                  <li key={revision.id} className="flex flex-col gap-0.5 text-muted-foreground">
                    <Revision revision={revision} />
                    <p className="text-xs">
                      Version {revision.revisionNumber}, recorded by {revision.recordedByName},{' '}
                      {formatAlberta(revision.recordedAt)}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Status({ children, alert = false }: { children: ReactNode; alert?: boolean }) {
  return alert ? (
    <p role="alert" className="px-4 py-4 text-sm text-danger">
      {children}
    </p>
  ) : (
    <p className="px-4 py-4 text-sm text-muted-foreground">{children}</p>
  );
}

export type CrmAdding = 'contact' | 'follow-up' | null;

/** The CRM of one counterparty, shared by its follow-ups, its history and the page's header. */
export interface CounterpartyCrmState {
  session: DirectorySession;
  counterparty: {
    id: string;
    archived: boolean;
    contactNames: readonly string[];
    /** Its contacts, for drafts of a contact's new details (the counterparty's page). */
    contacts?: readonly Contact[];
    /** Loads the page again after a draft was saved as a contact, bid or offer. */
    reload?: () => void;
  };
  team: TeamMemberName[] | null;
  log: Resource<ContactLogResponse>;
  followUps: Resource<FollowUpListResponse>;
  /** Recordings and transcripts of calls placed from the platform to this counterparty. */
  recordings: Resource<{ recordings: CallRecordingView[] }>;
  /** Claude's open drafts from its calls, shown in Contacts, Bids and offers and Follow-ups. */
  drafts: Resource<OpenDraftList>;
  /** The form that is open: logging a contact or planning a follow-up. */
  adding: CrmAdding;
  startAdding: (what: Exclude<CrmAdding, null>) => void;
  stopAdding: () => void;
  /** May log contacts and plan follow-ups here (and the counterparty is not archived). */
  writer: boolean;
  /** Whether a follow-up can be planned now (the team list has loaded). */
  canPlan: boolean;
  message: string | null;
  /** After a change: shows the message (none for '') and loads the lists again. */
  changed: (message: string) => void;
}

export function useCounterpartyCrm(
  session: DirectorySession,
  counterparty: CounterpartyCrmState['counterparty'],
): CounterpartyCrmState {
  const { token, organization } = session;
  const team = useTeam(session);
  const [log, reloadLog] = useApiResource<ContactLogResponse>(
    `/contact-log?counterparty_id=${counterparty.id}`,
    token,
  );
  const [recordings, reloadRecordings] = useApiResource<{ recordings: CallRecordingView[] }>(
    `/calls/recordings?counterparty_id=${counterparty.id}`,
    token,
  );
  const [followUps, reloadFollowUps] = useApiResource<FollowUpListResponse>(
    `/follow-ups?counterparty_id=${counterparty.id}&status=all`,
    token,
  );
  const [drafts, reloadDrafts] = useOpenDrafts(session, { counterpartyId: counterparty.id });
  const [adding, setAdding] = useState<CrmAdding>(null);
  const [message, setMessage] = useState<string | null>(null);
  const writer = canLogContacts(organization.role) && !counterparty.archived;
  return {
    session,
    counterparty,
    team,
    log,
    followUps,
    recordings,
    drafts,
    adding,
    startAdding: (what) => {
      setAdding(what);
      setMessage(null);
    },
    stopAdding: () => {
      setAdding(null);
    },
    writer,
    canPlan: writer && team !== null,
    message,
    changed: (next) => {
      setMessage(next === '' ? null : next);
      reloadLog();
      reloadFollowUps();
      reloadRecordings();
      reloadDrafts();
    },
  };
}

/** Where Claude's drafts are shown on a company's page: saved or dismissed, the page reloads. */
export function crmDraftPlace(crm: CounterpartyCrmState): DraftPlace {
  return {
    session: crm.session,
    contacts: crm.counterparty.contacts ?? [],
    team: crm.team,
    onChanged: (message, kind) => {
      crm.changed(message);
      if (kind !== 'follow_up') crm.counterparty.reload?.();
    },
  };
}

/** The next open follow-up (soonest due), or null. */
export function nextFollowUp(followUps: readonly FollowUp[]): FollowUp | null {
  let next: FollowUp | null = null;
  for (const followUp of followUps) {
    if (followUp.doneAt === null && (next === null || followUp.dueAt < next.dueAt)) next = followUp;
  }
  return next;
}

/** The latest contact logged (by when it happened), or null. */
export function lastContact(entries: readonly ContactLogEntry[]): ContactLogEntry | null {
  let last: ContactLogEntry | null = null;
  for (const entry of entries) {
    if (last === null || entry.current.occurredAt > last.current.occurredAt) last = entry;
  }
  return last;
}

/** Brings a form opened from elsewhere on the page (the header's buttons) into view. */
function useShowWhenOpened(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    // jsdom has no scrollIntoView.
    if (
      open &&
      element &&
      'scrollIntoView' in element &&
      typeof element.scrollIntoView === 'function'
    ) {
      element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [open]);
  return ref;
}

export function CrmMessage({ crm }: { crm: CounterpartyCrmState }) {
  return crm.message ? (
    <p role="status" className="text-sm text-success">
      {crm.message}
    </p>
  ) : null;
}

/** A counterparty's follow-ups: open ones soonest due first, done ones on request. */
export function FollowUpsCard({ crm }: { crm: CounterpartyCrmState }) {
  const { session, counterparty, team, followUps, adding, writer, changed } = crm;
  const [showDone, setShowDone] = useState(false);
  const formRef = useShowWhenOpened(adding === 'follow-up');
  const followUpDefaults = {
    task: '',
    dueAt: defaultDueInput(),
    assignedTo: session.userId ?? '',
  };
  const open = followUps.status === 'ok' ? followUps.data.followUps.filter((f) => !f.doneAt) : [];
  const done = followUps.status === 'ok' ? followUps.data.followUps.filter((f) => f.doneAt) : [];

  return (
    <Card asChild className="overflow-hidden">
      <section aria-labelledby="follow-ups-heading">
        <CardHeader>
          <CardTitle id="follow-ups-heading">
            Follow-ups{followUps.status === 'ok' && ` (${String(open.length)} open)`}
          </CardTitle>
          {writer && team && adding !== 'follow-up' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                crm.startAdding('follow-up');
              }}
            >
              <Plus aria-hidden="true" />
              Plan follow-up
            </Button>
          )}
        </CardHeader>
        {adding === 'follow-up' && team && (
          <div ref={formRef} className="border-b px-4 py-4">
            <FollowUpForm
              initial={followUpDefaults}
              team={team}
              submitLabel="Save follow-up"
              busyLabel="Saving…"
              onSubmit={async (values) => {
                await sendJson('/follow-ups', session.token, 'POST', {
                  counterpartyId: counterparty.id,
                  values,
                });
                noteFollowUpsChanged();
                crm.stopAdding();
                changed('Follow-up planned.');
              }}
              onCancel={crm.stopAdding}
            />
          </div>
        )}
        <ClaudeDraftList
          drafts={draftsOf(crm.drafts, 'follow_up')}
          place={crmDraftPlace(crm)}
          className="border-b px-4 py-3"
        />
        {followUps.status === 'loading' && <Status>Loading…</Status>}
        {followUps.status === 'error' && (
          <Status alert>Could not load follow-ups: {followUps.error.message}</Status>
        )}
        {followUps.status === 'ok' && open.length === 0 && <Status>No open follow-ups.</Status>}
        {open.length > 0 && (
          <ul className="divide-y" aria-label="Open follow-ups">
            {open.map((followUp) => (
              <FollowUpItem
                key={followUp.id}
                session={session}
                followUp={followUp}
                team={team}
                removable
                onChanged={changed}
              />
            ))}
          </ul>
        )}
        {done.length > 0 && (
          <div className="border-t px-4 py-3">
            <button
              type="button"
              aria-expanded={showDone}
              className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => {
                setShowDone((current) => !current);
              }}
            >
              {showDone ? 'Hide done' : `Show done (${String(done.length)})`}
            </button>
          </div>
        )}
        {showDone && done.length > 0 && (
          <ul className="divide-y border-t" aria-label="Done follow-ups">
            {done.map((followUp) => (
              <FollowUpItem
                key={followUp.id}
                session={session}
                followUp={followUp}
                team={team}
                removable
                onChanged={changed}
              />
            ))}
          </ul>
        )}
      </section>
    </Card>
  );
}

/** A counterparty's contact history, pinned entries first, then latest contact first. */
export function ContactHistoryCard({ crm }: { crm: CounterpartyCrmState }) {
  const { session, counterparty, team, log, adding, writer, changed } = crm;
  const formRef = useShowWhenOpened(adding === 'contact');
  const followUpDefaults = {
    task: '',
    dueAt: defaultDueInput(),
    assignedTo: session.userId ?? '',
  };

  return (
    <Card asChild className="overflow-hidden">
      <section aria-labelledby="contact-history-heading">
        <CardHeader>
          <CardTitle id="contact-history-heading">
            Contact history{log.status === 'ok' && ` (${String(log.data.entries.length)})`}
          </CardTitle>
          {writer && adding !== 'contact' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                crm.startAdding('contact');
              }}
            >
              <MessageSquarePlus aria-hidden="true" />
              Log contact
            </Button>
          )}
        </CardHeader>
        {adding === 'contact' && (
          <div ref={formRef} className="border-b px-4 py-4">
            <ContactLogForm
              initial={{ occurredAt: albertaNowInput(), channel: 'call' }}
              contactNames={counterparty.contactNames}
              {...(team && { team, followUpDefaults })}
              submitLabel="Save contact"
              busyLabel="Saving…"
              onSubmit={async (values, followUp) => {
                await sendJson('/contact-log', session.token, 'POST', {
                  counterpartyId: counterparty.id,
                  values,
                  ...(followUp && { followUp }),
                });
                if (followUp) noteFollowUpsChanged();
                crm.stopAdding();
                changed(followUp ? 'Contact logged and follow-up planned.' : 'Contact logged.');
              }}
              onCancel={crm.stopAdding}
            />
          </div>
        )}
        {log.status === 'loading' && <Status>Loading…</Status>}
        {log.status === 'error' && (
          <Status alert>Could not load the contact history: {log.error.message}</Status>
        )}
        {log.status === 'ok' && log.data.entries.length === 0 && (
          <Status>No contacts logged yet.</Status>
        )}
        {log.status === 'ok' && log.data.entries.length > 0 && (
          <ul className="divide-y" aria-label="Contact history">
            {log.data.entries.map((entry) => (
              <Entry
                key={entry.id}
                crm={crm}
                session={session}
                entry={entry}
                contactNames={counterparty.contactNames}
                canCorrect={writer}
                canRemove={canRemoveContactLog(session.organization.role)}
                onChanged={changed}
                recordings={
                  crm.recordings.status === 'ok'
                    ? crm.recordings.data.recordings.filter(
                        (recording) => recording.contactLogEntryId === entry.id,
                      )
                    : []
                }
              />
            ))}
          </ul>
        )}
      </section>
    </Card>
  );
}

/**
 * The CRM on a counterparty's page (owner's request, 2026-10-29): its follow-ups, open ones
 * soonest due first, and its contact history, latest contact first. Traders, operations and
 * admins log contacts, plan follow-ups and correct entries; nothing new for an archived
 * counterparty.
 */
export function CounterpartyCrm({
  session,
  counterparty,
}: {
  session: DirectorySession;
  counterparty: CounterpartyCrmState['counterparty'];
}) {
  const crm = useCounterpartyCrm(session, counterparty);
  return (
    <>
      <CrmMessage crm={crm} />
      <FollowUpsCard crm={crm} />
      <ContactHistoryCard crm={crm} />
    </>
  );
}
