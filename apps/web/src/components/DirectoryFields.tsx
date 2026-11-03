import {
  COUNTERPARTY_TYPES,
  COUNTRY_NAMES,
  EQUIPMENT,
  EQUIPMENT_LABELS,
  FACILITY_TYPE_LABELS,
  GRAIN_TYPE_LABELS,
  GRAIN_TYPES,
  normalizeCountry,
  formatPhone,
  MARKET_LABELS,
  MARKETS,
  REGIONS,
  SELLER_KIND_LABELS,
  SUPPORTED_COUNTRIES,
  TIERS,
  TRANSPORT_ACCESS_LABELS,
  type Equipment,
  type FieldIssue,
  type ImportFieldId,
} from '@grain/domain';
import { useId, type ReactNode } from 'react';

import { typeLabel } from '../lib/directory';
import { cn } from '../lib/utils';
import { Input, Textarea } from './ui/input';
import { Select } from './ui/select';

// The fields of the counterparty, contact and location forms. Their names are the import's
// field ids, so a form is checked by the same rules (and gives the same messages) as a
// spreadsheet row (packages/domain/src/directory.ts).

/**
 * A form's values by field. transportAccess is a location's rail or truck access: no
 * spreadsheet column fills it (owner's answer, 2026-10-30), so it is sent beside the values
 * (splitAccess) rather than among them.
 */
/** Form values; a location's access and a carrier's equipment are sent beside the fields. */
export type FormValues = Partial<Record<ImportFieldId | 'transportAccess' | 'equipment', string>>;

/** The values to send, and the location's access beside them ('' is not known: null). */
export function splitAccess({ transportAccess, ...values }: FormValues): {
  values: Partial<Record<ImportFieldId, string>>;
  transportAccess: string | null;
} {
  return {
    values,
    transportAccess:
      transportAccess === undefined || transportAccess === '' ? null : transportAccess,
  };
}

export interface FieldsProps {
  values: FormValues;
  issues: readonly FieldIssue[];
  onChange: (changes: FormValues) => void;
  disabled?: boolean;
}

/** A field problem as a sentence, e.g. "Legal name is required." */
export function issueText(label: string, message: string): string {
  const sentence = /^(is|are|needs|must)\b/.test(message) ? `${label} ${message}` : message;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/** Problems that belong to no one field, shown above the form. */
export function FormIssues({ issues }: { issues: readonly FieldIssue[] }) {
  const general = issues.filter((issue) => issue.field === null);
  if (general.length === 0) return null;
  return (
    <ul role="alert" className="flex flex-col gap-1 text-sm text-danger">
      {general.map((issue) => (
        <li key={issue.message}>{issue.message}</li>
      ))}
    </ul>
  );
}

export function Field({
  id,
  label,
  required,
  error,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  required?: boolean | undefined;
  error: string | undefined;
  hint?: ReactNode;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required && <span className="font-normal text-muted-foreground"> (required)</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** The props that connect a control to its label and its error. */
export function controlProps(id: string, error: string | undefined) {
  return {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : undefined,
  };
}

function useFieldHelpers({ values, issues, onChange }: FieldsProps) {
  const baseId = useId();
  return {
    id: (field: ImportFieldId | 'transportAccess') => `${baseId}-${field}`,
    value: (field: ImportFieldId | 'transportAccess') => values[field] ?? '',
    error: (field: ImportFieldId, label: string) => {
      const issue = issues.find((item) => item.field === field);
      return issue && issueText(label, issue.message);
    },
    set: (field: ImportFieldId) => (event: { target: { value: string } }) => {
      onChange({ [field]: event.target.value });
    },
    choose: (field: ImportFieldId | 'transportAccess') => (value: string) => {
      onChange({ [field]: value });
    },
  };
}

function TextField({
  field,
  label,
  props,
  required,
  hint,
  type = 'text',
  inputMode,
  autoComplete = 'off',
  className,
}: {
  field: ImportFieldId;
  label: string;
  props: FieldsProps;
  required?: boolean | undefined;
  hint?: ReactNode;
  type?: 'text' | 'email' | 'tel' | 'date';
  inputMode?: 'url' | 'numeric';
  autoComplete?: string;
  className?: string | undefined;
}) {
  const f = useFieldHelpers(props);
  const error = f.error(field, label);
  return (
    <Field
      id={f.id(field)}
      label={label}
      required={required}
      error={error}
      hint={hint}
      className={className}
    >
      <Input
        {...controlProps(f.id(field), error)}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        value={f.value(field)}
        onChange={f.set(field)}
        // A phone takes its saved form, (403) 555-0100, once the person leaves the box (owner's
        // choice, 2026-10-31); the server formats it the same way.
        onBlur={
          type === 'tel'
            ? (event) => {
                const formatted = formatPhone(event.target.value);
                if (formatted !== event.target.value) props.onChange({ [field]: formatted });
              }
            : undefined
        }
        disabled={props.disabled}
        required={required}
      />
    </Field>
  );
}

function CountrySelect({
  field,
  label,
  props,
  required,
}: {
  field: 'country' | 'facilityCountry';
  label: string;
  props: FieldsProps;
  required?: boolean | undefined;
}) {
  const f = useFieldHelpers(props);
  const error = f.error(field, label);
  return (
    <Field id={f.id(field)} label={label} required={required} error={error}>
      <Select
        {...controlProps(f.id(field), error)}
        value={f.value(field)}
        onValueChange={f.choose(field)}
        disabled={props.disabled}
        options={SUPPORTED_COUNTRIES.map((code) => ({ value: code, label: COUNTRY_NAMES[code] }))}
      />
    </Field>
  );
}

/** Checkboxes for a list kept as "a,b" in one field, in the list's order. */
function ChoiceList<T extends string>({
  field,
  legend,
  choices,
  labels,
  props,
}: {
  field: 'markets' | 'grainTypes';
  legend: string;
  choices: readonly T[];
  labels: Record<T, string>;
  props: FieldsProps;
}) {
  const f = useFieldHelpers(props);
  const chosen = new Set(f.value(field).split(',').filter(Boolean));
  const error = f.error(field, legend);
  return (
    <fieldset
      className="flex flex-col gap-1.5 sm:col-span-2"
      aria-describedby={error ? `${f.id(field)}-error` : undefined}
    >
      <legend className="text-sm font-medium">
        {legend} <span className="font-normal text-muted-foreground">(any that apply)</span>
      </legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
        {choices.map((choice) => (
          <label key={choice} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={chosen.has(choice)}
              disabled={props.disabled}
              onChange={(event) => {
                const next = new Set(chosen);
                if (event.target.checked) next.add(choice);
                else next.delete(choice);
                props.onChange({ [field]: choices.filter((item) => next.has(item)).join(',') });
              }}
            />
            {labels[choice]}
          </label>
        ))}
      </div>
      {error && (
        <p id={`${f.id(field)}-error`} className="text-xs text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/**
 * A seller's own details (owner's request and answers, 2026-11-03): its grain types instead
 * of a buyer's market, what kind of seller it is, about how much it sells a year, and, when
 * it sells organic grain, who certified it and until when.
 */
function SellerFields(props: FieldsProps) {
  const f = useFieldHelpers(props);
  const kindError = f.error('sellerKind', 'Seller kind');
  const organic = f.value('grainTypes').split(',').includes('organic');
  return (
    <>
      <ChoiceList
        field="grainTypes"
        legend="Grain type"
        choices={GRAIN_TYPES}
        labels={GRAIN_TYPE_LABELS}
        props={props}
      />
      <Field id={f.id('sellerKind')} label="Seller kind" error={kindError}>
        <Select
          {...controlProps(f.id('sellerKind'), kindError)}
          value={f.value('sellerKind')}
          onValueChange={f.choose('sellerKind')}
          disabled={props.disabled}
          options={[
            { value: '', label: 'Not given' },
            ...Object.entries(SELLER_KIND_LABELS).map(([value, label]) => ({ value, label })),
          ]}
        />
      </Field>
      <TextField
        field="annualTonnes"
        label="Tonnes a year"
        props={props}
        inputMode="numeric"
        hint="About how much they sell in a year, e.g. 5000."
      />
      {organic && (
        <>
          <TextField field="organicCertifier" label="Organic certifier" props={props} />
          <TextField
            field="organicCertifiedUntil"
            label="Organic certified until"
            type="date"
            props={props}
            hint="The certificate's last day."
          />
        </>
      )}
    </>
  );
}

/**
 * A counterparty's own details: its types, its name, a buyer's markets, a seller's details,
 * the tier, country, verification, website, the company phone and notes.
 */
export function CompanyFields(props: FieldsProps) {
  const f = useFieldHelpers(props);
  const chosen = new Set(
    f
      .value('types')
      .split(',')
      .map((type) => type.trim())
      .filter(Boolean),
  );
  const typesError = f.error('types', 'Type');
  const typesId = f.id('types');
  const notesError = f.error('notes', 'Notes');
  const statusError = f.error('verificationStatus', 'Verification');

  // Market describes whom a buyer serves (pet, bird, …), so it is asked for a buyer or broker;
  // a seller has its grain types and other details instead (owner's request, 2026-11-03). The
  // tier is for buyers and sellers, not carriers (owner's answer, 2026-11-01). What is not
  // asked keeps its saved value.
  const carrierOnly = chosen.size > 0 && [...chosen].every((type) => type === 'carrier');
  const buyerSide = chosen.has('buyer') || chosen.has('broker');
  const seller = chosen.has('seller');
  const tierError = f.error('tier', 'Tier');

  // Type first, then the name, then markets and tier (owner's request, 2026-10-30). The
  // trading name is no longer asked for; one already saved stays in the values and is kept.
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <fieldset
        className="flex flex-col gap-1.5 sm:col-span-2"
        aria-describedby={typesError ? `${typesId}-error` : undefined}
      >
        <legend className="text-sm font-medium">
          Type <span className="font-normal text-muted-foreground">(required)</span>
        </legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
          {COUNTERPARTY_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={chosen.has(type)}
                disabled={props.disabled}
                onChange={(event) => {
                  const next = new Set(chosen);
                  if (event.target.checked) next.add(type);
                  else next.delete(type);
                  // Kept in a fixed order: buyer, seller, broker, carrier.
                  props.onChange({
                    types: COUNTERPARTY_TYPES.filter((item) => next.has(item)).join(','),
                  });
                }}
              />
              {typeLabel(type)}
            </label>
          ))}
        </div>
        {typesError && (
          <p id={`${typesId}-error`} className="text-xs text-danger">
            {typesError}
          </p>
        )}
      </fieldset>
      <TextField
        field="legalName"
        label="Legal name"
        props={props}
        required
        className="sm:col-span-2"
      />
      {(buyerSide || chosen.size === 0) && (
        <ChoiceList
          field="markets"
          legend="Market"
          choices={MARKETS}
          labels={MARKET_LABELS}
          props={props}
        />
      )}
      {seller && <SellerFields {...props} />}
      {!carrierOnly && (
        <>
          <Field id={f.id('tier')} label="Tier" error={tierError}>
            <Select
              {...controlProps(f.id('tier'), tierError)}
              value={f.value('tier')}
              onValueChange={f.choose('tier')}
              disabled={props.disabled}
              options={[
                { value: '', label: 'No tier' },
                ...TIERS.map((tier) => ({ value: tier, label: `Tier ${tier}` })),
              ]}
            />
          </Field>
        </>
      )}
      <CountrySelect field="country" label="Country" props={props} required />
      <Field id={f.id('verificationStatus')} label="Verification" error={statusError}>
        <Select
          {...controlProps(f.id('verificationStatus'), statusError)}
          value={
            f.value('verificationStatus') === '' ? 'unverified' : f.value('verificationStatus')
          }
          onValueChange={f.choose('verificationStatus')}
          disabled={props.disabled}
          options={[
            { value: 'unverified', label: 'Unverified' },
            { value: 'pending', label: 'Verification pending' },
            { value: 'verified', label: 'Verified' },
          ]}
        />
      </Field>
      {/* Text rather than type="url", which would refuse "example.com" before the check does. */}
      <TextField
        field="website"
        label="Website"
        props={props}
        inputMode="url"
        hint="For example example.com."
      />
      <TextField
        field="companyPhone"
        label="Company phone"
        type="tel"
        props={props}
        hint="The company's main number. A person's own number goes with their contact."
      />
      <Field id={f.id('notes')} label="Notes" error={notesError} className="sm:col-span-2">
        <Textarea
          {...controlProps(f.id('notes'), notesError)}
          rows={3}
          value={f.value('notes')}
          onChange={f.set('notes')}
          disabled={props.disabled}
        />
      </Field>
    </div>
  );
}

/** One contact person. */
export function ContactFields(props: FieldsProps & { required?: boolean | undefined }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <TextField field="contactName" label="Name" props={props} required={props.required} />
      <TextField field="contactRole" label="Job title" props={props} />
      <TextField field="contactEmail" label="Email" type="email" autoComplete="off" props={props} />
      <TextField field="contactPhone" label="Phone" type="tel" autoComplete="off" props={props} />
    </div>
  );
}

/**
 * One location: what and where it is, whether rail or trucks serve it (for a buyer's or
 * seller's location, `access`), and optionally its coordinates.
 */
export function LocationFields({ access = false, ...props }: FieldsProps & { access?: boolean }) {
  const f = useFieldHelpers(props);
  const country = normalizeCountry(f.value('facilityCountry')) ?? 'CA';
  const regions = Object.entries(REGIONS[country]);
  const typeError = f.error('facilityType', 'Location type');
  const regionLabel = country === 'CA' ? 'Province or territory' : 'State';
  const regionError = f.error('region', regionLabel);
  const precisionError = f.error('locationPrecision', 'Precision');
  const hasCoordinates = f.value('latitude').trim() !== '' || f.value('longitude').trim() !== '';

  // Without coordinates there is no precision, so clearing both clears it too.
  const coordinatesProps: FieldsProps = {
    ...props,
    onChange: (changes) => {
      const next = { ...props.values, ...changes };
      const empty = !next.latitude?.trim() && !next.longitude?.trim();
      props.onChange(empty ? { ...changes, locationPrecision: '' } : changes);
    },
  };

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <TextField
        field="facilityName"
        label="Location name"
        props={props}
        hint="For example the elevator's or plant's name."
      />
      <Field id={f.id('facilityType')} label="Location type" error={typeError}>
        <Select
          {...controlProps(f.id('facilityType'), typeError)}
          value={f.value('facilityType')}
          onValueChange={f.choose('facilityType')}
          disabled={props.disabled}
          options={[
            { value: '', label: 'Not given' },
            ...Object.entries(FACILITY_TYPE_LABELS).map(([value, label]) => ({ value, label })),
          ]}
        />
      </Field>
      {access && (
        <Field
          id={f.id('transportAccess')}
          label="Served by"
          error={undefined}
          hint="Whether grain moves in and out by rail, by truck or both."
        >
          <Select
            id={f.id('transportAccess')}
            value={f.value('transportAccess')}
            onValueChange={f.choose('transportAccess')}
            disabled={props.disabled}
            options={[
              { value: '', label: 'Not known' },
              ...Object.entries(TRANSPORT_ACCESS_LABELS).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
          />
        </Field>
      )}
      <TextField field="addressLine" label="Address" props={props} className="sm:col-span-2" />
      <TextField field="city" label="City or town" props={props} />
      <CountrySelect field="facilityCountry" label="Country" props={props} />
      <Field id={f.id('region')} label={regionLabel} error={regionError}>
        <Select
          {...controlProps(f.id('region'), regionError)}
          value={f.value('region')}
          onValueChange={f.choose('region')}
          disabled={props.disabled}
          options={[
            { value: '', label: 'Not given' },
            ...regions.map(([code, name]) => ({ value: code, label: name })),
          ]}
        />
      </Field>
      <TextField
        field="postalCode"
        label={country === 'CA' ? 'Postal code' : 'ZIP code'}
        props={props}
      />
      <TextField
        field="latitude"
        label="Latitude"
        props={coordinatesProps}
        hint="Optional. Decimal degrees, e.g. 52.133214."
      />
      <TextField
        field="longitude"
        label="Longitude"
        props={coordinatesProps}
        hint="Optional. West is negative, e.g. -106.670046."
      />
      <Field
        id={f.id('locationPrecision')}
        label="Precision"
        error={precisionError}
        hint={
          hasCoordinates
            ? 'Exact: the site itself. Approximate: for example the town.'
            : 'Leave them empty to have them found from the address when you save.'
        }
      >
        <Select
          {...controlProps(f.id('locationPrecision'), precisionError)}
          value={
            f.value('locationPrecision') === ''
              ? hasCoordinates
                ? 'approximate'
                : ''
              : f.value('locationPrecision')
          }
          onValueChange={f.choose('locationPrecision')}
          disabled={props.disabled === true || !hasCoordinates}
          options={[
            ...(hasCoordinates ? [] : [{ value: '', label: 'No coordinates' }]),
            { value: 'approximate', label: 'Approximate' },
            { value: 'exact', label: 'Exact' },
          ]}
        />
      </Field>
    </div>
  );
}

/** "super_b,van" from the form → ['super_b', 'van'], in EQUIPMENT order. */
export function equipmentOf(value: string | undefined): Equipment[] {
  const chosen = new Set((value ?? '').split(','));
  return EQUIPMENT.filter((item) => chosen.has(item));
}

/** What a carrier hauls with, as checkboxes under Edit details. */
export function EquipmentFields({ props }: { props: FieldsProps }) {
  const chosen = new Set(equipmentOf(props.values.equipment));
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-sm font-medium">
        Equipment <span className="font-normal text-muted-foreground">(any that apply)</span>
      </legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
        {EQUIPMENT.map((item) => (
          <label key={item} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={chosen.has(item)}
              disabled={props.disabled}
              onChange={(event) => {
                const next = new Set(chosen);
                if (event.target.checked) next.add(item);
                else next.delete(item);
                props.onChange({
                  equipment: EQUIPMENT.filter((other) => next.has(other)).join(','),
                });
              }}
            />
            {EQUIPMENT_LABELS[item]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
