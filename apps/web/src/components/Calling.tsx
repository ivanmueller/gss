import {
  CALL_OUTCOME_LABELS,
  CALL_STATUS_LABELS,
  dialablePhone,
  formatCallLength,
  type CallView,
} from '@grain/domain';
import { PhoneCall, PhoneOff, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { ApiError, apiJson, sendJson } from '../lib/api';
import { Button } from './ui/button';
import { Dialog, DialogContent } from './ui/dialog';
import { Input } from './ui/input';

// Calling counterparties through Telnyx (the owner's request of 2026-11-02). A Call button
// beside a phone number asks the API to place the call: Telnyx rings the person's own cell,
// they press 1, and the counterparty is dialed. The page follows the call until it ends; a
// call that connected appears in the contact history. Nothing here talks to Telnyx.

interface PhoneSetting {
  phone: string | null;
  callingAvailable: boolean;
}

/** How often the page asks for a call's progress, and for how long at most. */
const POLL_MS = 2000;
const POLL_LIMIT_MS = 15 * 60 * 1000;

/** The person's own cell phone, which their calls ring first; only they see it. */
export function CellPhoneDialog({
  token,
  open,
  onOpenChange,
  onSaved,
}: {
  token: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (phone: string | null) => void;
}) {
  const id = useId();
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiJson<PhoneSetting>('/me/phone', token)
      .then((setting) => {
        if (cancelled) return;
        setSaved(setting.phone);
        setValue(setting.phone ?? '');
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load it.');
      });
    return () => {
      cancelled = true;
    };
  }, [open, token]);

  async function save(phone: string | null) {
    setBusy(true);
    setError(null);
    try {
      const result =
        phone === null
          ? await sendJson<{ phone: null }>('/me/phone', token, 'DELETE')
          : await sendJson<{ phone: string }>('/me/phone', token, 'PUT', { phone });
      setSaved(result.phone);
      setValue(result.phone ?? '');
      onSaved?.(result.phone);
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save it.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent
        title="Your cell phone"
        description="Calls you place from a contact's page ring this phone first. Only you can see it."
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save(value);
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-phone`} className="text-sm font-medium">
              Cell phone
            </label>
            <Input
              id={`${id}-phone`}
              type="tel"
              autoComplete="tel"
              placeholder="(403) 555-0100"
              value={value}
              aria-invalid={error !== null}
              {...(error !== null && { 'aria-describedby': `${id}-error` })}
              onChange={(event) => {
                setValue(event.target.value);
              }}
            />
            {error !== null && (
              <p id={`${id}-error`} role="alert" className="text-xs text-danger">
                {error}
              </p>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {saved !== null && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  void save(null);
                }}
              >
                Remove
              </Button>
            )}
            <Button type="submit" disabled={busy || value.trim() === ''}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface Calling {
  /** Starts a call to a contact, or to the company's own phone when contactId is null. */
  start: (contactId: string | null, name: string) => void;
  /** The call under way, or the one that just ended, if any. */
  active: { call: CallView; name: string } | null;
}

const CallingContext = createContext<Calling | null>(null);

/** What the page shows about a call: its progress, or why it could not be placed. */
type CallNotice =
  | { kind: 'call'; call: CallView; name: string }
  | { kind: 'error'; message: string; needsCell: boolean };

/**
 * Calling on a counterparty's page, for those who may log contacts there: the Call buttons
 * (CallButton) appear only inside it, and only once the API says calling is set up.
 */
export function CallingProvider({
  token,
  counterpartyId,
  enabled,
  onLogged,
  children,
}: {
  token: string;
  counterpartyId: string;
  enabled: boolean;
  /** A call was written to the contact history. */
  onLogged: () => void;
  children: ReactNode;
}) {
  const [available, setAvailable] = useState(false);
  const [notice, setNotice] = useState<CallNotice | null>(null);
  const [cellOpen, setCellOpen] = useState(false);
  const logged = useRef(onLogged);
  useEffect(() => {
    logged.current = onLogged;
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    apiJson<PhoneSetting>('/me/phone', token)
      .then((setting) => {
        if (!cancelled) setAvailable(setting.callingAvailable);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, token]);

  const active = notice?.kind === 'call' ? notice : null;
  const callId = active?.call.id ?? null;
  const ended = active?.call.status === 'ended';

  // Follows the call until it ends.
  useEffect(() => {
    if (callId === null || ended) return;
    let cancelled = false;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const poll = () => {
      timer = setTimeout(() => {
        apiJson<{ call: CallView }>(`/calls/${callId}`, token)
          .then(({ call }) => {
            if (cancelled) return;
            setNotice((current) =>
              current?.kind === 'call' && current.call.id === call.id
                ? { ...current, call }
                : current,
            );
            if (call.status === 'ended') {
              if (call.contactLogEntryId !== null) logged.current();
            } else if (Date.now() - started < POLL_LIMIT_MS) {
              poll();
            }
          })
          .catch(() => {
            if (!cancelled && Date.now() - started < POLL_LIMIT_MS) poll();
          });
      }, POLL_MS);
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [callId, ended, token]);

  const start = useCallback(
    (contactId: string | null, name: string) => {
      setNotice(null);
      sendJson<{ call: CallView }>('/calls', token, 'POST', { counterpartyId, contactId })
        .then(({ call }) => {
          setNotice({ kind: 'call', call, name });
        })
        .catch((reason: unknown) => {
          const needsCell = reason instanceof ApiError && reason.code === 'NO_CELL_PHONE';
          setNotice({
            kind: 'error',
            message: reason instanceof Error ? reason.message : 'The call could not be placed.',
            needsCell,
          });
          if (needsCell) setCellOpen(true);
        });
    },
    [counterpartyId, token],
  );

  const value: Calling | null = enabled && available ? { start, active } : null;

  return (
    <CallingContext.Provider value={value}>
      {notice !== null && (
        <CallNoticeLine
          notice={notice}
          onDismiss={() => {
            setNotice(null);
          }}
          onAddCell={() => {
            setCellOpen(true);
          }}
        />
      )}
      {children}
      <CellPhoneDialog token={token} open={cellOpen} onOpenChange={setCellOpen} />
    </CallingContext.Provider>
  );
}

function CallNoticeLine({
  notice,
  onDismiss,
  onAddCell,
}: {
  notice: CallNotice;
  onDismiss: () => void;
  onAddCell: () => void;
}) {
  let text: ReactNode;
  let done = true;
  if (notice.kind === 'error') {
    text = (
      <>
        {notice.message}{' '}
        {notice.needsCell && (
          <Button variant="outline" size="sm" onClick={onAddCell}>
            Add your cell phone
          </Button>
        )}
      </>
    );
  } else {
    const { call, name } = notice;
    done = call.status === 'ended';
    if (!done) {
      text = `${name}: ${CALL_STATUS_LABELS[call.status]}`;
    } else if (call.outcome === 'talked') {
      const length =
        call.connectedAt !== null && call.endedAt !== null
          ? formatCallLength((Date.parse(call.endedAt) - Date.parse(call.connectedAt)) / 1000)
          : null;
      text = `${name}: call ended${length === null ? '' : ` after ${length}`}${
        call.contactLogEntryId === null ? '.' : '. It is in the contact history.'
      }`;
    } else {
      text = `${name}: ${call.outcome === null ? 'call ended' : CALL_OUTCOME_LABELS[call.outcome]}.`;
    }
  }
  const failed = notice.kind === 'error';
  return (
    <div
      role={failed ? 'alert' : 'status'}
      className={`flex flex-wrap items-center gap-2 rounded-card border px-4 py-2 text-sm ${
        failed ? 'text-danger' : ''
      }`}
    >
      {done ? (
        <PhoneOff aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      ) : (
        <PhoneCall aria-hidden="true" className="size-4 shrink-0 animate-pulse text-success" />
      )}
      <span className="min-w-0 flex-1">{text}</span>
      {done && (
        <Button variant="ghost" size="icon-sm" onClick={onDismiss}>
          <X aria-hidden="true" />
          <span className="sr-only">Dismiss</span>
        </Button>
      )}
    </div>
  );
}

/**
 * "Call" beside a phone number, on a counterparty's page where calling is set up and the
 * person may log contacts; nothing elsewhere, and nothing beside a number the platform cannot
 * dial (one with an extension, for instance). Disabled while a call is under way.
 */
export function CallButton({
  contactId,
  name,
  phone,
}: {
  contactId: string | null;
  name: string;
  phone: string;
}) {
  const calling = useContext(CallingContext);
  if (calling === null || dialablePhone(phone) === null) return null;
  const busy = calling.active !== null && calling.active.call.status !== 'ended';
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 px-2"
      disabled={busy}
      aria-label={`Call ${name}`}
      onClick={() => {
        calling.start(contactId, name);
      }}
    >
      <PhoneCall aria-hidden="true" />
      Call
    </Button>
  );
}
