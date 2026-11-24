import type { Operator } from '@grain/domain';
import { X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { ApiError, apiJson } from '../lib/api';
import { SIDE_LABEL } from './MapSide';

/** The answer of GET /api/v1/petroleum/operators (apps/api/src/petro-operators.ts). */
interface Answer {
  operators: Operator[];
}

/** "40 wells · 5 facilities · 12 pipelines", the parts with none left out. */
export function operatorHolds(o: Operator): string {
  const parts: string[] = [];
  const each = (n: number, one: string, many: string) => {
    if (n > 0) parts.push(`${n.toLocaleString('en-CA')} ${n === 1 ? one : many}`);
  };
  each(o.wells, 'well', 'wells');
  each(o.facilities, 'facility', 'facilities');
  each(o.pipelines, 'pipeline segment', 'pipeline segments');
  each(o.land, 'land agreement tract', 'land agreement tracts');
  return parts.join(' · ');
}

/**
 * One Operator box for the whole map (F-302, the owner, 2026-11-24): every operator with a well,
 * facility, pipeline or Crown land in what is loaded, to pick or type. What is typed fills the
 * operator box of Wells & licences, Facilities and Pipelines, Land today's Holder and Land
 * sales' Buyer at once (each can still be changed on its own), names compared whatever their
 * case or punctuation; land by name only (part 3). The list is asked for once, when the box
 * is first used, and kept by the browser.
 */
export function OperatorPicker({
  organizationId,
  token,
  value,
  onChange,
}: {
  organizationId: string;
  token: string;
  value: string;
  onChange: (text: string) => void;
}) {
  const listId = useId();
  const [used, setUsed] = useState(false);
  const [operators, setOperators] = useState<Operator[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const wanted = used && operators === null;
  useEffect(() => {
    if (!wanted) return;
    const controller = new AbortController();
    apiJson<Answer>(
      `/petroleum/operators?organization_id=${encodeURIComponent(organizationId)}`,
      token,
      { signal: controller.signal },
    )
      .then((got) => {
        setOperators(got.operators);
        setProblem(null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setUsed(false);
        setProblem(
          error instanceof ApiError && error.code === 'PETROLEUM_NOT_READY'
            ? 'The oil and gas database is being updated. Try again in a few minutes.'
            : 'The operators could not be loaded. Try again later.',
        );
      });
    return () => {
      controller.abort();
    };
  }, [wanted, organizationId, token]);

  const picked = operators?.find((o) => o.name === value) ?? null;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${listId}-box`} className={SIDE_LABEL}>
        Operator
      </label>
      <div className="relative">
        <input
          id={`${listId}-box`}
          list={listId}
          className="h-9 w-full rounded-md border bg-card pr-8 pl-3 text-sm"
          placeholder="Every operator"
          autoComplete="off"
          value={value}
          onFocus={() => {
            setUsed(true);
          }}
          onChange={(event) => {
            setUsed(true);
            onChange(event.target.value);
          }}
        />
        {value !== '' && (
          <button
            type="button"
            aria-label="Every operator"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
            onClick={() => {
              onChange('');
            }}
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        )}
        <datalist id={listId}>
          {(operators ?? []).map((o) => (
            <option key={o.name} value={o.name} label={operatorHolds(o)} />
          ))}
        </datalist>
      </div>
      {problem !== null ? (
        <p className="text-xs text-destructive">{problem}</p>
      ) : picked !== null ? (
        <p className="text-xs text-muted-foreground">Loaded: {operatorHolds(picked)}.</p>
      ) : value !== '' ? (
        <p className="text-xs text-muted-foreground">
          Wells, facilities, pipelines and land of the operators whose name holds this.
        </p>
      ) : null}
    </div>
  );
}
