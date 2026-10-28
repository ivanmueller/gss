import {
  COUNTERPARTY_TYPES,
  COUNTRY_NAMES,
  FACILITY_TYPE_LABELS,
  normalizeCountry,
  REGIONS,
  SUPPORTED_COUNTRIES,
  type FieldIssue,
  type ImportFieldId,
} from '@grain/domain';
import { useId, type ReactNode } from 'react';

import { typeLabel } from '../lib/directory';
import { cn } from '../lib/utils';
import { Input, Select, Textarea } from './ui/input';

// The fields of the counterparty, contact and location forms. Their names are the import's
// field ids, so a form is checked by the same rules (and gives the same messages) as a
// spreadsheet row (packages/domain/src/directory.ts).

export type FormValues = Partial<Record<ImportFieldId, string>>;

export interface FieldsProps {
  values: FormValues;
  issues: readonly FieldIssue[];
  onChange: (changes: FormValues) => void;
  disabled?: boolean;
}

/** A field problem as a sentence, e.g. "Legal name is required." */
export function issueText(label: string, message: string): string {
  const sentence = /^(is|needs|must)\b/.test(message) ? `${label} ${message}` : message;
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

function Field({
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
function controlProps(id: string, error: string | undefined) {
  return {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : undefined,
  };
}

function useFieldHelpers({ values, issues, onChange }: FieldsProps) {
  const baseId = useId();
  return {
    id: (field: ImportFieldId) => `${baseId}-${field}`,
    value: (field: ImportFieldId) => values[field] ?? '',
    error: (field: ImportFieldId, label: string) => {
      const issue = issues.find((item) => item.field === field);
      return issue && issueText(label, issue.message);
    },
    set: (field: ImportFieldId) => (event: { target: { value: string } }) => {
      onChange({ [field]: event.target.value });
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
  autoComplete = 'off',
  className,
}: {
  field: ImportFieldId;
  label: string;
  props: FieldsProps;
  required?: boolean | undefined;
  hint?: ReactNode;
  type?: 'text' | 'email' | 'tel';
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
        autoComplete={autoComplete}
        value={f.value(field)}
        onChange={f.set(field)}
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
        onChange={f.set(field)}
        disabled={props.disabled}
        required={required}
      >
        <option value="">Choose…</option>
        {SUPPORTED_COUNTRIES.map((code) => (
          <option key={code} value={code}>
            {COUNTRY_NAMES[code]}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** A counterparty's own details: names, buyer/seller, country, verification and notes. */
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

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <TextField field="legalName" label="Legal name" props={props} required />
      <TextField field="tradingName" label="Trading name" props={props} />
      <fieldset
        className="flex flex-col gap-1.5"
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
      <CountrySelect field="country" label="Country" props={props} required />
      <Field id={f.id('verificationStatus')} label="Verification" error={statusError}>
        <Select
          {...controlProps(f.id('verificationStatus'), statusError)}
          value={
            f.value('verificationStatus') === '' ? 'unverified' : f.value('verificationStatus')
          }
          onChange={f.set('verificationStatus')}
          disabled={props.disabled}
        >
          <option value="unverified">Unverified</option>
          <option value="pending">Verification pending</option>
          <option value="verified">Verified</option>
        </Select>
      </Field>
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

/** One location: what and where it is, and optionally its coordinates. */
export function LocationFields(props: FieldsProps) {
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
          onChange={f.set('facilityType')}
          disabled={props.disabled}
        >
          <option value="">Not given</option>
          {Object.entries(FACILITY_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <TextField field="addressLine" label="Address" props={props} className="sm:col-span-2" />
      <TextField field="city" label="City or town" props={props} />
      <CountrySelect field="facilityCountry" label="Country" props={props} />
      <Field id={f.id('region')} label={regionLabel} error={regionError}>
        <Select
          {...controlProps(f.id('region'), regionError)}
          value={f.value('region')}
          onChange={f.set('region')}
          disabled={props.disabled}
        >
          <option value="">Not given</option>
          {regions.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </Select>
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
            : 'Enter coordinates first, or leave them empty and use Find coordinates later.'
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
          onChange={f.set('locationPrecision')}
          disabled={props.disabled === true || !hasCoordinates}
        >
          {!hasCoordinates && <option value="">No coordinates</option>}
          <option value="approximate">Approximate</option>
          <option value="exact">Exact</option>
        </Select>
      </Field>
    </div>
  );
}
