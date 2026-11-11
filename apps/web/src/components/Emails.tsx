import {
  composeEmailBody,
  EMAIL_MAX_RECIPIENTS,
  EMAIL_MESSAGE_MAX,
  EMAIL_STATE_LABELS,
  EMAIL_SUBJECT_MAX,
  fillSignature,
  formatAlberta,
  normalizeEmailAddress,
  type EmailSettingsView,
  type EmailView,
} from '@grain/domain';
import { Mail, Send } from 'lucide-react';
import { createContext, useContext, useEffect, useId, useState, type ReactNode } from 'react';

import { apiJson, ApiError, sendJson, type Contact } from '../lib/api';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import { Badge, type BadgeVariant } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Dialog, DialogContent } from './ui/dialog';
import { Input, Textarea } from './ui/input';

// Email sent by hand from a company's page (F-114 step 3): **Email** beside a contact's address
// and **New email** in the page's ⋯ menu open one form; the person writes, checks the signature
// and clicks Send. The Worker sends it through Cloudflare and keeps it; the Emails card lists the
// company's emails. Nothing is sent by itself and nothing is retried by itself.

interface Composer {
  /** Opens the form, addressed to a contact when given. */
  compose: (contact?: Contact) => void;
}

const ComposerContext = createContext<Composer | null>(null);
const ReloadContext = createContext(0);

/** How many emails were sent from this page: the contact history is loaded again on each. */
export function useEmailsSent(): number {
  return useContext(ReloadContext);
}

/** The form's opener on a company's page; null where email cannot be written. */
export function useEmailComposer(): Composer | null {
  return useContext(ComposerContext);
}

export function EmailProvider({
  session,
  counterpartyId,
  contacts,
  enabled,
  children,
}: {
  session: DirectorySession;
  counterpartyId: string;
  contacts: Contact[];
  /** False for an archived company. */
  enabled: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState<{ contact: Contact | null; key: number } | null>(null);
  const [sentCount, setSentCount] = useState(0);
  const composer: Composer | null = enabled
    ? {
        compose: (contact) => {
          setOpen({ contact: contact ?? null, key: Date.now() });
        },
      }
    : null;
  return (
    <ComposerContext.Provider value={composer}>
      <ReloadContext.Provider value={sentCount}>
        {children}
        {open !== null && (
          <EmailDialog
            key={open.key}
            session={session}
            counterpartyId={counterpartyId}
            contacts={contacts}
            contact={open.contact}
            onClose={() => {
              setOpen(null);
            }}
            onSent={() => {
              setSentCount((count) => count + 1);
            }}
          />
        )}
      </ReloadContext.Provider>
    </ComposerContext.Provider>
  );
}

/** A contact's address: Email opens the form where it can be written, else the address alone. */
export function ContactEmail({ contact }: { contact: Contact }) {
  const composer = useEmailComposer();
  if (!contact.email) return null;
  return (
    <span className="flex w-fit flex-wrap items-center gap-x-2 gap-y-1 break-all">
      <span className="flex items-center gap-1.5">
        <Mail aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        {contact.email}
      </span>
      {composer !== null && (
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          aria-label={`Email ${contact.name}`}
          onClick={() => {
            composer.compose(contact);
          }}
        >
          Email
        </Button>
      )}
    </span>
  );
}

interface SendPayload {
  counterpartyId: string;
  contactId: string | null;
  from: 'own' | 'shared';
  to: string[];
  cc: string[];
  subject: string;
  message: string;
  sendKey: string;
}

function splitAddresses(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

function EmailDialog({
  session,
  counterpartyId,
  contacts,
  contact,
  onClose,
  onSent,
}: {
  session: DirectorySession;
  counterpartyId: string;
  contacts: Contact[];
  contact: Contact | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const id = useId();
  const { token, organization } = session;
  const [settings, setSettings] = useState<EmailSettingsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [from, setFrom] = useState<'own' | 'shared' | null>(null);
  const [to, setTo] = useState(contact?.email ?? '');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  // One key per attempt: a second click or a retry after a lost answer never sends twice; a
  // new key only after Cloudflare refused it (Codex's design review of F-114-3, D1-02).
  const [sendKey, setSendKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [sent, setSent] = useState(false);
  // The email submitted and not yet known to be sent or refused: kept as it was, not editable.
  const [pending, setPending] = useState<SendPayload | null>(null);
  // An attempt under the current key had no clear answer: it may have been sent.
  const [uncertain, setUncertain] = useState(false);
  const locked = sent || busy || pending !== null;

  useEffect(() => {
    let cancelled = false;
    apiJson<{ settings: EmailSettingsView }>(
      `/emails/settings?organization_id=${organization.id}`,
      token,
    )
      .then((answer) => {
        if (!cancelled) setSettings(answer.settings);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setLoadError(
            reason instanceof Error ? reason.message : 'Could not load the email settings.',
          );
      });
    return () => {
      cancelled = true;
    };
  }, [organization.id, token]);

  const me = settings?.you ?? null;
  const ready = settings !== null && settings.configured && settings.sharedLocalPart !== null;
  const chosenFrom = from ?? (settings?.ownLocalPart ? 'own' : 'shared');
  const fromLocal = chosenFrom === 'own' ? settings?.ownLocalPart : settings?.sharedLocalPart;
  const fromAddress = fromLocal && settings?.domain ? `${fromLocal}@${settings.domain}` : null;
  const signature =
    settings !== null && me !== null && fromAddress !== null
      ? fillSignature(settings.signature, {
          name: me.name,
          title: me.title,
          phone: me.phone,
          email: fromAddress,
        })
      : null;

  const toList = splitAddresses(to);
  const ccList = splitAddresses(cc);
  const bad = [...toList, ...ccList].filter((address) => normalizeEmailAddress(address) === null);
  const tooMany =
    new Set([...toList, ...ccList].map((a) => a.toLowerCase())).size > EMAIL_MAX_RECIPIENTS;
  const subjectLine = subject.replace(/[\r\n]+/g, ' ');
  const canSend =
    ready &&
    !busy &&
    !sent &&
    toList.length > 0 &&
    bad.length === 0 &&
    !tooMany &&
    subjectLine.trim() !== '' &&
    message.trim() !== '';
  const firstTo = normalizeEmailAddress(toList[0] ?? '');
  const matchedContact =
    contacts.find((c) => c.email && normalizeEmailAddress(c.email) === firstTo) ?? null;
  const withOthers = contacts.filter(
    (c) => c.email && !toList.some((a) => a.toLowerCase() === c.email?.toLowerCase()),
  );

  function send() {
    // What a lost answer may already have sent is sent again exactly, under the same key, until
    // its outcome is known (Codex's review of F-114-3, R1-02).
    const payload: SendPayload = pending ?? {
      counterpartyId,
      contactId: matchedContact?.id ?? null,
      from: chosenFrom,
      to: toList,
      cc: ccList,
      subject: subjectLine.trim(),
      message,
      sendKey,
    };
    setPending(payload);
    setBusy(true);
    setResult(null);
    sendJson<{ email: EmailView }>(
      `/emails?organization_id=${organization.id}`,
      token,
      'POST',
      payload,
    )
      .then(() => {
        setSent(true);
        setResult({ ok: true, text: 'Sent. It is kept in the company’s Emails.' });
        onSent();
      })
      .catch((reason: unknown) => {
        const code = reason instanceof ApiError ? reason.code : '';
        const status = reason instanceof ApiError ? reason.status : 0;
        if (code === 'EMAIL_REFUSED') {
          // Nothing went: correct it and send again as a new attempt (the refused one is kept).
          setSendKey(crypto.randomUUID());
          setPending(null);
          setUncertain(false);
          onSent();
        } else if (code === 'EMAIL_UNCONFIRMED' || code === 'EMAIL_IN_PROGRESS') {
          // It may have gone: never offered again from this form.
          setSent(true);
          onSent();
        } else if (status >= 400 && status < 500 && !uncertain) {
          // A first attempt refused before anything was kept or sent: correct it and send.
          setPending(null);
        } else if (status === 0 || status >= 500) {
          // No answer, or the server failed: this key may have sent it. Until an answer about
          // the key itself, the email stays as submitted, even if a retry is then refused for
          // another reason, such as an expired sign-in (Codex's review of F-114-3, R2-02).
          setUncertain(true);
        }
        // Otherwise the same email is offered again as is.
        setResult({
          ok: false,
          text: reason instanceof Error ? reason.message : 'The email could not be sent.',
        });
      })
      .finally(() => {
        setBusy(false);
      });
  }

  const written = message.trim() !== '' || subject.trim() !== '';
  function close() {
    if (!sent && written && !window.confirm('Discard this email? It is not kept.')) return;
    onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent title={sent && result?.ok ? 'Email sent' : 'New email'} className="max-w-2xl">
        {loadError !== null && (
          <p role="alert" className="text-sm text-danger">
            {loadError}
          </p>
        )}
        {settings !== null && !settings.configured && (
          <p role="alert" className="text-sm text-danger">
            Email is not set up yet. An admin adds the email settings in Cloudflare.
          </p>
        )}
        {settings !== null && settings.configured && settings.sharedLocalPart === null && (
          <p role="alert" className="text-sm text-danger">
            An admin sets up email on Team first (the shared address and the signature).
          </p>
        )}
        {ready && (
          <form
            className="flex flex-col gap-3 text-sm"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSend) send();
            }}
          >
            <label className="flex flex-col gap-1.5" htmlFor={`${id}-from`}>
              <span className="font-medium">From</span>
              <select
                id={`${id}-from`}
                className="h-9 rounded-control border border-input bg-background px-2"
                value={chosenFrom}
                disabled={locked}
                onChange={(event) => {
                  setFrom(event.target.value === 'own' ? 'own' : 'shared');
                }}
              >
                {settings.ownLocalPart !== null && (
                  <option value="own">
                    {me?.name ?? 'You'} &lt;{settings.ownLocalPart}@{settings.domain}&gt;
                  </option>
                )}
                <option value="shared">
                  {me?.name ?? 'You'} &lt;{settings.sharedLocalPart}@{settings.domain}&gt;
                </option>
              </select>
              {settings.ownLocalPart === null && (
                <span className="text-xs text-muted-foreground">
                  You have no address of your own yet; an admin sets it on Team.
                </span>
              )}
            </label>
            <label className="flex flex-col gap-1.5" htmlFor={`${id}-to`}>
              <span className="font-medium">To</span>
              <Input
                id={`${id}-to`}
                value={to}
                disabled={locked}
                aria-invalid={toList.some((a) => normalizeEmailAddress(a) === null)}
                onChange={(event) => {
                  setTo(event.target.value);
                }}
              />
            </label>
            {withOthers.length > 0 && !locked && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">Add:</span>
                {withOthers.map((other) => (
                  <Button
                    key={other.id}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7"
                    onClick={() => {
                      setTo((value) => [...splitAddresses(value), other.email ?? ''].join(', '));
                    }}
                  >
                    {other.name}
                  </Button>
                ))}
              </div>
            )}
            <label className="flex flex-col gap-1.5" htmlFor={`${id}-cc`}>
              <span className="font-medium">Cc</span>
              <Input
                id={`${id}-cc`}
                value={cc}
                disabled={locked}
                aria-invalid={ccList.some((a) => normalizeEmailAddress(a) === null)}
                onChange={(event) => {
                  setCc(event.target.value);
                }}
              />
            </label>
            {bad.length > 0 && (
              <p role="alert" className="text-danger">
                Not an email address: {bad.join(', ')}
              </p>
            )}
            {tooMany && (
              <p role="alert" className="text-danger">
                At most {EMAIL_MAX_RECIPIENTS} recipients in To and Cc together.
              </p>
            )}
            <label className="flex flex-col gap-1.5" htmlFor={`${id}-subject`}>
              <span className="font-medium">Subject</span>
              <Input
                id={`${id}-subject`}
                value={subject}
                maxLength={EMAIL_SUBJECT_MAX}
                disabled={locked}
                onChange={(event) => {
                  setSubject(event.target.value);
                }}
              />
            </label>
            <label className="flex flex-col gap-1.5" htmlFor={`${id}-message`}>
              <span className="font-medium">Message</span>
              <Textarea
                id={`${id}-message`}
                rows={10}
                maxLength={EMAIL_MESSAGE_MAX}
                value={message}
                disabled={locked}
                onChange={(event) => {
                  setMessage(event.target.value);
                }}
              />
            </label>
            {signature !== null && (
              <div>
                <p className="text-xs text-muted-foreground">Added under your message:</p>
                <pre className="mt-1 whitespace-pre-wrap rounded-control border border-border bg-muted p-2 font-sans text-muted-foreground">
                  {composeEmailBody('', signature).trimStart()}
                </pre>
              </div>
            )}
            {result !== null && (
              <p role={result.ok ? 'status' : 'alert'} className={result.ok ? '' : 'text-danger'}>
                {result.text}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close}>
                {sent ? 'Close' : 'Cancel'}
              </Button>
              {!sent && (
                <Button type="submit" disabled={!canSend}>
                  <Send aria-hidden="true" />
                  {busy ? 'Sending…' : pending === null ? 'Send' : 'Send again'}
                </Button>
              )}
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

const STATE_BADGES: Record<EmailView['state'], BadgeVariant> = {
  sending: 'neutral',
  unconfirmed: 'warning',
  sent: 'success',
  failed: 'danger',
  received: 'neutral',
};

/** A company's emails, newest first, older ones a page at a time (D1-03). */
export function EmailsCard({
  session,
  counterpartyId,
}: {
  session: DirectorySession;
  counterpartyId: string;
}) {
  const id = useId();
  const reload = useContext(ReloadContext);
  const composer = useEmailComposer();
  const { token, organization } = session;
  const [emails, setEmails] = useState<EmailView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const path = `/emails?organization_id=${organization.id}&counterparty_id=${counterpartyId}`;
  useEffect(() => {
    let cancelled = false;
    apiJson<{ emails: EmailView[] }>(path, token)
      .then((answer) => {
        if (cancelled) return;
        setEmails(answer.emails);
        setMore(answer.emails.length >= PAGE);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : 'Could not load the emails.');
      });
    return () => {
      cancelled = true;
    };
  }, [path, token, reload]);

  function loadOlder() {
    const last = emails?.[emails.length - 1];
    if (last === undefined) return;
    setLoadingOlder(true);
    apiJson<{ emails: EmailView[] }>(`${path}&before_id=${last.id}`, token)
      .then((answer) => {
        setEmails((current) => [...(current ?? []), ...answer.emails]);
        setMore(answer.emails.length >= PAGE);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Could not load older emails.');
      })
      .finally(() => {
        setLoadingOlder(false);
      });
  }

  return (
    <Card asChild>
      <section aria-labelledby={`${id}-heading`}>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle id={`${id}-heading`} className="flex items-center gap-2">
            <Mail aria-hidden="true" className="size-4" />
            Emails
          </CardTitle>
          {composer !== null && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                composer.compose();
              }}
            >
              New email
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {error !== null && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
          {emails !== null && emails.length === 0 && (
            <p className="text-muted-foreground">No emails yet.</p>
          )}
          {emails !== null && emails.length > 0 && (
            <ul className="flex flex-col divide-y divide-border">
              {emails.map((email) => (
                <EmailItem
                  key={email.id}
                  email={email}
                  session={session}
                  open={openId === email.id}
                  onToggle={() => {
                    setOpenId((current) => (current === email.id ? null : email.id));
                  }}
                />
              ))}
            </ul>
          )}
          {more && (
            <div>
              <Button size="sm" variant="ghost" disabled={loadingOlder} onClick={loadOlder}>
                {loadingOlder ? 'Loading…' : 'Load older'}
              </Button>
            </div>
          )}
        </CardContent>
      </section>
    </Card>
  );
}

/** The API's page size (EMAIL_LIST_LIMIT). */
const PAGE = 200;

function EmailItem({
  email,
  session,
  open,
  onToggle,
}: {
  email: EmailView;
  session: DirectorySession;
  open: boolean;
  onToggle: () => void;
}) {
  const [body, setBody] = useState<EmailView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || body !== null) return;
    let cancelled = false;
    apiJson<{ email: EmailView }>(
      `/emails/${email.id}?organization_id=${session.organization.id}`,
      session.token,
    )
      .then((answer) => {
        if (!cancelled) setBody(answer.email);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : 'Could not load the email.');
      });
    return () => {
      cancelled = true;
    };
  }, [open, body, email.id, session.organization.id, session.token]);

  const who =
    email.direction === 'outgoing'
      ? `${email.sentByName ?? email.fromName ?? ''} to ${email.to.join(', ')}`
      : email.fromAddress;
  return (
    <li className="py-2">
      <button
        type="button"
        className="flex w-full flex-col items-start gap-0.5 text-left"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="font-medium">{email.subject || '(no subject)'}</span>
          <Badge variant={STATE_BADGES[email.state]}>
            {email.state === 'unconfirmed' ? 'Not confirmed' : EMAIL_STATE_LABELS[email.state]}
          </Badge>
        </span>
        <span className="text-xs text-muted-foreground">
          {formatAlberta(email.occurredAt)} · {who}
        </span>
      </button>
      {email.state === 'failed' && email.failure !== null && (
        <p className="mt-1 text-xs text-danger">{email.failure}</p>
      )}
      {email.state === 'unconfirmed' && (
        <p className="mt-1 text-xs text-muted-foreground">{EMAIL_STATE_LABELS.unconfirmed}.</p>
      )}
      {open && (
        <div className="mt-2 rounded-control border border-border bg-muted p-3">
          {error !== null && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
          {body !== null && (
            <>
              <p className="text-xs text-muted-foreground">
                From {body.fromName ? `${body.fromName} <${body.fromAddress}>` : body.fromAddress}
                {body.cc.length > 0 ? ` · Cc ${body.cc.join(', ')}` : ''}
              </p>
              <pre className="mt-2 whitespace-pre-wrap break-words font-sans">{body.body}</pre>
              {body.bodyTruncated === true && (
                <p className="mt-1 text-xs text-muted-foreground">
                  The rest of this email was too long to keep.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}
