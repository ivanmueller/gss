import { UNMATCHED_EMAIL_COUNT_CAP, type EmailView, type UnmatchedEmailsView } from '@grain/domain';
import { Inbox } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import {
  ApiError,
  apiJson,
  sendJson,
  type CounterpartyDetail,
  type CounterpartyList,
} from '../lib/api';
import { counterpartyOptions } from '../lib/directory';
import { useApiResource } from '../lib/useApiResource';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import { EmailItem } from './Emails';
import { Button } from './ui/button';
import { Card, CardHeader, CardTitle } from './ui/card';
import { SearchSelect } from './ui/search-select';
import { Select } from './ui/select';

// Received email on no company (F-114 step 4b; the owner's answers 8 to 10 and 15 of
// 2026-11-10/11): mail to GSS's addresses that answers nothing GSS sent and comes from no verified
// contact, or mail to an address of nobody. Everyone on the team reads it, links it to a company
// (it then shows on that company's Emails card) or deletes it (it leaves every list; its record
// is kept). Times in Alberta time. Nothing here answers or forwards mail.

/** The contact of the company whose address is the sender's, when exactly one is. */
export function contactForSender(contacts: CounterpartyDetail['contacts'], sender: string): string {
  const matches = contacts.filter((contact) => contact.email?.trim().toLowerCase() === sender);
  return matches.length === 1 ? (matches[0]?.id ?? '') : '';
}

function LinkForm({
  session,
  email,
  onDone,
  onCancel,
}: {
  session: DirectorySession;
  email: EmailView;
  onDone: (message: string | null) => void;
  onCancel: () => void;
}) {
  const { token, organization } = session;
  const [companyId, setCompanyId] = useState('');
  /** The person's own choice of contact; null until they choose ('' is the company alone). */
  const [chosenContact, setContactId] = useState<string | null>(null);
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
  // Only the chosen company's contacts (never the one chosen before, still shown while loading).
  const contacts =
    detail.status === 'ok' && detail.data.id === companyId ? detail.data.contacts : [];
  // Until the person chooses, the sender's own contact when the company has exactly one.
  const contactId = chosenContact ?? contactForSender(contacts, email.fromAddress);

  function link() {
    setBusy(true);
    setError(null);
    sendJson(`/emails/${email.id}/link?organization_id=${organization.id}`, token, 'POST', {
      counterpartyId: companyId,
      contactId: contactId === '' ? null : contactId,
    })
      .then(() => {
        onDone(null);
      })
      .catch((reason: unknown) => {
        const message = reason instanceof Error ? reason.message : 'The email could not be linked.';
        if (
          reason instanceof ApiError &&
          (reason.status === 404 || reason.code === 'ALREADY_LINKED')
        ) {
          // Linked or deleted by someone else meanwhile: the list is read again.
          onDone(message);
          return;
        }
        setError(message);
        setBusy(false);
      });
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-control border p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <SearchSelect
          aria-label="Company"
          value={companyId}
          onValueChange={(next) => {
            setCompanyId(next);
            setContactId(null);
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

function UnmatchedItem({
  session,
  email,
  onChanged,
}: {
  session: DirectorySession;
  email: EmailView;
  onChanged: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function remove() {
    if (!window.confirm('Delete this email? It leaves every list; its record is kept.')) return;
    setBusy(true);
    setError(null);
    sendJson(
      `/emails/${email.id}/remove?organization_id=${session.organization.id}`,
      session.token,
      'POST',
    )
      .then(() => {
        onChanged(null);
      })
      .catch((reason: unknown) => {
        const message = reason instanceof Error ? reason.message : 'That did not work. Try again.';
        if (reason instanceof ApiError && (reason.status === 404 || reason.status === 403)) {
          // Linked or deleted by someone else meanwhile.
          onChanged(message);
          return;
        }
        setError(message);
        setBusy(false);
      });
  }

  return (
    <EmailItem
      email={email}
      session={session}
      open={open}
      onToggle={() => {
        setOpen((current) => !current);
      }}
    >
      {!linking && (
        <div className="mt-2 flex flex-wrap gap-2">
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
          <Button size="sm" variant="ghost" disabled={busy} onClick={remove}>
            {busy ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      )}
      {linking && (
        <LinkForm
          session={session}
          email={email}
          onDone={onChanged}
          onCancel={() => {
            setLinking(false);
          }}
        />
      )}
      {error !== null && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </EmailItem>
  );
}

/**
 * Received email on no company, on the Follow-ups page; nothing when there is none (or email is
 * not set up).
 */
export function UnmatchedEmails({ session }: { session: DirectorySession }) {
  const { token, organization } = session;
  const base = `/emails/unmatched?organization_id=${organization.id}`;
  const [page, setPage] = useState<UnmatchedEmailsView | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    apiJson<UnmatchedEmailsView>(base, token)
      .then((first) => {
        setPage(first);
        setError(null);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Could not load the email.');
      });
  }, [base, token]);

  useEffect(() => {
    load();
  }, [load]);

  function loadOlder() {
    const last = page?.emails.at(-1);
    if (page === null || last === undefined) return;
    setLoadingOlder(true);
    apiJson<UnmatchedEmailsView>(`${base}&before_id=${last.id}`, token)
      .then((older) => {
        setPage((current) =>
          current === null
            ? older
            : {
                // Each email once, should one have moved between pages.
                emails: [
                  ...current.emails,
                  ...older.emails.filter((e) => !current.emails.some((c) => c.id === e.id)),
                ],
                more: older.more,
                total: older.total,
              },
        );
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Could not load older email.');
      })
      .finally(() => {
        setLoadingOlder(false);
      });
  }

  function changed(message: string | null) {
    setNotice(message);
    load();
  }

  if (page === null && error === null) return null;
  if (page !== null && page.emails.length === 0 && notice === null) return null;
  const total = page?.total ?? 0;
  return (
    <Card asChild className="overflow-hidden">
      <section aria-labelledby="unmatched-emails">
        <CardHeader>
          <CardTitle id="unmatched-emails" className="flex items-center gap-2">
            <Inbox aria-hidden="true" className="size-4" />
            Email on no company (
            {total >= UNMATCHED_EMAIL_COUNT_CAP
              ? `${UNMATCHED_EMAIL_COUNT_CAP.toLocaleString('en-CA')}+`
              : total}
            )
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Email to GSS that answers nothing we sent and is from no known contact, or was sent to
            an address nobody has: link it to its company, or delete it (its record is kept).
          </p>
        </CardHeader>
        <div className="flex flex-col gap-2 px-4 pb-4 text-sm">
          {notice !== null && (
            <p role="status" className="text-xs text-muted-foreground">
              {notice}
            </p>
          )}
          {error !== null && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          {page !== null && page.emails.length > 0 && (
            <ul className="flex flex-col divide-y divide-border">
              {page.emails.map((email) => (
                <UnmatchedItem key={email.id} session={session} email={email} onChanged={changed} />
              ))}
            </ul>
          )}
          {page?.more === true && (
            <div>
              <Button size="sm" variant="ghost" disabled={loadingOlder} onClick={loadOlder}>
                {loadingOlder ? 'Loading…' : 'Show older'}
              </Button>
            </div>
          )}
        </div>
      </section>
    </Card>
  );
}
