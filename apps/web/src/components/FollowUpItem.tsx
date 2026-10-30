import { formatAlberta, utcToAlberta, type FollowUp, type TeamMemberName } from '@grain/domain';
import { AlarmClock, CalendarClock, Check, CircleCheck, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { sendJson } from '../lib/api';
import {
  canFinish,
  canLogContacts,
  canRemoveFollowUps,
  dueState,
  noteFollowUpsChanged,
} from '../lib/crm';
import { Link } from '../lib/router';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import { FollowUpForm } from './CrmForms';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

/** Overdue, Due today or the due time; Done with when. Always a word, never colour alone. */
export function DueBadge({ followUp, now }: { followUp: FollowUp; now?: Date }) {
  const state = dueState(followUp, now);
  if (state === 'done') {
    return (
      <Badge variant="success">
        <CircleCheck aria-hidden="true" />
        Done
      </Badge>
    );
  }
  if (state === 'overdue') {
    return (
      <Badge variant="danger">
        <AlarmClock aria-hidden="true" />
        Overdue
      </Badge>
    );
  }
  if (state === 'today') {
    return (
      <Badge variant="caution">
        <CalendarClock aria-hidden="true" />
        Due today
      </Badge>
    );
  }
  return null;
}

/**
 * One follow-up: what to do, when it is due (Alberta time), who is responsible, and, for
 * those allowed, Mark done and Edit. `showCounterparty` names the counterparty (on the
 * Follow-ups page; on a counterparty's own page it goes without saying). With `removable`,
 * admins also get Remove, open or done (owner's request, 2026-10-30).
 */
export function FollowUpItem({
  session,
  followUp,
  team,
  showCounterparty = false,
  removable = false,
  onChanged,
}: {
  session: DirectorySession;
  followUp: FollowUp;
  team: readonly TeamMemberName[] | null;
  showCounterparty?: boolean;
  removable?: boolean;
  onChanged: (message: string) => void;
}) {
  const { token, organization } = session;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const done = followUp.doneAt !== null;
  const remover = removable && canRemoveFollowUps(organization.role);
  const planner = canLogContacts(organization.role) && !followUp.counterparty.archived;
  const finisher = canFinish(followUp, organization.role, session.userId);
  const name = followUp.counterparty.tradingName ?? followUp.counterparty.legalName;

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      await sendJson(`/follow-ups/${followUp.id}/done`, token, 'POST');
      noteFollowUpsChanged();
      onChanged('Follow-up marked done.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await sendJson(`/follow-ups/${followUp.id}/remove`, token, 'POST');
      noteFollowUpsChanged();
      onChanged('Follow-up removed.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  if (editing && team) {
    return (
      <li className="px-4 py-3">
        <p className="mb-3 text-sm font-medium">Change follow-up</p>
        <FollowUpForm
          initial={{
            task: followUp.task,
            dueAt: utcToAlberta(followUp.dueAt),
            assignedTo: followUp.assignedTo.userId,
          }}
          team={team}
          submitLabel="Save follow-up"
          busyLabel="Saving…"
          onSubmit={async (values) => {
            await sendJson(`/follow-ups/${followUp.id}`, token, 'PATCH', {
              version: followUp.version,
              values,
            });
            noteFollowUpsChanged();
            setEditing(false);
            onChanged('Follow-up saved.');
          }}
          onCancel={() => {
            setEditing(false);
          }}
          onReload={() => {
            setEditing(false);
            onChanged('');
          }}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <DueBadge followUp={followUp} />
          <span className="font-medium">{followUp.task}</span>
        </div>
        {showCounterparty && (
          <Link
            href={`/counterparties/${followUp.counterparty.id}`}
            className="w-fit text-sm font-medium underline-offset-4 hover:underline"
          >
            {name}
            {followUp.counterparty.archived && ' (archived)'}
          </Link>
        )}
        <p className="text-sm">
          Due {formatAlberta(followUp.dueAt)} · {followUp.assignedTo.name}
        </p>
        <p className="text-xs text-muted-foreground">
          {done && followUp.doneAt
            ? `Done ${formatAlberta(followUp.doneAt)} by ${followUp.doneByName ?? 'GSS staff'}`
            : `Planned by ${followUp.createdByName}${followUp.contactLogEntryId ? ' after a contact' : ''}`}
        </p>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
      {confirming ? (
        <div
          role="group"
          aria-label={`Remove follow-up: ${followUp.task}`}
          className="flex basis-full flex-col gap-2 rounded-control border bg-muted/40 p-3 text-sm"
        >
          <p>
            Remove <strong>{followUp.task}</strong>? It leaves every list; the audit trail keeps it,
            with who removed it and when.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="danger" disabled={busy} onClick={() => void remove()}>
              {busy ? 'Removing…' : 'Remove'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
              }}
            >
              Keep it
            </Button>
          </div>
        </div>
      ) : (
        ((!done && (finisher || planner)) || remover) && (
          <div className="flex gap-1">
            {!done && finisher && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                aria-label={`Mark done: ${followUp.task}`}
                onClick={() => void finish()}
              >
                <Check aria-hidden="true" />
                {busy ? 'Saving…' : 'Mark done'}
              </Button>
            )}
            {!done && planner && team && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Edit follow-up: ${followUp.task}`}
                onClick={() => {
                  setEditing(true);
                }}
              >
                <Pencil aria-hidden="true" />
                Edit
              </Button>
            )}
            {remover && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove follow-up: ${followUp.task}`}
                onClick={() => {
                  setError(null);
                  setConfirming(true);
                }}
              >
                <Trash2 aria-hidden="true" />
                Remove
              </Button>
            )}
          </div>
        )
      )}
    </li>
  );
}
