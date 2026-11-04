import { formatAlberta, type ImportSummary, type UndoImportPlan } from '@grain/domain';
import { useState } from 'react';

import { apiJson, ApiError } from '../lib/api';
import { useApiResource } from '../lib/useApiResource';
import { typeLabel } from '../lib/directory';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';

type Step =
  | { kind: 'list' }
  | { kind: 'preview'; batch: ImportSummary; plan: UndoImportPlan | null; error: string | null }
  | {
      kind: 'confirm';
      batch: ImportSummary;
      plan: UndoImportPlan;
      typed: string;
      busy: boolean;
      error: string | null;
    }
  | { kind: 'done'; plan: UndoImportPlan };

function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}

/** What undoing removes, and what it leaves for a person to check. */
function PlanText({ plan }: { plan: UndoImportPlan }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>
        <strong>
          Deletes {count(plan.companies, 'company', 'companies')} this import created, with{' '}
          {count(plan.locations, 'location', 'locations')}
        </strong>
        , their contacts, grains and logos.
      </p>
      {plan.kept.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p>
            <strong>Kept ({plan.kept.length}):</strong> it created these, but they now have a
            history or were made another type since. Archive or fix them by hand.
          </p>
          <Card asChild>
            <ul aria-label="Companies kept" className="divide-y">
              {plan.kept.map((company) => (
                <li key={company.id} className="px-4 py-2">
                  {company.name} ·{' '}
                  <span className="text-muted-foreground">
                    {company.reason === 'history'
                      ? 'has a contact history, follow-ups, calls, bids or freight'
                      : 'its type was changed since'}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
      {plan.listed.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p>
            <strong>Companies already listed that it changed ({plan.listed.length}):</strong> they
            stay; what it added is taken off.
          </p>
          <Card asChild>
            <ul aria-label="Companies already listed" className="divide-y">
              {plan.listed.map((company) => {
                const removed = [
                  company.locations > 0 && count(company.locations, 'location', 'locations'),
                  company.grains > 0 && count(company.grains, 'grain', 'grains'),
                  ...company.removedTypes.map((type) => `the ${typeLabel(type)} type`),
                  company.sellerDetails && 'its seller details',
                ].filter(Boolean);
                return (
                  <li key={company.id} className="flex flex-col gap-0.5 px-4 py-2">
                    <span className="font-medium">{company.name}</span>
                    {removed.length > 0 && (
                      <span className="text-muted-foreground">Removes {removed.join(', ')}.</span>
                    )}
                    {company.check.length > 0 && (
                      <span className="text-warning">
                        Check by hand, as the import changed it: {company.check.join(', ')}.
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}

/**
 * Undo an import, for admins (owner's request and answers, 2026-11-04): the imports, latest
 * first; for one, what undoing it removes; then, after typing how many companies it deletes,
 * the undo. Nothing can bring it back, so the count is asked for.
 */
export function UndoImport({
  session,
  onUndone,
  onClose,
}: {
  session: DirectorySession;
  onUndone: () => void;
  onClose: () => void;
}) {
  const { token, organization } = session;
  const [imports] = useApiResource<{ imports: ImportSummary[] }>(
    `/counterparties/imports?organization_id=${organization.id}`,
    token,
  );
  const [step, setStep] = useState<Step>({ kind: 'list' });

  async function undo(batch: ImportSummary, commit: boolean, expected?: number) {
    return apiJson<{ committed: boolean; plan: UndoImportPlan }>(
      `/counterparties/imports/${batch.id}/undo`,
      token,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commit, ...(expected !== undefined && { expected }) }),
      },
    );
  }

  async function preview(batch: ImportSummary) {
    setStep({ kind: 'preview', batch, plan: null, error: null });
    try {
      const { plan } = await undo(batch, false);
      setStep({ kind: 'confirm', batch, plan, typed: '', busy: false, error: null });
    } catch (error) {
      setStep({ kind: 'preview', batch, plan: null, error: messageOf(error) });
    }
  }

  if (step.kind === 'done') {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p role="status" className="font-medium">
          Import undone: {count(step.plan.companies, 'company', 'companies')} deleted.
        </p>
        {step.plan.listed.some((company) => company.check.length > 0) && (
          <p>Check the companies listed above by hand for what could not be put back.</p>
        )}
        <PlanText plan={step.plan} />
        <Button className="w-fit" onClick={onClose}>
          Done
        </Button>
      </div>
    );
  }

  if (step.kind === 'preview') {
    return step.error === null ? (
      <p role="status" className="text-sm">
        Working out what undoing {step.batch.fileName} removes…
      </p>
    ) : (
      <div className="flex flex-col gap-3 text-sm">
        <p role="alert" className="text-danger">
          {step.error}
        </p>
        <Button
          variant="outline"
          className="w-fit"
          onClick={() => {
            setStep({ kind: 'list' });
          }}
        >
          Back to the imports
        </Button>
      </div>
    );
  }

  if (step.kind === 'confirm') {
    const { batch, plan } = step;
    const matches = step.typed.trim() === String(plan.companies);
    const confirm = async () => {
      setStep({ ...step, busy: true, error: null });
      try {
        const result = await undo(batch, true, plan.companies);
        setStep({ kind: 'done', plan: result.plan });
        onUndone();
      } catch (error) {
        // The list changed since the preview: nothing was removed; this is the new plan.
        const fresh =
          error instanceof ApiError && error.code === 'PLAN_CHANGED'
            ? (error.body as { plan: UndoImportPlan }).plan
            : plan;
        setStep({ ...step, plan: fresh, typed: '', busy: false, error: messageOf(error) });
      }
    };
    return (
      <div className="flex flex-col gap-4 text-sm">
        <p>
          <strong>{batch.fileName}</strong>, imported {formatAlberta(batch.createdAt)}.
        </p>
        <PlanText plan={plan} />
        <p className="font-medium text-danger">
          This cannot be undone: the deleted companies are gone for good. Import the corrected
          spreadsheet again afterwards.
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="font-medium">
            To confirm, type the number of companies it deletes ({plan.companies})
          </span>
          <Input
            inputMode="numeric"
            className="w-40"
            value={step.typed}
            disabled={step.busy}
            onChange={(event) => {
              setStep({ ...step, typed: event.target.value, error: null });
            }}
          />
        </label>
        {step.error && (
          <p role="alert" className="text-danger">
            {step.error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="danger" disabled={!matches || step.busy} onClick={() => void confirm()}>
            {step.busy ? 'Undoing…' : 'Undo this import'}
          </Button>
          <Button
            variant="outline"
            disabled={step.busy}
            onClick={() => {
              setStep({ kind: 'list' });
            }}
          >
            Back to the imports
          </Button>
        </div>
      </div>
    );
  }

  if (imports.status === 'loading') return <p className="text-sm">Loading the imports…</p>;
  if (imports.status === 'error') {
    return (
      <p role="alert" className="text-sm text-danger">
        {imports.error.message}
      </p>
    );
  }
  if (imports.data.imports.length === 0) {
    return <p className="text-sm">No spreadsheet has been imported yet.</p>;
  }
  return (
    <Card asChild>
      <ul aria-label="Imports" className="divide-y text-sm">
        {imports.data.imports.map((batch) => (
          <li
            key={batch.id}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium">{batch.fileName}</span>
              <span className="text-muted-foreground">
                {formatAlberta(batch.createdAt)} · {count(batch.companies, 'company', 'companies')}{' '}
                still listed
              </span>
            </span>
            {batch.undoneAt !== null ? (
              <Badge>Undone</Badge>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void preview(batch)}
                aria-label={`Undo ${batch.fileName}`}
              >
                Undo…
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
