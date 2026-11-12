import {
  attachmentFileName,
  composeEmailBody,
  EMAIL_DRAFT_ABOUT_MAX,
  EMAIL_MAX_RECIPIENTS,
  EMAIL_MESSAGE_MAX,
  EMAIL_STATE_LABELS,
  EMAIL_SUBJECT_MAX,
  fillSignature,
  formatAlberta,
  normalizeEmailAddress,
  replySubject,
  type EmailAutoDraftListResponse,
  type EmailAutoDraftView,
  type EmailDraftView,
  type EmailSettingsView,
  type EmailView,
} from '@grain/domain';
import { Download, Mail, Paperclip, Reply, Send } from 'lucide-react';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { apiJson, ApiError, sendJson, type Contact } from '../lib/api';
import { saveDownload } from '../lib/download';
import { noteFollowUpsChanged } from '../lib/crm';
import { setSearchParams, useSearch } from '../lib/router';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import { ClaudeMark } from './ClaudeMark';
import { AutoDraftList } from './EmailAutoDrafts';
import { Badge, type BadgeVariant } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Dialog, DialogContent } from './ui/dialog';
import { Input, Textarea } from './ui/input';

// Email sent by hand from a company's page (F-114 step 3): **Email** beside a contact's address
// and **New email** in the page's ⋯ menu open one form; the person writes, checks the signature
// and clicks Send. The Worker sends it through Cloudflare and keeps it; the Emails card lists the
// company's emails. Nothing is sent by itself and nothing is retried by itself.
// F-114 step 5b: **Reply** on a received email opens the same form to its sender, and
// **Draft with Claude** fills Subject and Message with Claude's draft for the person to read,
// change and send; numbers Claude did not have are listed under Check this, and a placeholder
// such as [price] must be filled in before Send. Claude never sends (AGENTS.md rule 8).

/** The received email a reply answers. */
export interface ReplyTo {
  id: string;
  fromAddress: string;
  subject: string;
}

interface Composer {
  /**
   * Opens the form, addressed to a contact when given, or as a reply to a received email, or
   * filled with a draft Claude made by itself (F-114 step 5c).
   */
  compose: (contact?: Contact, reply?: ReplyTo, auto?: EmailAutoDraftView) => void;
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
  const [open, setOpen] = useState<{
    contact: Contact | null;
    reply: ReplyTo | null;
    auto: EmailAutoDraftView | null;
    key: number;
  } | null>(null);
  const [sentCount, setSentCount] = useState(0);
  // An email whose outcome is not known, kept while the form is closed (R4-01).
  const [held, setHeld] = useState<SendPayload | null>(null);
  const composer: Composer | null = enabled
    ? {
        compose: (contact, reply, auto) => {
          setOpen({
            contact: contact ?? null,
            reply: reply ?? null,
            auto: auto ?? null,
            key: Date.now(),
          });
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
            reply={open.reply}
            auto={open.auto}
            held={held}
            onHold={setHeld}
            onClose={() => {
              setOpen(null);
            }}
            onSent={() => {
              setSentCount((count) => count + 1);
              noteFollowUpsChanged();
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
  replyToEmailId: string | null;
  claudeDraftId: string | null;
  autoDraftId: string | null;
}

/** Claude's draft as it filled the form, to check what is still in the text. */
interface DraftShown {
  /** The Draft with Claude request; null for a draft Claude made by itself. */
  draftId: string | null;
  checkThis: string[];
  placeholders: string[];
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
  reply: replyTo,
  auto,
  held,
  onHold,
  onClose,
  onSent,
}: {
  session: DirectorySession;
  counterpartyId: string;
  contacts: Contact[];
  contact: Contact | null;
  /** The received email this answers (Reply). */
  reply: ReplyTo | null;
  /** A draft Claude made by itself, opened from the drafts waiting (F-114 step 5c). */
  auto: EmailAutoDraftView | null;
  /** An email submitted earlier whose outcome is not known: reopened as it was, locked. */
  held: SendPayload | null;
  onHold: (payload: SendPayload | null) => void;
  onClose: () => void;
  onSent: () => void;
}) {
  const id = useId();
  const { token, organization } = session;
  const [settings, setSettings] = useState<EmailSettingsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [from, setFrom] = useState<'own' | 'shared' | null>(held?.from ?? auto?.fromChoice ?? null);
  const [to, setTo] = useState(
    held
      ? held.to.join(', ')
      : auto !== null
        ? auto.to.join(', ')
        : (replyTo?.fromAddress ?? contact?.email ?? ''),
  );
  const [cc, setCc] = useState(held ? held.cc.join(', ') : '');
  const [subject, setSubject] = useState(
    held?.subject ?? auto?.subject ?? (replyTo === null ? '' : replySubject(replyTo.subject)),
  );
  // The received email answered; cleared when it was deleted and the person sends it as new.
  const [answering, setAnswering] = useState<string | null>(
    held === null ? (auto !== null ? auto.emailId : (replyTo?.id ?? null)) : held.replyToEmailId,
  );
  // The automatic draft this email is sent from; cleared when someone else sent or dismissed it
  // and the person sends it as a new email.
  const [autoDraftId, setAutoDraftId] = useState<string | null>(
    held === null ? (auto?.id ?? null) : held.autoDraftId,
  );
  const [autoGone, setAutoGone] = useState(false);
  // A reminder answers GSS's own email (F-114 step 5c, part 2): only with its draft, so Draft
  // with Claude (which answers received email only) is not offered while it is the one answered.
  const remindedEmail = auto?.source === 'reminder' ? auto.emailId : null;
  const answeringReminded = remindedEmail !== null && answering === remindedEmail;
  const [about, setAbout] = useState('');
  const [drafting, setDrafting] = useState<AbortController | null>(null);
  const heldDraft = held?.claudeDraftId ?? null;
  const [draft, setDraft] = useState<DraftShown | null>(
    heldDraft !== null
      ? { draftId: heldDraft, checkThis: [], placeholders: [] }
      : held === null && auto !== null
        ? { draftId: null, checkThis: auto.checkThis, placeholders: auto.placeholders }
        : null,
  );
  const [draftError, setDraftError] = useState<string | null>(null);
  const [replyGone, setReplyGone] = useState(false);
  const [message, setMessage] = useState(held?.message ?? auto?.message ?? '');
  // One key per attempt: a second click or a retry after a lost answer never sends twice; a
  // new key only after Cloudflare refused it (Codex's design review of F-114-3, D1-02).
  const [sendKey, setSendKey] = useState(() => held?.sendKey ?? crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    held === null
      ? null
      : {
          ok: false,
          text: 'This email may already have been sent. Send it again (it is never sent twice), or check the company’s Emails.',
        },
  );
  const [sent, setSent] = useState(false);
  // The email submitted and not yet known to be sent or refused: kept as it was, not editable.
  const [pending, setPending] = useState<SendPayload | null>(held);
  // An attempt under the current key had no clear answer: it may have been sent.
  const [uncertain, setUncertain] = useState(held !== null);
  const locked = sent || busy || pending !== null || drafting !== null;

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
  // A draft's own address when the person has none of their own: the shared one.
  const chosenFrom =
    from === 'own' && settings !== null && settings.ownLocalPart === null
      ? 'shared'
      : (from ?? (settings?.ownLocalPart ? 'own' : 'shared'));
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
  const text = `${subjectLine}\n${message}`;
  const unfilled = draft === null ? [] : draft.placeholders.filter((p) => text.includes(p));
  // Case-insensitive, so "Twelve" edited to "twelve" is still listed (F-114-5b-R1-02).
  const lowered = text.toLowerCase();
  const toCheck =
    draft === null ? [] : draft.checkThis.filter((item) => lowered.includes(item.toLowerCase()));
  const canSend =
    ready &&
    !busy &&
    !sent &&
    drafting === null &&
    unfilled.length === 0 &&
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
      replyToEmailId: answering,
      claudeDraftId: draft?.draftId ?? null,
      autoDraftId,
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
        onHold(null);
        setResult({ ok: true, text: 'Sent. It is kept in the company’s Emails.' });
        onSent();
      })
      .catch((reason: unknown) => {
        const code = reason instanceof ApiError ? reason.code : '';
        const status = reason instanceof ApiError ? reason.status : 0;
        if (code === 'REPLY_NOT_FOUND' && !uncertain) {
          // The email answered was deleted meanwhile: nothing was kept or sent.
          setPending(null);
          setReplyGone(true);
        } else if ((code === 'AUTO_DRAFT_USED' || code === 'AUTO_DRAFT_NOT_FOUND') && !uncertain) {
          // Someone else sent or dismissed Claude's draft meanwhile: nothing was kept or sent.
          setPending(null);
          setAutoGone(true);
        } else if (code === 'EMAIL_REFUSED') {
          // Nothing went: correct it and send again as a new attempt (the refused one is kept).
          setSendKey(crypto.randomUUID());
          setPending(null);
          setUncertain(false);
          onHold(null);
          onSent();
        } else if (code === 'EMAIL_UNCONFIRMED' || code === 'EMAIL_IN_PROGRESS') {
          // It may have gone: never offered again from this form.
          setSent(true);
          onHold(null);
          onSent();
        } else if (status >= 400 && status < 500 && !uncertain) {
          // A first attempt refused before anything was kept or sent: correct it and send.
          setPending(null);
        } else if (status === 0 || status >= 500) {
          // No answer, or the server failed: this key may have sent it. Until an answer about
          // the key itself, the email stays as submitted, even if a retry is then refused for
          // another reason, such as an expired sign-in (Codex's review of F-114-3, R2-02).
          setUncertain(true);
          // Kept by the page, so closing the form and opening it again finds it, locked, under
          // the same key (Codex's final review of F-114-3, R4-01).
          onHold(payload);
          onSent();
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

  function askClaude() {
    if (
      (message.trim() !== '' || (subject.trim() !== '' && replyTo === null)) &&
      !window.confirm('Replace what you wrote with Claude’s draft?')
    )
      return;
    const controller = new AbortController();
    setDrafting(controller);
    setDraftError(null);
    apiJson<{ draft: EmailDraftView }>(`/emails/draft?organization_id=${organization.id}`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        counterpartyId,
        contactId: matchedContact?.id ?? null,
        replyToEmailId: answering,
        from: chosenFrom,
        to: toList.filter((address) => normalizeEmailAddress(address) !== null),
        about: about.trim(),
        draftKey: crypto.randomUUID(),
      }),
      signal: controller.signal,
    })
      .then(({ draft: answer }) => {
        if (controller.signal.aborted) return;
        setSubject(answer.subject);
        setMessage(answer.message);
        setDraft({
          draftId: answer.draftId,
          checkThis: answer.checkThis,
          placeholders: answer.placeholders,
        });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (reason instanceof ApiError && reason.code === 'REPLY_NOT_FOUND') setReplyGone(true);
        setDraftError(
          reason instanceof Error ? reason.message : 'Claude could not draft this email.',
        );
      })
      .finally(() => {
        setDrafting((current) => (current === controller ? null : current));
      });
  }

  const written = message.trim() !== '' || subject.trim() !== '';
  function close() {
    // While sending, closing could not stop it: the form stays (Codex's final review, R4-01).
    if (busy) return;
    drafting?.abort();
    if (!sent && pending !== null && uncertain) {
      if (
        !window.confirm(
          'This email may already have been sent: closing does not stop it. It stays here to send again (never twice) or to check in the company’s Emails. Close?',
        )
      )
        return;
    } else if (
      !sent &&
      pending === null &&
      written &&
      !window.confirm('Discard this email? It is not kept.')
    ) {
      return;
    }
    onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent
        title={
          sent && result?.ok
            ? 'Email sent'
            : auto !== null
              ? 'Claude’s draft'
              : replyTo !== null
                ? 'Reply'
                : 'New email'
        }
        className="max-w-2xl"
      >
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
            {replyGone && answering !== null && !sent && (
              <div role="alert" className="flex flex-wrap items-center gap-2 text-danger">
                The email you are answering was deleted.
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setAnswering(null);
                    setReplyGone(false);
                    setResult(null);
                    setDraftError(null);
                  }}
                >
                  Send as a new email
                </Button>
              </div>
            )}
            {autoGone && autoDraftId !== null && !sent && (
              <div role="alert" className="flex flex-wrap items-center gap-2 text-danger">
                Claude’s draft was sent or dismissed by someone else.
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setAutoDraftId(null);
                    // GSS's own email can be answered only with its reminder: sent as new.
                    if (answeringReminded) setAnswering(null);
                    setAutoGone(false);
                    setResult(null);
                  }}
                >
                  Send as a new email
                </Button>
              </div>
            )}
            {settings.claudeConfigured && !sent && pending === null && !answeringReminded && (
              <div className="flex flex-col gap-2 rounded-control border border-l-[3px] border-claude-border border-l-claude-mark bg-claude-subtle px-3 py-2">
                <label className="flex flex-col gap-1.5" htmlFor={`${id}-about`}>
                  <span className="flex items-center gap-1.5 font-medium">
                    <ClaudeMark />
                    Draft with Claude
                  </span>
                  <Input
                    id={`${id}-about`}
                    value={about}
                    maxLength={EMAIL_DRAFT_ABOUT_MAX}
                    placeholder="What’s it about? (optional)"
                    disabled={drafting !== null || busy}
                    onChange={(event) => {
                      setAbout(event.target.value.replace(/[\r\n]+/g, ' '));
                    }}
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={drafting !== null || busy}
                    onClick={askClaude}
                  >
                    {drafting !== null
                      ? 'Claude is drafting…'
                      : draft === null
                        ? 'Draft with Claude'
                        : 'Draft again'}
                  </Button>
                  {drafting !== null && (
                    <>
                      <span className="text-xs text-muted-foreground" role="status">
                        This can take up to a minute.
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          drafting.abort();
                          setDrafting(null);
                        }}
                      >
                        Stop waiting
                      </Button>
                    </>
                  )}
                </div>
                {draftError !== null && (
                  <p role="alert" className="text-danger">
                    {draftError}
                  </p>
                )}
                {draft !== null && drafting === null && (
                  <p className="text-xs">
                    Drafted by Claude: read it before sending. Change anything you like; nothing is
                    sent until you click Send.
                  </p>
                )}
              </div>
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
            {toCheck.length > 0 && (
              <div className="rounded-control border border-warning p-2 text-xs">
                <p className="font-medium">Check this before sending</p>
                <p className="text-muted-foreground">
                  Not found in the company’s records, the call or the emails Claude was given:
                </p>
                <ul className="mt-1 flex flex-wrap gap-1">
                  {toCheck.map((item) => (
                    <li key={item}>
                      <Badge variant="warning">{item}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {unfilled.length > 0 && (
              <p role="alert" className="text-danger">
                Fill in {unfilled.join(', ')} before sending.
              </p>
            )}
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
              <Button type="button" variant="outline" disabled={busy} onClick={close}>
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
  // Claude's email drafts waiting (F-114 step 5c), loaded again after each send or dismissal.
  const [autoDrafts, setAutoDrafts] = useState<EmailAutoDraftView[]>([]);
  const [autoReload, setAutoReload] = useState(0);
  const [autoMissing, setAutoMissing] = useState(false);
  // ?email_draft={id}: Open from Follow-ups, the form opened here once the drafts are loaded.
  const wanted = new URLSearchParams(useSearch()).get('email_draft');
  const composerRef = useRef(composer);
  useEffect(() => {
    composerRef.current = composer;
  });

  const path = `/emails?organization_id=${organization.id}&counterparty_id=${counterpartyId}`;
  useEffect(() => {
    let cancelled = false;
    apiJson<EmailAutoDraftListResponse>(
      `/email-auto-drafts?organization_id=${organization.id}&counterparty_id=${counterpartyId}`,
      token,
    )
      .then((answer) => {
        if (cancelled) return;
        setAutoDrafts(answer.drafts);
        const open = composerRef.current;
        if (wanted === null || open === null) return;
        const draft = answer.drafts.find((item) => item.id === wanted);
        setSearchParams({ email_draft: null });
        if (draft === undefined) setAutoMissing(true);
        else open.compose(undefined, undefined, draft);
      })
      .catch(() => {
        // The emails still show; the drafts come back on the next load.
      });
    return () => {
      cancelled = true;
    };
  }, [organization.id, counterpartyId, token, reload, autoReload, wanted]);
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
          {autoMissing && (
            <p role="status" className="text-muted-foreground">
              That draft of Claude’s is no longer waiting: it was sent or dismissed.
            </p>
          )}
          {autoDrafts.length > 0 && (
            <section aria-label="Claude’s email drafts" className="flex flex-col gap-2 pb-2">
              <h3 className="text-sm font-medium">Claude’s email drafts ({autoDrafts.length})</h3>
              <AutoDraftList
                session={session}
                drafts={autoDrafts}
                onOpen={(draft) => {
                  composer?.compose(undefined, undefined, draft);
                }}
                onChanged={() => {
                  setAutoReload((count) => count + 1);
                  noteFollowUpsChanged();
                }}
              />
            </section>
          )}
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
                >
                  {composer !== null &&
                    openId === email.id &&
                    email.direction === 'incoming' &&
                    email.counterpartyId !== null && (
                      <div className="mt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            // Where the sender asked replies to go, else to the sender
                            // (Codex's final review, F-114-5b-R2-02).
                            composer.compose(undefined, {
                              id: email.id,
                              fromAddress: email.replyToAddress ?? email.fromAddress,
                              subject: email.subject,
                            });
                          }}
                        >
                          <Reply aria-hidden="true" />
                          Reply
                        </Button>
                      </div>
                    )}
                </EmailItem>
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

/** A received email's attachments, each saved as a download (F-114 step 4b). */
function EmailFiles({ email, session }: { email: EmailView; session: DirectorySession }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attachments = email.attachments ?? [];
  const org = session.organization.id;

  function save(key: string, path: string, name: string) {
    setBusy(key);
    setError(null);
    saveDownload(`${path}?organization_id=${org}`, session.token, name)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'The file could not be downloaded.');
      })
      .finally(() => {
        setBusy(null);
      });
  }

  if (email.direction !== 'incoming') return null;
  if (attachments.length === 0 && !email.parseFailed) return null;
  return (
    <div className="mt-2 flex flex-col gap-1">
      {attachments.length > 0 && (
        <>
          <p className="text-xs font-medium">Attachments</p>
          <ul className="flex flex-col gap-1">
            {attachments.map((file) => {
              const name = attachmentFileName(file.fileName, file.position);
              const key = `a${String(file.position)}`;
              return (
                <li key={file.position} className="flex flex-wrap items-center gap-2 text-xs">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => {
                      save(key, `/emails/${email.id}/attachments/${String(file.position)}`, name);
                    }}
                  >
                    <Download aria-hidden="true" className="size-3" />
                    {busy === key ? 'Downloading…' : name}
                  </Button>
                  <span className="text-muted-foreground">
                    {formatFileSize(file.sizeBytes)}
                    {file.disposition === 'inline' ? ' · in the message' : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {email.parseFailed && (
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => {
              save('original', `/emails/${email.id}/original`, `email-${email.id}.eml`);
            }}
          >
            <Download aria-hidden="true" className="size-3" />
            {busy === 'original' ? 'Downloading…' : 'Download the original'}
          </Button>
        </div>
      )}
      {error !== null && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** A size in bytes as people read it. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} bytes`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * One email, opened for its text on a click: on a company's Emails card and in the list of
 * received mail on no company (F-114 step 4b), whose actions come as children.
 */
export function EmailItem({
  email,
  session,
  open,
  onToggle,
  children,
}: {
  email: EmailView;
  session: DirectorySession;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
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
      : `${email.fromName ? `${email.fromName} <${email.fromAddress}>` : email.fromAddress}${
          email.counterpartyId === null && email.sentTo !== null ? ` to ${email.sentTo}` : ''
        }`;
  return (
    <li className="py-2">
      <button
        type="button"
        className="flex w-full flex-col items-start gap-0.5 text-left"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="font-medium">
            {email.subject || '(no subject)'}
            {email.automatic && (
              <Badge variant="neutral" className="ml-2">
                Automatic
              </Badge>
            )}
          </span>
          <Badge variant={STATE_BADGES[email.state]}>
            {email.state === 'unconfirmed' ? 'Not confirmed' : EMAIL_STATE_LABELS[email.state]}
          </Badge>
        </span>
        <span className="text-xs text-muted-foreground">
          {formatAlberta(email.occurredAt)} · {who}
          {email.attachmentCount > 0 && (
            <span className="ml-1 inline-flex items-center gap-0.5">
              · <Paperclip aria-hidden="true" className="size-3" />
              {email.attachmentCount === 1
                ? '1 attachment'
                : `${String(email.attachmentCount)} attachments`}
            </span>
          )}
        </span>
      </button>
      {email.unverifiedSender && (
        <p className="mt-1 text-xs text-warning">
          Sender not verified: this email may not be from who it says.
        </p>
      )}
      {email.parseFailed && (
        <p className="mt-1 text-xs text-muted-foreground">
          This email could not be read. Its original is kept.
        </p>
      )}
      {email.state === 'failed' && email.failure !== null && (
        <p className="mt-1 text-xs text-danger">{email.failure}</p>
      )}
      {email.state === 'unconfirmed' && (
        <p className="mt-1 text-xs text-muted-foreground">{EMAIL_STATE_LABELS.unconfirmed}.</p>
      )}
      {(email.inReplyToSubject !== null || email.draftedByClaude) && (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {email.inReplyToSubject !== null && (
            <span>In reply to “{email.inReplyToSubject || '(no subject)'}”</span>
          )}
          {email.draftedByClaude && (
            <span className="inline-flex items-center gap-1">
              <ClaudeMark className="size-3" />
              Drafted with Claude
            </span>
          )}
        </p>
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
              <EmailFiles email={body} session={session} />
            </>
          )}
        </div>
      )}
      {children}
    </li>
  );
}
