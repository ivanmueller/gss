import {
  LOW_CONFIDENCE,
  signedMatchOf,
  type GeocodeLookup,
  type GeocodeMiss,
  type GeocodeProposal,
  type SaveCoordinatesResult,
  type SignedMatch,
} from '@grain/domain';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';

import { RealDataNote } from '../components/RealDataNote';
import { apiJson, ApiError } from '../lib/api';
import { canEditDirectory, countryName } from '../lib/directory';
import { Link } from '../lib/router';
import type { DirectorySession } from './CounterpartiesPage';

const MISSES: Record<GeocodeMiss, string> = {
  NO_ADDRESS: 'No street, town or postal code to look up',
  NOT_FOUND: 'Not found',
  TOO_VAGUE: 'Only the province or state was found',
  OTHER_COUNTRY: 'Found only in another country',
};

const BUTTON =
  'rounded-md border px-3 py-1.5 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50';
const PRIMARY = `${BUTTON} bg-primary text-primary-foreground hover:opacity-90`;
const SECONDARY = `${BUTTON} hover:bg-muted`;

type Step =
  | { kind: 'start'; busy: boolean; error: string | null }
  | {
      kind: 'review';
      lookup: GeocodeLookup;
      chosen: ReadonlySet<string>;
      busy: boolean;
      error: string | null;
    }
  | { kind: 'saved'; result: SaveCoordinatesResult; truncated: boolean };

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

/** Chosen unless the reviewer should look first: another province or state, or low confidence. */
function chosenByDefault(proposal: GeocodeProposal): boolean {
  return (
    proposal.match !== null &&
    proposal.match.regionMatches &&
    Number(proposal.match.confidence) >= LOW_CONFIDENCE
  );
}

function signedMatch(proposal: GeocodeProposal): SignedMatch[] {
  return proposal.match ? [signedMatchOf(proposal.facilityId, proposal.match)] : [];
}

function Found({
  proposals,
  chosen,
  disabled,
  onToggle,
}: {
  proposals: GeocodeProposal[];
  chosen: ReadonlySet<string>;
  disabled: boolean;
  onToggle: (facilityId: string) => void;
}) {
  return (
    <ul aria-label="Locations found" className="divide-y rounded-xl border bg-card">
      {proposals.map((proposal) => {
        const match = proposal.match;
        if (!match) return null;
        const confidence = Math.round(Number(match.confidence) * 100);
        return (
          <li key={proposal.facilityId} className="px-4 py-3 text-sm">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 size-4"
                checked={chosen.has(proposal.facilityId)}
                disabled={disabled}
                onChange={() => {
                  onToggle(proposal.facilityId);
                }}
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">{locationName(proposal)}</span>
                <span className="text-muted-foreground">Your address: {addressText(proposal)}</span>
                <span>
                  Found: {match.formattedAddress} ·{' '}
                  {match.precision === 'exact' ? 'Exact' : 'Approximate (e.g. the town)'} ·{' '}
                  {confidence}% confidence
                </span>
                {!match.regionMatches && (
                  <span className="text-red-700">
                    Check this one: it is in another province or state than your address.
                  </span>
                )}
                {Number(match.confidence) < LOW_CONFIDENCE && (
                  <span className="text-red-700">Check this one: low confidence.</span>
                )}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/** /map/coordinates: look addresses up with Geocodio, review, and save the chosen points. */
export function CoordinatesPage({ session }: { session: DirectorySession }) {
  const { token, organization } = session;
  const [step, setStep] = useState<Step>({ kind: 'start', busy: false, error: null });

  const header = (
    <div className="flex flex-col gap-1">
      <Link
        href="/map"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Map
      </Link>
      <h2 id="coordinates-heading" className="text-lg font-semibold">
        Find coordinates
      </h2>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Looks up the addresses of {organization.name}’s locations that have no coordinates, using
        Geocodio. Only the addresses are sent, never names or contacts. You choose what to save;
        locations that already have coordinates are never changed.
      </p>
    </div>
  );

  if (!canEditDirectory(organization.role)) {
    return (
      <section aria-labelledby="coordinates-heading" className="flex flex-col gap-4">
        {header}
        <p role="note" className="rounded-lg border bg-card px-3 py-2 text-sm">
          Only operations and admin members can find and save coordinates.
        </p>
      </section>
    );
  }

  async function lookUp() {
    setStep({ kind: 'start', busy: true, error: null });
    try {
      const lookup = await apiJson<GeocodeLookup>('/facilities/geocode', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: organization.id }),
      });
      const chosen = new Set(
        lookup.proposals.filter(chosenByDefault).map((proposal) => proposal.facilityId),
      );
      setStep({ kind: 'review', lookup, chosen, busy: false, error: null });
    } catch (error) {
      setStep({ kind: 'start', busy: false, error: messageOf(error) });
    }
  }

  async function save(lookup: GeocodeLookup, chosen: ReadonlySet<string>) {
    setStep({ kind: 'review', lookup, chosen, busy: true, error: null });
    const matches = lookup.proposals
      .filter((proposal) => chosen.has(proposal.facilityId))
      .flatMap(signedMatch);
    try {
      const result = await apiJson<SaveCoordinatesResult>('/facilities/coordinates', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: organization.id, matches }),
      });
      setStep({ kind: 'saved', result, truncated: lookup.truncated });
    } catch (error) {
      setStep({ kind: 'review', lookup, chosen, busy: false, error: messageOf(error) });
    }
  }

  let body;
  if (step.kind === 'start') {
    body = (
      <div className="flex flex-col items-start gap-2">
        <button
          type="button"
          className={PRIMARY}
          disabled={step.busy}
          onClick={() => void lookUp()}
        >
          {step.busy ? 'Looking up addresses…' : 'Look up addresses'}
        </button>
        <p className="text-xs text-muted-foreground">
          Each address counts toward Geocodio’s free allowance of 2,500 lookups a day.
        </p>
        {step.error && (
          <p role="alert" className="text-sm text-red-700">
            {step.error}
          </p>
        )}
      </div>
    );
  } else if (step.kind === 'review') {
    const { lookup, chosen, busy } = step;
    const found = lookup.proposals.filter((proposal) => proposal.match !== null);
    const missed = lookup.proposals.filter((proposal) => proposal.match === null);
    const exact = found.filter((proposal) => proposal.match?.precision === 'exact').length;
    const toggle = (facilityId: string) => {
      const next = new Set(chosen);
      if (!next.delete(facilityId)) next.add(facilityId);
      setStep({ ...step, chosen: next, error: null });
    };
    body = (
      <>
        <p role="status" className="text-sm">
          {lookup.proposals.length === 0
            ? 'Every location already has coordinates.'
            : `Found ${count(found.length, 'location', 'locations')} of ${lookup.proposals.length.toLocaleString('en-US')}: ${String(exact)} exact, ${String(found.length - exact)} approximate.` +
              (missed.length > 0 ? ` ${count(missed.length, 'was', 'were')} not found.` : '')}
          {lookup.truncated &&
            ' Only the first 1,000 locations were looked up; save these, then look up again for the rest.'}
        </p>
        {found.length > 0 && (
          <>
            <Found proposals={found} chosen={chosen} disabled={busy} onToggle={toggle} />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={PRIMARY}
                disabled={busy || chosen.size === 0}
                onClick={() => void save(lookup, chosen)}
              >
                {busy ? 'Saving…' : `Save ${count(chosen.size, 'location', 'locations')}`}
              </button>
              <button
                type="button"
                className={SECONDARY}
                disabled={busy}
                onClick={() => void lookUp()}
              >
                Look up again
              </button>
            </div>
          </>
        )}
        {step.error && (
          <p role="alert" className="text-sm text-red-700">
            {step.error}
          </p>
        )}
        {missed.length > 0 && (
          <section aria-labelledby="missed-heading" className="flex flex-col gap-2">
            <h3 id="missed-heading" className="text-sm font-semibold">
              Not found ({missed.length})
            </h3>
            <ul aria-label="Locations not found" className="divide-y rounded-xl border bg-card">
              {missed.map((proposal) => (
                <li key={proposal.facilityId} className="flex flex-col px-4 py-2 text-sm">
                  <span className="font-medium">{locationName(proposal)}</span>
                  <span className="text-muted-foreground">
                    {addressText(proposal)} · {proposal.miss ? MISSES[proposal.miss] : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    );
  } else {
    const { result, truncated } = step;
    body = (
      <div role="status" className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm">
        <p>
          Saved coordinates for {count(result.saved, 'location', 'locations')}.
          {result.skipped > 0 &&
            ` ${count(result.skipped, 'was', 'were')} not saved because ${result.skipped === 1 ? 'it has' : 'they have'} coordinates by now.`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/map" className={PRIMARY}>
            See them on the map
          </Link>
          {truncated && (
            <button type="button" className={SECONDARY} onClick={() => void lookUp()}>
              Look up the rest
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <section aria-labelledby="coordinates-heading" className="flex flex-col gap-4">
      {header}
      <RealDataNote organization={organization.name} />
      {body}
    </section>
  );
}
