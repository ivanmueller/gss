import {
  isConfidentMatch,
  signedMatchOf,
  type GeocodeLookup,
  type GeocodeMiss,
  type GeocodeProposal,
  type GeocodeScope,
  type SaveCoordinatesResult,
  type SignedMatch,
} from '@grain/domain';
import { MapPin, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { apiJson, ApiError } from '../lib/api';
import { countryName } from '../lib/directory';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import { Button } from './ui/button';
import { Card } from './ui/card';

// Coordinates are found from the address when counterparties are added, by hand or from a
// spreadsheet, and on a counterparty's page (owner's request and answers, 2026-10-30). The
// API looks the addresses up with Geocodio and signs each result; here the sure ones are
// saved straight away and only the doubtful ones are shown for a decision.

const MISSES: Record<GeocodeMiss, string> = {
  NO_ADDRESS: 'No street, town or postal code to look up',
  NOT_FOUND: 'Not found',
  TOO_VAGUE: 'Only the province or state was found',
  OTHER_COUNTRY: 'Found only in another country',
};

type Step =
  | { kind: 'looking' }
  | {
      kind: 'review';
      saved: number;
      doubtful: GeocodeProposal[];
      missed: GeocodeProposal[];
      truncated: boolean;
      chosen: ReadonlySet<string>;
      busy: boolean;
      error: string | null;
    }
  | { kind: 'finished'; saved: number; missed: GeocodeProposal[]; truncated: boolean }
  | { kind: 'failed'; message: string };

function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}

function addressText(proposal: GeocodeProposal): string {
  const { addressLine, city, region, postalCode, country } = proposal.address;
  return [addressLine, city, region, postalCode, countryName(country)]
    .filter((part) => part !== null)
    .join(', ');
}

function locationName(proposal: GeocodeProposal): string {
  return proposal.facilityName
    ? `${proposal.legalName} · ${proposal.facilityName}`
    : proposal.legalName;
}

function signed(proposals: GeocodeProposal[]): SignedMatch[] {
  return proposals.flatMap((proposal) =>
    proposal.match ? [signedMatchOf(proposal.facilityId, proposal.match)] : [],
  );
}

/** Why a result is shown for a decision rather than saved. */
function CheckThis({ children }: { children: string }) {
  return (
    <span className="flex items-start gap-1.5 font-medium text-warning">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </span>
  );
}

function Missed({ proposals }: { proposals: GeocodeProposal[] }) {
  if (proposals.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm">
        <strong>No coordinates for {count(proposals.length, 'location', 'locations')}:</strong>{' '}
        correct the address on the counterparty’s page and use Find coordinates there, or enter the
        coordinates under the location’s Edit.
      </p>
      <Card asChild>
        <ul aria-label="Locations without coordinates" className="divide-y">
          {proposals.map((proposal) => (
            <li key={proposal.facilityId} className="flex flex-col px-4 py-2 text-sm">
              <span className="font-medium">{locationName(proposal)}</span>
              <span className="text-muted-foreground">
                {addressText(proposal)} · {proposal.miss ? MISSES[proposal.miss] : ''}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/**
 * Finds coordinates for the locations without any of one counterparty, of one import, and
 * saves the sure ones (in the right province or state, 80% confidence or more). The rest are
 * shown to be saved or skipped. `onDone` continues, with the button labelled `doneLabel`.
 */
export function FindCoordinates({
  session,
  scope,
  doneLabel,
  onDone,
}: {
  session: DirectorySession;
  scope: Exclude<GeocodeScope, null>;
  doneLabel: string;
  onDone: () => void;
}) {
  const { token, organization } = session;
  const [step, setStep] = useState<Step>({ kind: 'looking' });
  // Each lookup counts toward Geocodio's daily allowance: once per time this step is shown.
  const started = useRef(false);

  async function save(matches: SignedMatch[]): Promise<number> {
    if (matches.length === 0) return 0;
    const result = await apiJson<SaveCoordinatesResult>('/facilities/coordinates', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: organization.id, matches }),
    });
    return result.saved;
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const lookup = await apiJson<GeocodeLookup>('/facilities/geocode', token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ organizationId: organization.id, ...scope }),
        });
        const found = lookup.proposals.filter((proposal) => proposal.match !== null);
        const sure = found.filter((proposal) => proposal.match && isConfidentMatch(proposal.match));
        const doubtful = found.filter((proposal) => !sure.includes(proposal));
        const missed = lookup.proposals.filter((proposal) => proposal.match === null);
        const saved = await save(signed(sure));
        setStep(
          doubtful.length === 0
            ? { kind: 'finished', saved, missed, truncated: lookup.truncated }
            : {
                kind: 'review',
                saved,
                doubtful,
                missed,
                truncated: lookup.truncated,
                chosen: new Set(),
                busy: false,
                error: null,
              },
        );
      } catch (error) {
        setStep({ kind: 'failed', message: messageOf(error) });
      }
    })();
    // The lookup runs once, for the scope this step was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (step.kind === 'looking') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm">
        <MapPin aria-hidden="true" className="size-4 text-muted-foreground" />
        Finding coordinates from the addresses…
      </p>
    );
  }

  if (step.kind === 'failed') {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="text-sm text-danger">
          Coordinates could not be found: {step.message} Nothing else is affected; use Find
          coordinates on the counterparty’s page later.
        </p>
        <Button className="w-fit" onClick={onDone}>
          {doneLabel}
        </Button>
      </div>
    );
  }

  if (step.kind === 'finished') {
    return (
      <div role="status" className="flex flex-col gap-3 text-sm">
        <p>
          {step.saved > 0
            ? `Coordinates found and saved for ${count(step.saved, 'location', 'locations')}.`
            : step.missed.length === 0
              ? 'No location is waiting for coordinates.'
              : 'No coordinates were saved.'}
          {step.truncated &&
            ' Only the first 1,000 locations were looked up; use Find coordinates on the counterparties’ pages for the rest.'}
        </p>
        <Missed proposals={step.missed} />
        <Button className="w-fit" onClick={onDone}>
          {doneLabel}
        </Button>
      </div>
    );
  }

  const { doubtful, chosen, busy } = step;
  const finish = async (matches: SignedMatch[]) => {
    setStep({ ...step, busy: true, error: null });
    try {
      const saved = await save(matches);
      setStep({
        kind: 'finished',
        saved: step.saved + saved,
        missed: [...step.missed, ...doubtful.filter((p) => !chosen.has(p.facilityId))],
        truncated: step.truncated,
      });
    } catch (error) {
      setStep({ ...step, busy: false, error: messageOf(error) });
    }
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p role="status">
        {step.saved > 0 &&
          `Coordinates found and saved for ${count(step.saved, 'location', 'locations')}. `}
        {doubtful.length === 1
          ? 'One result needs a look before it is saved:'
          : `${count(doubtful.length, 'result needs', 'results need')} a look before they are saved:`}
      </p>
      <Card asChild>
        <ul aria-label="Results to check" className="divide-y">
          {doubtful.map((proposal) => {
            const match = proposal.match;
            if (!match) return null;
            return (
              <li key={proposal.facilityId} className="px-4 py-3">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                    checked={chosen.has(proposal.facilityId)}
                    disabled={busy}
                    onChange={() => {
                      const next = new Set(chosen);
                      if (!next.delete(proposal.facilityId)) next.add(proposal.facilityId);
                      setStep({ ...step, chosen: next, error: null });
                    }}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium">{locationName(proposal)}</span>
                    <span className="text-muted-foreground">
                      Your address: {addressText(proposal)}
                    </span>
                    <span>
                      Found: {match.formattedAddress} ·{' '}
                      {match.precision === 'exact' ? 'Exact' : 'Approximate (e.g. the town)'} ·{' '}
                      {Math.round(Number(match.confidence) * 100)}% confidence
                    </span>
                    {!match.regionMatches ? (
                      <CheckThis>In another province or state than your address.</CheckThis>
                    ) : (
                      <CheckThis>Low confidence.</CheckThis>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </Card>
      {step.error && (
        <p role="alert" className="text-danger">
          {step.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || chosen.size === 0}
          onClick={() => void finish(signed(doubtful.filter((p) => chosen.has(p.facilityId))))}
        >
          {busy ? 'Saving…' : `Save ${count(chosen.size, 'chosen result', 'chosen results')}`}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void finish([])}>
          Skip {doubtful.length === 1 ? 'it' : 'them'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Only addresses are sent to Geocodio, never names or contacts.
      </p>
    </div>
  );
}
