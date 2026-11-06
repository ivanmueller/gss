import { formatAlberta, type CounterpartySummaryView } from '@grain/domain';
import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ApiError, sendJson } from '../lib/api';
import { useApiResource } from '../lib/useApiResource';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import { ClaudeMark } from './ClaudeMark';
import { Button } from './ui/button';
import { Card, CardHeader, CardTitle } from './ui/card';

// Claude's summary of a company at the top of its page (the owner's request and answers of
// 2026-11-05, docs/DECISIONS.md): a few lines from GSS's own records, written automatically
// after something new (at most once an hour) or when someone asks with Refresh. For reading
// only; the records below it are what counts.

/** How often the box looks again while a summary is being written. */
const WATCH_MS = 20_000;

export function CounterpartySummary({
  session,
  counterpartyId,
  canAsk,
}: {
  session: DirectorySession;
  counterpartyId: string;
  /** May ask for a new summary: traders, operations and admins, while not archived. */
  canAsk: boolean;
}) {
  const [resource, reload] = useApiResource<CounterpartySummaryView>(
    `/counterparties/${counterpartyId}/summary`,
    session.token,
  );
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const view = resource.status === 'ok' ? resource.data : null;
  const pending = view !== null && (view.requested || view.writing);

  // While a summary is being written, look again every 20 seconds until it is there.
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(reload, WATCH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [pending, reload]);

  async function ask() {
    setAsking(true);
    setError(null);
    try {
      await sendJson(`/counterparties/${counterpartyId}/summary/request`, session.token, 'POST');
      reload();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.');
    } finally {
      setAsking(false);
    }
  }

  const lines = view?.summary?.split('\n') ?? [];
  const writtenAt = view?.writtenAt ?? null;
  return (
    <Card asChild className="overflow-hidden">
      <section aria-labelledby="summary-heading">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle id="summary-heading">Summary</CardTitle>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-claude">
              <ClaudeMark className="size-3.5" />
              Drafted by Claude
            </span>
          </div>
          {canAsk && lines.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={asking || pending}
              onClick={() => void ask()}
            >
              <RefreshCw aria-hidden="true" />
              Refresh
            </Button>
          )}
        </CardHeader>
        <div className="flex flex-col gap-2 px-4 py-3 text-sm">
          {resource.status === 'loading' && <p className="text-muted-foreground">Loading…</p>}
          {resource.status === 'error' && (
            <p className="text-muted-foreground">
              The summary could not be loaded: {resource.error.message}
            </p>
          )}
          {lines.length > 0 && (
            <ul className="flex flex-col gap-1.5" aria-label="Summary of the company">
              {lines.map((line, index) => (
                <li key={index} className="flex gap-2">
                  <span aria-hidden="true" className="text-muted-foreground">
                    ·
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          )}
          {writtenAt !== null && (
            <p className="text-xs text-muted-foreground">
              Written {formatAlberta(writtenAt, { weekday: false })} from the records on this page.
              Check them before acting on it.
            </p>
          )}
          {pending && (
            <p role="status" className="text-xs text-muted-foreground">
              Claude is writing a new summary. It appears here within a few minutes.
            </p>
          )}
          {view !== null && view.summary === null && !pending && !view.failed && (
            <p className="text-muted-foreground">
              No summary yet. Claude writes one after the next call, note, bid or offer, or
              follow-up.
            </p>
          )}
          {view !== null && view.failed && !pending && (
            <p className="text-muted-foreground">
              Claude could not write a summary. It tries again after the next call, note, bid or
              offer, or follow-up.
            </p>
          )}
          {canAsk && view !== null && view.summary === null && !pending && (
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              disabled={asking}
              onClick={() => void ask()}
            >
              <ClaudeMark className="text-current" />
              {view.failed ? 'Try again' : 'Write one now'}
            </Button>
          )}
          {error !== null && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
        </div>
      </section>
    </Card>
  );
}
