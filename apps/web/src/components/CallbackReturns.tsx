import {
  CALL_OUTCOME_LABELS,
  formatAlberta,
  formatCallLength,
  type CallbackReturnView,
  type CallRecordingView,
} from '@grain/domain';
import { PhoneIncoming } from 'lucide-react';
import { useState } from 'react';

import { sendJson, type CounterpartyDetail, type CounterpartyList } from '../lib/api';
import { canLogContacts, noteFollowUpsChanged } from '../lib/crm';
import { counterpartyOptions } from '../lib/directory';
import { Link } from '../lib/router';
import { useApiResource } from '../lib/useApiResource';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import { CallRecordingDetails } from './Calling';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardHeader, CardTitle } from './ui/card';
import { SearchSelect } from './ui/search-select';
import { Select } from './ui/select';

// Callbacks to GSS's number nobody could be given a follow-up for (the owner's answers of
// 2026-11-06, F-132): a number that matches no company, or a call with nobody to return it. They
// wait here until someone takes one, links it to a company (its entry and follow-up are then
// written there) or dismisses it (a wrong number, say). Times in Alberta time.

/** What happened, in a few words. */
function happened(item: CallbackReturnView): string {
  if (item.outcome === 'talked') {
    const length = item.talkedSeconds === null ? '' : ` ${formatCallLength(item.talkedSeconds)}`;
    return `Talked${length}${item.answeredByName === null ? '' : ` with ${item.answeredByName}`}`;
  }
  return CALL_OUTCOME_LABELS[item.outcome];
}

/** The recording as the call's transcript and Play show it. */
function asRecording(item: CallbackReturnView): CallRecordingView | null {
  const { recording } = item;
  if (recording === null) return null;
  return {
    id: recording.id,
    callId: item.callId,
    contactLogEntryId: null,
    transcript: recording.transcript,
    lines: recording.lines,
    callerName: item.answeredByName ?? 'GSS',
    contactName: item.contactName,
    voicemail: recording.voicemail,
    transcriptFailed: recording.transcriptFailed,
    audioUntil: recording.audioUntil,
    reading: null,
    readingFailed: false,
  };
}

function LinkForm({
  session,
  callId,
  onDone,
  onCancel,
}: {
  session: DirectorySession;
  callId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { token, organization } = session;
  const [companyId, setCompanyId] = useState('');
  const [contactId, setContactId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [list] = useApiResource<CounterpartyList>(
    `/counterparties?organization_id=${organization.id}`,
    token,
  );
  const [detail] = useApiResource<CounterpartyDetail>(
    companyId === '' ? null : `/counterparties/${companyId}`,
    token,
  );
  const choices =
    list.status === 'ok' ? list.data.counterparties.filter((item) => item.archivedAt === null) : [];
  const contacts = detail.status === 'ok' ? detail.data.contacts : [];

  function link() {
    setBusy(true);
    setError(null);
    sendJson(`/callbacks/${callId}/settle`, token, 'POST', {
      action: 'link',
      counterpartyId: companyId,
      contactId: contactId === '' ? null : contactId,
    })
      .then(() => {
        noteFollowUpsChanged();
        onDone();
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'The call could not be linked.');
        setBusy(false);
      });
  }

  return (
    <div className="flex flex-col gap-2 rounded-control border p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <SearchSelect
          aria-label="Company"
          value={companyId}
          onValueChange={(next) => {
            setCompanyId(next);
            setContactId('');
          }}
          placeholder={list.status === 'loading' ? 'Loading…' : 'Choose the company…'}
          options={counterpartyOptions(choices)}
        />
        <Select
          aria-label="Contact"
          value={contactId === '' ? 'none' : contactId}
          onValueChange={(next) => {
            setContactId(next === 'none' ? '' : next);
          }}
          disabled={companyId === '' || contacts.length === 0}
          options={[
            { value: 'none', label: 'No contact (the company)' },
            ...contacts.map((contact) => ({ value: contact.id, label: contact.name })),
          ]}
        />
      </div>
      {error !== null && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={companyId === '' || busy} onClick={link}>
          {busy ? 'Linking…' : 'Link to this company'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ReturnItem({
  session,
  item,
  onChanged,
}: {
  session: DirectorySession;
  item: CallbackReturnView;
  onChanged: () => void;
}) {
  const { token, organization, userId } = session;
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowed = canLogContacts(organization.role);
  const recording = asRecording(item);
  const unknown = item.counterpartyId === null;

  function settle(action: 'take' | 'dismiss') {
    setBusy(true);
    setError(null);
    sendJson(`/callbacks/${item.callId}/settle`, token, 'POST', { action })
      .then(() => {
        noteFollowUpsChanged();
        onChanged();
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'That did not work. Try again.');
      })
      .finally(() => {
        // An unknown number taken stays listed (now theirs), with its other actions (Codex's
        // review of f7a0d73, finding 4).
        setBusy(false);
      });
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <p className="text-sm font-medium">
            {unknown || item.counterpartyId === null ? (
              item.callerPhone
            ) : (
              <Link href={`/counterparties/${item.counterpartyId}`} className="hover:underline">
                {item.contactName} · {item.counterpartyName ?? ''}
              </Link>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatAlberta(item.receivedAt)} · {happened(item)}
            {unknown ? '' : ` · ${item.callerPhone}`}
          </p>
          <p className="text-xs text-muted-foreground">
            {item.ownerName === null ? 'Nobody’s yet' : `${item.ownerName}’s`}
            {item.meantForName === null ? '' : ` · meant for ${item.meantForName}`}
          </p>
        </div>
        <Badge variant={unknown ? 'neutral' : 'caution'}>
          {unknown ? 'Unknown number' : 'Nobody to return it'}
        </Badge>
      </div>
      {recording !== null && <CallRecordingDetails token={token} recording={recording} />}
      {allowed && !linking && (
        <div className="flex flex-wrap gap-2">
          {unknown && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setLinking(true);
              }}
            >
              Link to a company
            </Button>
          )}
          {(!unknown || item.ownerId !== userId) && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                settle('take');
              }}
            >
              {unknown ? 'Take it' : 'Take it (follow-up for me)'}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              settle('dismiss');
            }}
          >
            Dismiss
          </Button>
        </div>
      )}
      {linking && (
        <LinkForm
          session={session}
          callId={item.callId}
          onDone={onChanged}
          onCancel={() => {
            setLinking(false);
          }}
        />
      )}
      {error !== null && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * The calls to GSS's number waiting on the team, on the Follow-ups page; nothing when there are
 * none (or callbacks are not set up).
 */
export function CallbackReturns({ session }: { session: DirectorySession }) {
  const [list, reload] = useApiResource<{ returns: CallbackReturnView[] }>(
    `/callbacks?organization_id=${session.organization.id}`,
    session.token,
  );
  if (list.status !== 'ok' || list.data.returns.length === 0) return null;
  const items = list.data.returns;
  return (
    <Card asChild className="overflow-hidden">
      <section aria-labelledby="callback-returns">
        <CardHeader>
          <CardTitle id="callback-returns" className="flex items-center gap-2">
            <PhoneIncoming aria-hidden="true" className="size-4" />
            Calls to GSS’s number ({items.length})
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Callbacks nobody could be given a follow-up for: link an unknown number to its company,
            take one to return it, or dismiss a wrong number.
          </p>
        </CardHeader>
        <ul className="divide-y">
          {items.map((item) => (
            <ReturnItem key={item.callId} session={session} item={item} onChanged={reload} />
          ))}
        </ul>
      </section>
    </Card>
  );
}
