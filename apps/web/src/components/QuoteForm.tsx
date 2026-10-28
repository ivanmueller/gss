import { parseQuoteTerms, type QuoteFormValues, type QuoteIssue } from '@grain/domain';
import { useState, type ReactNode, type SyntheticEvent } from 'react';

import { ApiError } from '../lib/api';
import { formToRequest } from '../lib/quotes';
import { QuoteFields } from './QuoteFields';
import { Button } from './ui/button';

/** The issues in a 422 answer to the quote form, if any. */
function quoteIssues(error: unknown): QuoteIssue[] {
  if (!(error instanceof ApiError) || typeof error.body !== 'object' || error.body === null) {
    return [];
  }
  const issues: unknown = (error.body as { issues?: unknown }).issues;
  return Array.isArray(issues) ? (issues as QuoteIssue[]) : [];
}

/**
 * The terms form with its checks and buttons. Checks with the same rules as the API before
 * sending, so most problems show without a round trip. `before` holds fields of the page's
 * own (which counterparty, which commodity), checked by `checkBefore`.
 */
export function QuoteForm({
  initial,
  submitLabel,
  busyLabel,
  onSubmit,
  onCancel,
  onReload,
  before,
  checkBefore,
}: {
  initial: QuoteFormValues;
  submitLabel: string;
  busyLabel: string;
  /** Sends the terms, with their times as UTC instants. */
  onSubmit: (values: QuoteFormValues) => Promise<void>;
  onCancel?: ReactNode;
  /** Shown when someone recorded newer terms meanwhile: loads them. */
  onReload?: () => void;
  before?: ReactNode;
  checkBefore?: () => string | null;
}) {
  const [values, setValues] = useState<QuoteFormValues>(initial);
  const [issues, setIssues] = useState<QuoteIssue[]>([]);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    setError(null);
    const before = checkBefore?.() ?? null;
    const request = formToRequest(values);
    const checked = parseQuoteTerms(request, new Date());
    setProblem(before);
    setIssues(checked.status === 'invalid' ? checked.issues : []);
    if (before !== null || checked.status === 'invalid') return;
    setBusy(true);
    try {
      await onSubmit(request);
    } catch (failure) {
      setIssues(quoteIssues(failure));
      setError({
        code: failure instanceof ApiError ? failure.code : '',
        message: failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.',
      });
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-6">
      {before}
      {problem && (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      )}
      <QuoteFields
        values={values}
        issues={issues}
        disabled={busy}
        onChange={(changes) => {
          setValues((current) => ({ ...current, ...changes }));
        }}
      />
      {issues.length > 0 && (
        <p role="status" className="text-sm text-danger">
          Some fields need fixing; see the messages above.
        </p>
      )}
      {error && issues.length === 0 && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
          <p>{error.message}</p>
          {error.code === 'QUOTE_CHANGED' && onReload && (
            <Button type="button" size="sm" variant="outline" onClick={onReload}>
              Load the latest terms
            </Button>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? busyLabel : submitLabel}
        </Button>
        {onCancel}
      </div>
    </form>
  );
}
