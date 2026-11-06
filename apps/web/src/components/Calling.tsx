import {
  CALLBACK_TURN_LABELS,
  CALL_OUTCOME_LABELS,
  CALL_STATUS_LABELS,
  formatAlberta,
  type CallRecordingView,
  dialablePhone,
  formatCallLength,
  type CallStatus,
  type CallView,
  type TranscriptLine,
} from '@grain/domain';
import { Copy, Phone, PhoneCall, PhoneOff, Play, X } from 'lucide-react';
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

import { ApiError, apiFetch, apiJson, sendJson } from '../lib/api';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Dialog, DialogContent } from './ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
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
export const POLL_MS = 2000;
export const POLL_LIMIT_MS = 15 * 60 * 1000;
/** How long the line of a call that has ended stays before it goes. */
export const ENDED_LINE_MS = 5000;
/**
 * When the contact history is loaded again after a call, for its transcript: the Worker
 * transcribes new recordings every 2 minutes, so it usually comes within 2 to 5 minutes.
 */
const TRANSCRIPT_CHECKS_MS = [30_000, 90_000, 180_000, 300_000];

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
 * Calling on a counterparty's page, for those who may log contacts there: its phone numbers
 * (PhoneNumber) offer Call only inside it, and only once the API says calling is set up; the
 * call's progress shows in a box in the bottom right corner (CallBox).
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
  // The contact log entry of the last call that connected, kept after its line has gone, so
  // that the contact history keeps being loaded again for its transcript.
  const [refreshFor, setRefreshFor] = useState<string | null>(null);
  const loggedRef = useRef(onLogged);
  useEffect(() => {
    loggedRef.current = onLogged;
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

  // A call that connected gets its transcript a little after it ends: the contact history is
  // loaded again a few times, so it appears without reloading the page.
  useEffect(() => {
    if (refreshFor === null) return;
    const timers = TRANSCRIPT_CHECKS_MS.map((delay) =>
      setTimeout(() => {
        loggedRef.current();
      }, delay),
    );
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [refreshFor]);

  // Once the call has ended, its box stays a few seconds, then goes (the owner's request of
  // 2026-11-02); a call that connected is in the contact history by then.
  useEffect(() => {
    if (callId === null || !ended) return;
    const timer = setTimeout(() => {
      setNotice((current) =>
        current?.kind === 'call' && current.call.id === callId ? null : current,
      );
    }, ENDED_LINE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [callId, ended]);

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
              if (call.contactLogEntryId !== null) {
                loggedRef.current();
                setRefreshFor(call.contactLogEntryId);
              }
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
          if (call.contactLogEntryId !== null) setRefreshFor(call.contactLogEntryId);
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
        <CallBox
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

/** The steps of a call, as the box's progress shows them. */
const CALL_STEPS = ['calling_you', 'confirming', 'calling_them', 'connected'] as const;
/** The steps of a callback to GSS's number, for the person whose cell rings. */
const CALLBACK_STEPS = ['calling_you', 'confirming', 'joining', 'connected'] as const;

/** What to do now, under the call's status. */
const CALL_HINTS: Record<(typeof CALL_STEPS)[number], (name: string) => string> = {
  calling_you: () => 'Answer your cell phone.',
  confirming: () => 'Press 1 on your cell to connect.',
  calling_them: (name) => `Ringing ${name}. Stay on the line.`,
  connected: () => 'Hang up on your phone to end the call.',
};
const CALLBACK_HINTS: Record<(typeof CALLBACK_STEPS)[number], string> = {
  calling_you: 'Answer your cell phone.',
  confirming: 'Press 1 on your cell to take the call.',
  joining: 'Stay on the line.',
  connected: 'Hang up on your phone to end the call.',
};

/**
 * Where a callback stands for the person rung: its step (null once over for them), its
 * headline, and whether it is over for them (they did not take it).
 */
function callbackStep(call: CallView): (typeof CALLBACK_STEPS)[number] | null {
  const you = call.callback?.you ?? null;
  if (call.status === 'ended' || you === 'passed' || you === null) return null;
  if (you === 'ringing') return 'calling_you';
  if (you === 'confirming') return 'confirming';
  return call.status === 'connected' ? 'connected' : 'joining';
}

/** Seconds as m:ss (h:mm:ss past an hour). */
function clockTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${String(minutes)}:${rest}`;
}

/** The time now, once a second while `on`. */
function useTicking(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    // The first tick comes within a second; until then the clock reads from the last tick
    // (never below 0:00).
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [on]);
  return now;
}

/**
 * The live call box in the bottom right corner (the owner's request of 2026-11-03): whom the
 * call is with, a ringing phone while it connects, each step, and once connected a running
 * clock; then how it ended, for a few seconds. Why a call could not be placed shows here too.
 * A callback to GSS's number shows its own steps, for the person whose cell rings.
 */
export function CallBox({
  notice,
  onDismiss,
  onAddCell,
}: {
  notice: CallNotice;
  onDismiss: () => void;
  onAddCell: () => void;
}) {
  const call = notice.kind === 'call' ? notice.call : null;
  const callback = call?.direction === 'incoming' ? call.callback : undefined;
  const connected =
    call?.status === 'connected' && (callback === undefined || callback.you === 'answered');
  const now = useTicking(connected);
  const frame =
    'fixed right-4 bottom-4 left-4 z-(--z-floating) flex flex-col gap-3 rounded-card border bg-card p-4 text-card-foreground shadow-lg sm:left-auto sm:w-80';

  if (notice.kind === 'error') {
    return (
      <div role="alert" className={frame}>
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-subtle text-danger">
            <PhoneOff aria-hidden="true" className="size-5" />
          </span>
          <p className="min-w-0 flex-1 text-sm">{notice.message}</p>
          <DismissButton onDismiss={onDismiss} />
        </div>
        {notice.needsCell && (
          <Button variant="outline" size="sm" className="self-start" onClick={onAddCell}>
            Add your cell phone
          </Button>
        )}
      </div>
    );
  }

  const { name } = notice;
  const status = notice.call.status;
  const callbackAt = callback === undefined ? null : callbackStep(notice.call);
  const done = callback === undefined ? status === 'ended' : callbackAt === null;
  const ringing = !done && !connected;
  let headline: string;
  if (callbackAt !== null) {
    headline =
      callbackAt === 'calling_you'
        ? CALLBACK_TURN_LABELS.ringing
        : callbackAt === 'confirming'
          ? CALLBACK_TURN_LABELS.confirming
          : CALL_STATUS_LABELS[callbackAt];
  } else if (!done) {
    headline = CALL_STATUS_LABELS[status];
  } else if (callback !== undefined && callback.you !== 'answered') {
    headline = `${CALLBACK_TURN_LABELS.passed}.`;
  } else if (notice.call.outcome === 'talked') {
    const { connectedAt, endedAt } = notice.call;
    const length =
      connectedAt !== null && endedAt !== null
        ? formatCallLength((Date.parse(endedAt) - Date.parse(connectedAt)) / 1000)
        : null;
    // A callback from a number that matches no company waits on the Follow-ups page.
    const where =
      notice.call.contactLogEntryId !== null
        ? '. It is in the contact history.'
        : callback !== undefined && notice.call.counterpartyId === null
          ? '. It is on the Follow-ups page, to link to a company.'
          : '.';
    headline = `Call ended${length === null ? '' : ` after ${length}`}${where}`;
  } else {
    headline = `${notice.call.outcome === null ? 'Call ended' : CALL_OUTCOME_LABELS[notice.call.outcome]}.`;
  }
  const steps: readonly CallStatus[] = callback === undefined ? CALL_STEPS : CALLBACK_STEPS;
  const step = done ? -1 : steps.indexOf(callbackAt ?? status);
  const elapsed =
    connected && notice.call.connectedAt !== null
      ? clockTime((now - Date.parse(notice.call.connectedAt)) / 1000)
      : null;

  return (
    <div role="status" aria-label={`Call with ${name}`} className={frame}>
      <div className="flex items-center gap-3">
        <span className="relative flex size-10 shrink-0 items-center justify-center">
          {ringing && (
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-full bg-success/40 motion-safe:animate-ping"
            />
          )}
          <span
            className={cn(
              'relative flex size-10 items-center justify-center rounded-full',
              connected && 'bg-success-solid text-success-solid-foreground',
              ringing && 'bg-success-subtle text-success',
              done && 'bg-muted text-muted-foreground',
            )}
          >
            {done ? (
              <PhoneOff aria-hidden="true" className="size-5" />
            ) : (
              <PhoneCall
                aria-hidden="true"
                className={cn('size-5', ringing && 'motion-safe:animate-pulse')}
              />
            )}
          </span>
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="text-sm text-muted-foreground">{headline}</p>
        </div>
        {elapsed !== null && (
          // The running clock is for the eye; screen readers hear "Connected" once.
          <span aria-hidden="true" className="font-medium text-success tabular-nums">
            {elapsed}
          </span>
        )}
        {done && <DismissButton onDismiss={onDismiss} />}
      </div>
      {!done && (
        <>
          <ol aria-label="Progress" className="flex gap-1">
            {steps.map((stepName, index) => (
              <li
                key={stepName}
                aria-current={index === step ? 'step' : undefined}
                className={cn('h-1 flex-1 rounded-full', index <= step ? 'bg-success' : 'bg-muted')}
              >
                <span className="sr-only">{CALL_STATUS_LABELS[stepName]}</span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">
            {callbackAt !== null
              ? CALLBACK_HINTS[callbackAt]
              : CALL_HINTS[CALL_STEPS[step] ?? 'calling_you'](name)}
          </p>
        </>
      )}
    </div>
  );
}

function DismissButton({ onDismiss }: { onDismiss: () => void }) {
  return (
    <Button variant="ghost" size="icon-sm" className="-mt-1 -mr-1" onClick={onDismiss}>
      <X aria-hidden="true" />
      <span className="sr-only">Dismiss</span>
    </Button>
  );
}

/**
 * A phone number on a counterparty's page (the owner's request of 2026-11-03): clicking it
 * opens a small menu, "Call …" through the platform (the person's cell rings first) and
 * "Copy number", so a stray click never starts a call. Where calling is not set up, or the
 * number cannot be dialed by the platform (one with an extension, for instance), it is a
 * plain phone link as before. Call is disabled while a call is under way.
 */
export function PhoneNumber({
  contactId,
  name,
  phone,
  href,
}: {
  /** The contact called, or null for the company phone. */
  contactId: string | null;
  /** Whom the call is with, as the menu and the call's line show it. */
  name: string;
  phone: string;
  /** The tel: link used where the platform cannot call. */
  href: string;
}) {
  const calling = useContext(CallingContext);
  const [copied, setCopied] = useState<'copied' | 'failed' | null>(null);
  useEffect(() => {
    if (copied === null) return;
    const timer = setTimeout(() => {
      setCopied(null);
    }, 2500);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  const icon = <Phone aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />;
  if (calling === null || dialablePhone(phone) === null) {
    return (
      <a href={href} className="flex w-fit items-center gap-1.5 underline underline-offset-4">
        {icon}
        {phone}
      </a>
    );
  }
  const busy = calling.active !== null && calling.active.call.status !== 'ended';

  async function copy() {
    try {
      await navigator.clipboard.writeText(phone);
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${phone}, call or copy`}
            className="flex w-fit cursor-pointer items-center gap-1.5 rounded-inset underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {icon}
            {phone}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-48">
          <DropdownMenuItem
            disabled={busy}
            onSelect={() => {
              calling.start(contactId, name);
            }}
          >
            <PhoneCall aria-hidden="true" />
            Call {name}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copy()}>
            <Copy aria-hidden="true" />
            Copy number
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {copied !== null && (
        <span
          role="status"
          className={cn('text-xs', copied === 'copied' ? 'text-success' : 'text-danger')}
        >
          {copied === 'copied' ? 'Number copied.' : 'Could not copy; select the number instead.'}
        </span>
      )}
    </span>
  );
}

/**
 * Under a call's entry in the contact history: its transcript, and for 24 hours its audio
 * (the owner's request of 2026-11-02). The audio comes through the API with the person's
 * sign-in, never from a link to Telnyx.
 */
export function CallRecordingDetails({
  token,
  recording,
}: {
  token: string;
  recording: CallRecordingView;
}) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (audioUrl !== null) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl],
  );

  // Read once when shown; the page is loaded again after a call, and the API checks again.
  const [shownAt] = useState(() => Date.now());
  const playable = recording.audioUntil !== null && Date.parse(recording.audioUntil) > shownAt;

  async function play() {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`/calls/recordings/${recording.id}/audio`, token);
      setAudioUrl(URL.createObjectURL(await response.blob()));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The recording could not be played.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      {recording.transcript === null ? (
        <p className="text-xs text-muted-foreground">
          {recording.transcriptFailed ? 'No transcript for this call.' : 'Transcript on its way…'}
        </p>
      ) : recording.lines?.length === 0 || recording.transcript.trim() === '' ? (
        <p className="text-xs text-muted-foreground">Nothing was said on this call.</p>
      ) : (
        <details className="rounded-control border px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium">Transcript</summary>
          {recording.lines === null ? (
            <p className="mt-2 whitespace-pre-wrap">{recording.transcript}</p>
          ) : (
            <TranscriptConversation recording={recording} lines={recording.lines} />
          )}
        </details>
      )}
      {playable && audioUrl === null && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2"
            disabled={loading}
            onClick={() => {
              void play();
            }}
          >
            <Play aria-hidden="true" />
            {loading ? 'Loading…' : 'Play recording'}
          </Button>
          <span className="text-xs text-muted-foreground">
            Kept until {formatAlberta(recording.audioUntil ?? '')}
          </span>
        </div>
      )}
      {audioUrl !== null && (
        <audio controls autoPlay src={audioUrl} className="w-full max-w-md">
          The recording cannot be played in this browser.
        </audio>
      )}
      {error !== null && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Seconds into the call as m:ss. */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * The transcript as a conversation (the owner's request of 2026-11-02): each turn with who said
 * it, the GSS caller's on one side and the counterparty's on the other.
 */
function TranscriptConversation({
  recording,
  lines,
}: {
  recording: CallRecordingView;
  lines: readonly TranscriptLine[];
}) {
  return (
    <ol className="mt-2 flex flex-col gap-2" aria-label="Transcript by side">
      {lines.map((line, index) => {
        const caller = line.side === 'caller';
        const who =
          line.side === 'caller'
            ? recording.callerName
            : line.side === 'counterparty'
              ? recording.contactName
              : 'Unknown speaker';
        return (
          <li
            key={`${String(index)}-${String(line.start)}`}
            data-side={line.side ?? 'unknown'}
            className={`flex max-w-[85%] flex-col gap-0.5 rounded-control px-3 py-1.5 ${
              caller ? 'self-start bg-muted' : 'self-end border bg-card'
            }`}
          >
            <span className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{who}</span> · {clock(line.start)}
            </span>
            <span className="whitespace-pre-wrap">{line.text}</span>
          </li>
        );
      })}
    </ol>
  );
}
