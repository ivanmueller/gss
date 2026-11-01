import { parseNewCounterparty, type CarrierLane, type FieldIssue } from '@grain/domain';
import { Plus, Trash2 } from 'lucide-react';
import { useId, useState, type ReactNode, type SyntheticEvent } from 'react';

import { ApiError, fieldIssues, sendJson } from '../lib/api';
import { navigate } from '../lib/router';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import {
  draftLanes,
  EMPTY_LANE_DRAFT,
  LaneFields,
  laneDraftProblem,
  type LaneDraft,
} from './CarrierLanes';
import {
  CompanyFields,
  ContactFields,
  EquipmentFields,
  equipmentOf,
  FormIssues,
  LocationFields,
  splitAccess,
  type FormValues,
} from './DirectoryFields';
import { FindCoordinates } from './FindCoordinates';
import { Button } from './ui/button';

/** A part of the form, with a heading and an optional note. */
function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 border-t pt-4 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-col gap-0.5">
        <h3 id={id} className="text-sm font-semibold">
          {title}
        </h3>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  );
}

/** Whether rail or truck access is asked: for a buyer's or seller's location, not a carrier's. */
function asksAccess(types: string | undefined): boolean {
  const chosen = (types ?? '').split(',').filter(Boolean);
  return chosen.length === 0 || chosen.some((type) => type !== 'carrier');
}

function isCarrier(types: string | undefined): boolean {
  return (types ?? '').split(',').includes('carrier');
}

/** Whether a lane draft was left untouched (and is not sent). */
function untouched(draft: LaneDraft): boolean {
  return draft.origin === '' && draft.destinations.length === 0;
}

/**
 * The lanes to send from the drafts, or the first problem as "Lanes 2: …"; untouched
 * drafts are left out.
 */
export function lanesFromDrafts(
  drafts: readonly LaneDraft[],
): { lanes: CarrierLane[] } | { problem: string } {
  const lanes: CarrierLane[] = [];
  for (const [index, draft] of drafts.entries()) {
    if (untouched(draft)) continue;
    const problem = laneDraftProblem(draft);
    if (problem) return { problem: `Lanes ${String(index + 1)}: ${problem}` };
    lanes.push(...draftLanes(draft));
  }
  return { lanes };
}

/**
 * One counterparty entered by hand, with the import's fields, in the + button's window
 * (owner's request, 2026-10-30). A location given without coordinates gets them from its
 * address before the new counterparty's page opens.
 */
export function AddCounterpartyForm({
  session,
  onCancel,
}: {
  session: DirectorySession;
  onCancel: () => void;
}) {
  const { token, organization } = session;
  const [values, setValues] = useState<FormValues>({ verificationStatus: 'unverified' });
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<{ id: string; name: string } | null>(null);
  // A carrier's lanes, each from one place to several (owner's request, 2026-11-01).
  const [laneDrafts, setLaneDrafts] = useState<LaneDraft[]>([EMPTY_LANE_DRAFT]);
  const carrier = isCarrier(values.types);
  const carrierOnly = carrier && !asksAccess(values.types);

  if (added) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">{added.name} was added.</p>
        <FindCoordinates
          session={session}
          scope={{ counterpartyId: added.id }}
          doneLabel={`Open ${added.name}`}
          onDone={() => {
            navigate(`/counterparties/${added.id}`);
          }}
        />
      </div>
    );
  }

  const fields = {
    values,
    issues,
    disabled: busy,
    onChange: (changes: FormValues) => {
      setValues((current) => ({
        ...current,
        ...changes,
        // A location's country follows the company's until it is chosen separately.
        ...(changes.country !== undefined &&
          (current.facilityCountry ?? '') === (current.country ?? '') && {
            facilityCountry: changes.country,
          }),
      }));
    },
  };

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    setError(null);
    // The same rules the API applies, so most problems show without a round trip.
    const checked = parseNewCounterparty(values);
    if (checked.status !== 'ok') {
      setIssues(
        checked.status === 'empty'
          ? [{ field: 'legalName', message: 'is required' }]
          : checked.issues,
      );
      return;
    }
    const lanes = carrier ? lanesFromDrafts(laneDrafts) : { lanes: [] };
    if ('problem' in lanes) {
      setIssues([{ field: null, message: lanes.problem }]);
      return;
    }
    setIssues([]);
    setBusy(true);
    // Equipment is sent beside the fields; market and tier are not a carrier's.
    const { equipment, ...fieldValues } = values;
    const sent = carrierOnly ? { ...fieldValues, markets: '', tier: '' } : fieldValues;
    const access = asksAccess(values.types)
      ? splitAccess(sent)
      : splitAccess({ ...sent, transportAccess: '' });
    try {
      const created = await sendJson<{ id: string }>('/counterparties', token, 'POST', {
        organizationId: organization.id,
        ...access,
        ...(carrier && { equipment: equipmentOf(equipment), lanes: lanes.lanes }),
      });
      if (checked.record.facility?.latitude === null) {
        setAdded({ id: created.id, name: checked.record.counterparty.legalName });
      } else {
        navigate(`/counterparties/${created.id}`);
      }
    } catch (failure) {
      setIssues(fieldIssues(failure));
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <form
      aria-label="Add one counterparty"
      noValidate
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-4"
    >
      <Section title="Company">
        <CompanyFields {...fields} />
      </Section>
      {carrier && (
        <Section
          title="Equipment and lanes"
          note="Optional. Truck or rail only when you know which; lanes can be added later on its page."
        >
          <EquipmentFields props={fields} />
          {laneDrafts.map((draft, index) => (
            <fieldset
              // Drafts are only added at the end and removed by position.
              key={index}
              aria-label={`Lanes ${String(index + 1)}`}
              className="flex flex-col gap-3 rounded-control border p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Lanes {index + 1}</span>
                {laneDrafts.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove lanes ${String(index + 1)}`}
                    disabled={busy}
                    onClick={() => {
                      setLaneDrafts(laneDrafts.filter((_, other) => other !== index));
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                    Remove
                  </Button>
                )}
              </div>
              <LaneFields
                value={draft}
                disabled={busy}
                onChange={(next) => {
                  setLaneDrafts(laneDrafts.map((other, at) => (at === index ? next : other)));
                }}
              />
            </fieldset>
          ))}
          <Button
            size="sm"
            variant="outline"
            className="w-fit"
            disabled={busy}
            onClick={() => {
              setLaneDrafts([...laneDrafts, EMPTY_LANE_DRAFT]);
            }}
          >
            <Plus aria-hidden="true" />
            Lanes from another place
          </Button>
        </Section>
      )}
      <Section title="Contact" note="Optional. Leave empty to add contacts later.">
        <ContactFields {...fields} />
      </Section>
      <Section
        title={carrierOnly ? 'Home yard' : 'Location'}
        note="Optional. Its coordinates are found from the address when you add it."
      >
        <LocationFields {...fields} access={asksAccess(values.types)} />
      </Section>
      <FormIssues issues={issues} />
      {issues.length > 0 && (
        <p role="status" className="text-sm text-danger">
          Some fields need fixing; see the messages above.
        </p>
      )}
      {error && issues.length === 0 && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Adding…' : 'Add counterparty'}
        </Button>
        <Button variant="outline" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
