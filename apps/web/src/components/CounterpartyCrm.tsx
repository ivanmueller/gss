import {
  CONTACT_CHANNEL_LABELS,
  formatAlberta,
  utcToAlberta,
  type ContactLogEntry,
  type FollowUp,
  type TeamMemberName,
} from '@grain/domain';
import { History, Mail, MapPin, MessageSquarePlus, Pencil, Phone, Plus, Users } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { sendJson } from '../lib/api';
import { canLogContacts, defaultDueInput, noteFollowUpsChanged } from '../lib/crm';
import { albertaNowInput } from '../lib/time';
import { useApiResource, type Resource } from '../lib/useApiResource';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import { ContactLogForm, FollowUpForm } from './CrmForms';
import { FollowUpItem } from './FollowUpItem';
import { Button } from './ui/button';
import { Card, CardHeader, CardTitle } from './ui/card';

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
  session,
  entry,
  contactNames,
  canCorrect,
  onChanged,
}: {
  session: DirectorySession;
  entry: ContactLogEntry;
  contactNames: readonly string[];
  canCorrect: boolean;
  onChanged: (message: string) => void;
}) {
  const [correcting, setCorrecting] = useState(false);
  const [history, setHistory] = useState(false);
  const { current } = entry;
  const Icon = CHANNEL_ICONS[current.channel];
  const earlier = entry.revisions.slice(1);

  if (correcting) {
    return (
      <li className="px-4 py-3">
        <p className="mb-3 text-sm font-medium">Correct this entry</p>
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
            setCorrecting(false);
            onChanged('Correction saved.');
          }}
          onCancel={() => {
            setCorrecting(false);
          }}
          onReload={() => {
            setCorrecting(false);
            onChanged('');
          }}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-1 gap-3">
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col gap-1">
          <Revision revision={current} />
          <p className="text-xs text-muted-foreground">
            Logged by {entry.revisions.at(-1)?.recordedByName ?? current.recordedByName}
            {earlier.length > 0 &&
              ` · corrected by ${current.recordedByName}, ${formatAlberta(current.recordedAt)}`}
          </p>
          {earlier.length > 0 && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                aria-expanded={history}
                className="flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => {
                  setHistory((open) => !open);
                }}
              >
                <History aria-hidden="true" className="size-3.5" />
                {history
                  ? 'Hide earlier versions'
                  : `Show earlier versions (${String(earlier.length)})`}
              </button>
              {history && (
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
              )}
            </div>
          )}
        </div>
      </div>
      {canCorrect && (
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Correct: ${contactTitle(current)}`}
          onClick={() => {
            setCorrecting(true);
          }}
        >
          <Pencil aria-hidden="true" />
          Correct
        </Button>
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
  counterparty: { id: string; archived: boolean; contactNames: readonly string[] };
  team: TeamMemberName[] | null;
  log: Resource<ContactLogResponse>;
  followUps: Resource<FollowUpListResponse>;
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
  const [followUps, reloadFollowUps] = useApiResource<FollowUpListResponse>(
    `/follow-ups?counterparty_id=${counterparty.id}&status=all`,
    token,
  );
  const [adding, setAdding] = useState<CrmAdding>(null);
  const [message, setMessage] = useState<string | null>(null);
  const writer = canLogContacts(organization.role) && !counterparty.archived;
  return {
    session,
    counterparty,
    team,
    log,
    followUps,
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

/** A counterparty's contact history, latest contact first, with Log contact. */
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
                session={session}
                entry={entry}
                contactNames={counterparty.contactNames}
                canCorrect={writer}
                onChanged={changed}
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
