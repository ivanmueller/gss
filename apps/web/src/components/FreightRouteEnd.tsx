import {
  LANE_REGIONS,
  laneRegionName,
  regionFromAreaText,
  type FreightEndInput,
  type FreightPlaceAnswer,
} from '@grain/domain';
import { MapPin } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { ApiError, sendJson, type CounterpartyDetail, type CounterpartySummary } from '../lib/api';
import { counterpartyOptions } from '../lib/directory';
import { freightPlace } from '../lib/freight';
import { useApiResource } from '../lib/useApiResource';
import { Field } from './DirectoryFields';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { SearchSelect } from './ui/search-select';
import { Select } from './ui/select';
import { SegmentedControl } from './ui/segmented-control';

/**
 * One end of a freight route as the form holds it (F-235): a saved location (a company, then
 * one of its locations), or a town or area as the company wrote it, with its province or
 * state and, once found on the map, the match the Worker signed.
 */
export type RouteEndValue =
  | { kind: 'facility'; counterpartyId: string; facilityId: string }
  | {
      kind: 'area';
      text: string;
      region: string;
      found: FreightPlaceAnswer | null;
      /** The person accepted the place found (ticked, or sure). */
      accepted: boolean;
      /**
       * The person picked the province or state: the text no longer changes it ("Fort
       * Saskatchewan" in Alberta; Codex F-235-1-R4-01).
       */
      regionChosen: boolean;
    };

export const EMPTY_AREA: RouteEndValue = {
  kind: 'area',
  text: '',
  region: '',
  found: null,
  accepted: false,
  regionChosen: false,
};

export const EMPTY_FACILITY: RouteEndValue = {
  kind: 'facility',
  counterpartyId: '',
  facilityId: '',
};

/** An area typed as the company wrote it, its province or state read from its end. */
export function areaEnd(text: string): RouteEndValue {
  return { ...EMPTY_AREA, text, region: regionFromAreaText(text) ?? '' } as RouteEndValue;
}

/** Why the end cannot be saved yet, or null. */
export function routeEndProblem(value: RouteEndValue, label: string): string | null {
  if (value.kind === 'facility') {
    return value.facilityId === '' ? `Choose the location the freight ${label}.` : null;
  }
  if (value.text.trim() === '') return `Type the town or area the freight ${label}.`;
  if (value.region === '') return `Choose the province or state the freight ${label}.`;
  return null;
}

/** The end as the API takes it: a point only when found and accepted. */
export function routeEndRequest(value: RouteEndValue): FreightEndInput {
  if (value.kind === 'facility') return { facilityId: value.facilityId };
  const match = value.found?.status === 'found' && value.accepted ? value.found.match : undefined;
  return {
    area: { text: value.text.trim(), region: value.region, ...(match && { match }) },
  };
}

const REGION_OPTIONS = LANE_REGIONS.map((code) => ({
  value: code,
  label: `${laneRegionName(code)} (${code.slice(3)})`,
}));

function SavedLocation({
  baseId,
  label,
  hint,
  token,
  choices,
  loading,
  value,
  onChange,
}: {
  baseId: string;
  label: string;
  hint: string;
  token: string;
  choices: CounterpartySummary[];
  loading: boolean;
  value: Extract<RouteEndValue, { kind: 'facility' }>;
  onChange: (next: RouteEndValue) => void;
}) {
  const chosen = choices.find((item) => item.id === value.counterpartyId);
  const [detail] = useApiResource<CounterpartyDetail>(
    chosen ? `/counterparties/${chosen.id}` : null,
    token,
  );
  const facilities = chosen && detail.status === 'ok' ? detail.data.facilities : [];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field
        id={`${baseId}-counterparty`}
        label={`${label}: company`}
        required
        error={undefined}
        hint={hint}
      >
        <SearchSelect
          id={`${baseId}-counterparty`}
          value={chosen ? value.counterpartyId : ''}
          onValueChange={(next) => {
            onChange({ kind: 'facility', counterpartyId: next, facilityId: '' });
          }}
          placeholder={loading ? 'Loading…' : 'Choose…'}
          options={counterpartyOptions(choices)}
        />
      </Field>
      <Field id={`${baseId}-location`} label={`${label}: location`} required error={undefined}>
        <Select
          id={`${baseId}-location`}
          value={value.facilityId}
          disabled={chosen === undefined}
          onValueChange={(next) => {
            onChange({ ...value, facilityId: next });
          }}
          options={facilities.map((facility) => ({
            value: facility.id,
            label: [freightPlace(facility), facility.addressLine]
              .filter((part) => part !== null && part !== '')
              .join(' · '),
          }))}
        />
      </Field>
    </div>
  );
}

function Area({
  baseId,
  label,
  token,
  organizationId,
  value,
  onChange,
}: {
  baseId: string;
  label: string;
  token: string;
  organizationId: string;
  value: Extract<RouteEndValue, { kind: 'area' }>;
  onChange: (next: RouteEndValue) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const found = value.found;
  // The end as it now is, and whether it is still shown: an answer that comes back after the
  // town or province changed, or after Saved location was chosen, is left out (Codex
  // F-235-1-R1-01), so it never replaces what the person typed since.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  const shown = useRef(true);
  useEffect(() => {
    shown.current = true;
    return () => {
      shown.current = false;
    };
  }, []);

  async function find() {
    const asked = { text: value.text, region: value.region };
    const stillAsked = () =>
      shown.current && latest.current.text === asked.text && latest.current.region === asked.region;
    setBusy(true);
    setError(null);
    try {
      const answer = await sendJson<FreightPlaceAnswer>('/freight-quotes/places', token, 'POST', {
        organizationId,
        ...asked,
      });
      if (!stillAsked()) return;
      onChange({
        ...latest.current,
        found: answer,
        accepted: answer.status === 'found' && answer.sure,
      });
    } catch (caught) {
      if (!stillAsked()) return;
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'The map lookup failed. The rate can still be saved with its province or state.',
      );
    } finally {
      if (shown.current) setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          id={`${baseId}-area`}
          label={`${label}: town or area`}
          required
          error={undefined}
          hint="As the company wrote it, e.g. “Morris, MB”."
        >
          <Input
            id={`${baseId}-area`}
            value={value.text}
            maxLength={200}
            onChange={(event) => {
              const text = event.target.value;
              // The province or state is read from the text's end until the person picks one.
              const read = value.regionChosen ? null : regionFromAreaText(text);
              onChange({
                ...value,
                text,
                region: read ?? value.region,
                found: null,
                accepted: false,
              });
            }}
          />
        </Field>
        <Field
          id={`${baseId}-region`}
          label={`${label}: province or state`}
          required
          error={undefined}
        >
          <Select
            id={`${baseId}-region`}
            value={value.region}
            onValueChange={(region) => {
              onChange({ ...value, region, found: null, accepted: false, regionChosen: true });
            }}
            options={REGION_OPTIONS}
          />
        </Field>
      </div>
      <div className="flex flex-col gap-2 text-sm">
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || value.text.trim() === '' || value.region === ''}
            onClick={() => {
              void find();
            }}
          >
            <MapPin aria-hidden="true" />
            {busy ? 'Finding…' : 'Find on the map'}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        {found?.status === 'not_found' && (
          <p role="status" className="text-muted-foreground">
            Not found in {laneRegionName(value.region)}. The rate is saved with its province or
            state, not drawn as a point on the map.
          </p>
        )}
        {found?.status === 'found' && (
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              checked={value.accepted}
              onChange={(event) => {
                onChange({ ...value, accepted: event.target.checked });
              }}
            />
            <span>
              That’s the place: {found.formattedAddress} ({found.match.precision})
              {!found.sure && (
                <span className="block text-muted-foreground">
                  Not a sure match: tick it only if it is the right town.
                </span>
              )}
            </span>
          </label>
        )}
      </div>
    </div>
  );
}

/** One end of a freight route: a saved location, or a town or area (F-235). */
export function FreightRouteEnd({
  label,
  verb,
  hint,
  token,
  organizationId,
  choices,
  loading,
  value,
  onChange,
}: {
  label: string;
  /** "leaves from" or "goes to", for the hints. */
  verb: string;
  hint: string;
  token: string;
  organizationId: string;
  /** Companies with a saved location, not archived. */
  choices: CounterpartySummary[];
  loading: boolean;
  value: RouteEndValue;
  onChange: (next: RouteEndValue) => void;
}) {
  const baseId = useId();
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-semibold">{label}</legend>
      <SegmentedControl
        label={`${label}: where the freight ${verb}`}
        options={[
          { value: 'area', label: 'Town or area' },
          { value: 'facility', label: 'Saved location' },
        ]}
        value={value.kind}
        onChange={(kind) => {
          if (kind !== value.kind) onChange(kind === 'area' ? EMPTY_AREA : EMPTY_FACILITY);
        }}
      />
      {value.kind === 'facility' ? (
        <SavedLocation
          baseId={baseId}
          label={label}
          hint={hint}
          token={token}
          choices={choices}
          loading={loading}
          value={value}
          onChange={onChange}
        />
      ) : (
        <Area
          baseId={baseId}
          label={label}
          token={token}
          organizationId={organizationId}
          value={value}
          onChange={onChange}
        />
      )}
    </fieldset>
  );
}
