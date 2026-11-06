import type { CallView } from '@grain/domain';
import { useEffect, useState } from 'react';

import { apiJson } from '../lib/api';
import { CallBox, ENDED_LINE_MS, POLL_MS } from './Calling';

// Callbacks to GSS's number (the owner's request of 2026-11-06, F-132): while the app is open,
// it asks every few seconds whether a callback is ringing the person's cell, and shows the live
// call box for it, on whatever page they are, until the call ends or moves on to someone else.
// Nothing here talks to Telnyx.

/** How often the app asks whether a callback is ringing the person's cell, while it is shown. */
export const WATCH_MS = 5000;

/**
 * How long a callback is followed at most: Telnyx ends every leg after 4 hours, so a call the
 * person took is followed that long, with a margin (Codex's review of f7a0d73, finding 3); past
 * it, the box goes and the watch starts again.
 */
export const FOLLOW_LIMIT_MS = (4 * 60 + 15) * 60 * 1000;

/**
 * The call box for a callback ringing the signed-in person's cell. Asks only while the page is
 * shown; once a callback is found, follows it as the call box does a call placed from a page.
 */
export function IncomingCalls({
  token,
  organizationId,
}: {
  token: string;
  organizationId: string;
}) {
  const [call, setCall] = useState<CallView | null>(null);
  const callId = call?.id ?? null;
  const over = call !== null && (call.status === 'ended' || call.callback?.you === 'passed');
  // Tied to the call (when it came in), so neither a renewed sign-in token nor a reload starts it
  // again (Codex's review of 9d5e57b, finding 2).
  const deadline = call === null ? null : Date.parse(call.createdAt) + FOLLOW_LIMIT_MS;

  // Watches for a callback while none is shown.
  useEffect(() => {
    if (callId !== null) return;
    let controller = new AbortController();
    const look = () => {
      if (document.visibilityState !== 'visible') return;
      controller.abort();
      controller = new AbortController();
      const { signal } = controller;
      apiJson<{ call: CallView | null }>(
        `/callbacks/mine?organization_id=${organizationId}`,
        token,
        {
          signal,
        },
      )
        .then((answer) => {
          const found = answer.call as CallView | null | undefined;
          if (!signal.aborted && typeof found?.id === 'string') setCall(found);
        })
        .catch(() => {
          // Asked again shortly; a missed look only delays the box.
        });
    };
    look();
    const timer = window.setInterval(look, WATCH_MS);
    document.addEventListener('visibilitychange', look);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', look);
    };
  }, [callId, organizationId, token]);

  // Follows the callback until it is over for this person.
  useEffect(() => {
    if (callId === null || over || deadline === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Past the deadline (no end ever reported), the box goes and the watch starts again.
    const next = () => {
      if (Date.now() < deadline) poll();
      else setCall(null);
    };
    const poll = () => {
      timer = setTimeout(() => {
        apiJson<{ call: CallView }>(`/calls/${callId}`, token)
          .then((answer) => {
            if (cancelled) return;
            setCall(answer.call);
            if (answer.call.status !== 'ended') next();
          })
          .catch(() => {
            if (!cancelled) next();
          });
      }, POLL_MS);
    };
    next();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [callId, over, token, deadline]);

  // Once over, the box stays a few seconds, then goes, and the watch starts again.
  useEffect(() => {
    if (callId === null || !over) return;
    const timer = setTimeout(() => {
      setCall(null);
    }, ENDED_LINE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [callId, over]);

  if (call === null) return null;
  const name = call.callback?.companyName ?? call.callback?.callerPhone ?? call.contactName;
  return (
    <CallBox
      notice={{
        kind: 'call',
        call,
        name: name === call.contactName ? name : `${call.contactName} · ${name}`,
      }}
      onDismiss={() => {
        setCall(null);
      }}
      onAddCell={() => undefined}
    />
  );
}
