import { parseFreightTerms, type FreightFormValues, type FreightIssue } from '@grain/domain';
import { useState, type ReactNode, type SyntheticEvent } from 'react';

import { ApiError } from '../lib/api';
import { freightFormToRequest } from '../lib/freight';
import { FreightFields } from './FreightFields';
import { Button } from './ui/button';

/** The issues in a 422 answer to the freight form, if any. */
function freightIssues(error: unknown): FreightIssue[] {
  if (!(error instanceof ApiError) || typeof error.body !== 'object' || error.body === null) {
    return [];
  }
  const issues: unknown = (error.body as { issues?: unknown }).issues;
  return Array.isArray(issues) ? (issues as FreightIssue[]) : [];
}

/**
 * The freight terms form with its checks and buttons, like the bid and offer form: it checks
 * with the API's rules before sending. `before` holds fields of the page's own (carrier,
 * route, mode), checked by `checkBefore`.
 */
export function FreightForm({
  initial,
  submitLabel,
  busyLabel,
  onSubmit,
  onCancel,
  onReload,
  before,
  checkBefore,
}: {
  initial: FreightFormValues;
  submitLabel: string;
  busyLabel: string;
  /** Sends the terms, with their times as UTC instants. */
  onSubmit: (values: FreightFormValues) => Promise<void>;
  onCancel?: ReactNode;
  /** Shown when someone recorded newer terms meanwhile: loads them. */
  onReload?: () => void;
  before?: ReactNode;
  checkBefore?: () => string | null;
}) {
  const [values, setValues] = useState<FreightFormValues>(initial);
  const [issues, setIssues] = useState<FreightIssue[]>([]);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    setError(null);
    const before = checkBefore?.() ?? null;
    const request = freightFormToRequest(values);
    const checked = parseFreightTerms(request, new Date());
    setProblem(before);
    setIssues(checked.status === 'invalid' ? checked.issues : []);
    if (before !== null || checked.status === 'invalid') return;
    setBusy(true);
    try {
      await onSubmit(request);
    } catch (failure) {
      setIssues(freightIssues(failure));
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
      <FreightFields
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
