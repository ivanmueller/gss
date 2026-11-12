import { draftAge, formatAlberta, type EmailAutoDraftView } from '@grain/domain';
import { useState } from 'react';

import { ApiError, sendJson } from '../lib/api';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import { ClaudeMark } from './ClaudeMark';
import { Button } from './ui/button';

// Claude's email drafts waiting for a person (F-114 step 5c; the owner's answers 29 to 34): on a
// company's Emails card and on Follow-ups. Open fills the usual email form; Dismiss puts a draft
// away for good. Nothing is sent until a person clicks Send in the form.

/** What a draft is: a reply to a received email, an email after a call, or a reminder. */
export function autoDraftTitle(draft: EmailAutoDraftView): string {
  if (draft.source === 'reminder') {
    const subject =
      draft.emailSubject === null || draft.emailSubject === '' ? '' : ` “${draft.emailSubject}”`;
    const when = draft.emailAt === null ? '' : `, sent ${formatAlberta(draft.emailAt)}`;
    return `Reminder: no answer to${subject === '' ? ' your email' : subject}${when}`;
  }
  if (draft.source === 'email') {
    const subject =
      draft.emailSubject === null || draft.emailSubject === '' ? '' : ` “${draft.emailSubject}”`;
    return `Reply to ${draft.emailFrom ?? 'an email'}’s email${subject}`;
  }
  const when = draft.callAt === null ? '' : `, ${formatAlberta(draft.callAt)}`;
  return `Email after the call with ${draft.callContactName ?? 'the contact'}${when}`;
}

export function AutoDraftList({
  session,
  drafts,
  showCompany = false,
  onOpen,
  onChanged,
}: {
  session: DirectorySession;
  drafts: EmailAutoDraftView[];
  /** On Follow-ups: each draft names its company. */
  showCompany?: boolean;
  onOpen: (draft: EmailAutoDraftView) => void;
  /** After a dismissal (or a refusal that means the list is out of date). */
  onChanged: () => void;
}) {
  const { token, organization } = session;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = new Date();

  function dismiss(draft: EmailAutoDraftView) {
    if (!window.confirm('Dismiss Claude’s draft? It will not be offered again.')) return;
    setBusy(draft.id);
    setError(null);
    sendJson(
      `/email-auto-drafts/${draft.id}/dismiss?organization_id=${organization.id}`,
      token,
      'POST',
      {},
    )
      .then(() => {
        onChanged();
      })
      .catch((reason: unknown) => {
        if (reason instanceof ApiError && reason.status === 409) onChanged();
        setError(reason instanceof Error ? reason.message : 'The draft could not be dismissed.');
      })
      .finally(() => {
        setBusy(null);
      });
  }

  return (
    <div className="flex flex-col gap-2">
      {error !== null && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {drafts.map((draft) => (
          <li
            key={draft.id}
            className="flex flex-col gap-1.5 rounded-control border border-l-[3px] border-claude-border border-l-claude-mark bg-claude-subtle px-3 py-2 text-sm"
          >
            <div className="flex items-start gap-2">
              <ClaudeMark className="mt-0.5" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">{autoDraftTitle(draft)}</span>
                {showCompany && (
                  <a
                    href={`/counterparties/${draft.counterpartyId}`}
                    className="w-fit text-xs underline underline-offset-2"
                  >
                    {draft.counterpartyName}
                  </a>
                )}
                <span className="text-xs text-muted-foreground">
                  {draft.subject} · for {draft.assignedToName ?? 'anyone'} ·{' '}
                  {draftAge(draft.draftedAt, now)}
                </span>
                {draft.answeredSince !== null && (
                  <span className="text-xs text-warning">
                    Answered since by {draft.answeredSince.by},{' '}
                    {formatAlberta(draft.answeredSince.at)}.
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                aria-label={`Open Claude’s draft: ${autoDraftTitle(draft)}`}
                onClick={() => {
                  onOpen(draft);
                }}
              >
                Open
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                aria-label={`Dismiss Claude’s draft: ${autoDraftTitle(draft)}`}
                onClick={() => {
                  dismiss(draft);
                }}
              >
                {busy === draft.id ? 'Dismissing…' : 'Dismiss'}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
