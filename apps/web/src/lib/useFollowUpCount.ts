import type { FollowUpCount } from '@grain/domain';
import { useEffect, useState } from 'react';

import { apiJson } from './api';
import { FOLLOW_UPS_CHANGED } from './crm';

/** How often the menu's count is asked for again while the page is open. */
const REFRESH_MS = 60_000;

/**
 * The signed-in person's follow-ups overdue or due today, for the menu: asked for every
 * minute, when the page is shown again and after a follow-up changes; 0 until known or when
 * the server cannot be reached (the Follow-ups page says more).
 */
export function useFollowUpCount(
  session: { token: string; organizationId: string } | null,
): number {
  const [count, setCount] = useState(0);
  const token = session?.token ?? null;
  const organizationId = session?.organizationId ?? null;

  useEffect(() => {
    if (token === null || organizationId === null) return;
    let controller = new AbortController();
    const load = () => {
      controller.abort();
      controller = new AbortController();
      const { signal } = controller;
      apiJson<FollowUpCount>(`/follow-ups/count?organization_id=${organizationId}`, token, {
        signal,
      })
        .then((answer) => {
          if (!signal.aborted) setCount(answer.overdue + answer.dueToday);
        })
        .catch(() => {
          // Keep the last count; the menu is a reminder, not the record.
        });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    window.addEventListener(FOLLOW_UPS_CHANGED, load);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener(FOLLOW_UPS_CHANGED, load);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [token, organizationId]);

  return token === null ? 0 : count;
}
