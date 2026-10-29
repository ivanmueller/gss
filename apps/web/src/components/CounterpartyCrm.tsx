import {
  CONTACT_CHANNEL_LABELS,
  formatAlberta,
  utcToAlberta,
  type ContactLogEntry,
  type FollowUp,
  type TeamMemberName,
} from '@grain/domain';
import { History, Mail, MapPin, MessageSquarePlus, Pencil, Phone, Plus, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { sendJson } from '../lib/api';
import { canLogContacts, defaultDueInput, noteFollowUpsChanged } from '../lib/crm';
import { albertaNowInput } from '../lib/time';
import { useApiResource } from '../lib/useApiResource';
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
  counterparty: { id: string; archived: boolean; contactNames: readonly string[] };
}) {
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
  const [adding, setAdding] = useState<'contact' | 'follow-up' | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const writer = canLogContacts(organization.role) && !counterparty.archived;
  const followUpDefaults = {
    task: '',
    dueAt: defaultDueInput(),
    assignedTo: session.userId ?? '',
  };

  function changed(next: string) {
    setMessage(next === '' ? null : next);
    reloadLog();
    reloadFollowUps();
  }

  const open = followUps.status === 'ok' ? followUps.data.followUps.filter((f) => !f.doneAt) : [];
  const done = followUps.status === 'ok' ? followUps.data.followUps.filter((f) => f.doneAt) : [];

  return (
    <>
      {message && (
        <p role="status" className="text-sm text-success">
          {message}
        </p>
      )}
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
                  setAdding('follow-up');
                  setMessage(null);
                }}
              >
                <Plus aria-hidden="true" />
                Plan follow-up
              </Button>
            )}
          </CardHeader>
          {adding === 'follow-up' && team && (
            <div className="border-b px-4 py-4">
              <FollowUpForm
                initial={followUpDefaults}
                team={team}
                submitLabel="Save follow-up"
                busyLabel="Saving…"
                onSubmit={async (values) => {
                  await sendJson('/follow-ups', token, 'POST', {
                    counterpartyId: counterparty.id,
                    values,
                  });
                  noteFollowUpsChanged();
                  setAdding(null);
                  changed('Follow-up planned.');
                }}
                onCancel={() => {
                  setAdding(null);
                }}
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
                  onChanged={changed}
                />
              ))}
            </ul>
          )}
        </section>
      </Card>

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
                  setAdding('contact');
                  setMessage(null);
                }}
              >
                <MessageSquarePlus aria-hidden="true" />
                Log contact
              </Button>
            )}
          </CardHeader>
          {adding === 'contact' && (
            <div className="border-b px-4 py-4">
              <ContactLogForm
                initial={{ occurredAt: albertaNowInput(), channel: 'call' }}
                contactNames={counterparty.contactNames}
                {...(team && { team, followUpDefaults })}
                submitLabel="Save contact"
                busyLabel="Saving…"
                onSubmit={async (values, followUp) => {
                  await sendJson('/contact-log', token, 'POST', {
                    counterpartyId: counterparty.id,
                    values,
                    ...(followUp && { followUp }),
                  });
                  if (followUp) noteFollowUpsChanged();
                  setAdding(null);
                  changed(followUp ? 'Contact logged and follow-up planned.' : 'Contact logged.');
                }}
                onCancel={() => {
                  setAdding(null);
                }}
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
    </>
  );
}
