import {
  ENTRY_SOURCES,
  FREIGHT_RATE_UNIT_LABELS,
  FREIGHT_RATE_UNITS,
  PAYLOAD_UNIT_LABELS,
  PAYLOAD_UNITS,
  QUOTE_CURRENCIES,
  QUOTE_FIRMNESS,
  QUOTE_SOURCE_LABELS,
  QUOTE_STATUS_LABELS,
  type FreightFieldId,
  type FreightFormValues,
  type FreightIssue,
} from '@grain/domain';
import { useId, type ReactNode } from 'react';

import { controlProps, Field, issueText } from './DirectoryFields';
import { Input, Textarea } from './ui/input';
import { Select } from './ui/select';

export interface FreightFieldsProps {
  values: FreightFormValues;
  issues: readonly FreightIssue[];
  onChange: (changes: FreightFormValues) => void;
  disabled?: boolean;
}

const LABELS: Record<FreightFieldId, string> = {
  firmness: 'Firm or indicative',
  rate: 'Rate',
  currency: 'Currency',
  rateUnit: 'Unit',
  payload: 'Payload of one load',
  payloadUnit: 'Payload unit',
  inclusions: 'What the rate includes',
  quotedAt: 'Quoted at',
  validUntil: 'Valid until',
  sourceType: 'Source',
  sourceReference: 'Source details',
  notes: 'Notes',
};

const OPTIONS: Partial<Record<FreightFieldId, readonly (readonly [string, string])[]>> = {
  firmness: QUOTE_FIRMNESS.map((value) => [value, QUOTE_STATUS_LABELS[value]] as const),
  currency: QUOTE_CURRENCIES.map((value) => [value, value] as const),
  rateUnit: FREIGHT_RATE_UNITS.map((value) => [value, FREIGHT_RATE_UNIT_LABELS[value]] as const),
  payloadUnit: PAYLOAD_UNITS.map((value) => [value, PAYLOAD_UNIT_LABELS[value]] as const),
  sourceType: ENTRY_SOURCES.map((value) => [value, QUOTE_SOURCE_LABELS[value]] as const),
};

const REQUIRED = new Set<FreightFieldId>([
  'firmness',
  'rate',
  'currency',
  'rateUnit',
  'payload',
  'payloadUnit',
  'validUntil',
  'sourceType',
]);

const HINTS: Partial<Record<FreightFieldId, ReactNode>> = {
  firmness: 'Firm only when the carrier committed to it.',
  rate: 'As the carrier quoted it, e.g. 105.00.',
  rateUnit: 'The unit the carrier quoted in.',
  payload: 'The contract payload the carrier stated, so the rate can be worked out per tonne.',
  inclusions: 'E.g. fuel surcharge included, border crossing extra.',
  quotedAt: 'Your local time. Leave empty for now.',
  validUntil: 'Your local time. Times are shown elsewhere in UTC.',
  sourceReference: 'E.g. who you spoke to, or a reference number.',
};

const KIND: Partial<Record<FreightFieldId, 'datetime-local' | 'decimal' | 'notes'>> = {
  rate: 'decimal',
  payload: 'decimal',
  quotedAt: 'datetime-local',
  validUntil: 'datetime-local',
  notes: 'notes',
};

function FreightField({
  field,
  props,
  className,
}: {
  field: FreightFieldId;
  props: FreightFieldsProps;
  className?: string;
}) {
  const baseId = useId();
  const id = `${baseId}-${field}`;
  const label = LABELS[field];
  const issue = props.issues.find((item) => item.field === field);
  const error = issue && issueText(label, issue.message);
  const value = props.values[field] ?? '';
  const onChange = (event: { target: { value: string } }) => {
    props.onChange({ [field]: event.target.value });
  };
  const options = OPTIONS[field];
  const kind = KIND[field];
  const common = { ...controlProps(id, error), value, onChange, disabled: props.disabled };
  return (
    <Field
      id={id}
      label={label}
      required={REQUIRED.has(field)}
      error={error}
      hint={HINTS[field]}
      className={className}
    >
      {options ? (
        <Select
          {...controlProps(id, error)}
          value={value}
          onValueChange={(next) => {
            props.onChange({ [field]: next });
          }}
          disabled={props.disabled}
          options={options.map(([option, text]) => ({ value: option, label: text }))}
        />
      ) : kind === 'notes' ? (
        <Textarea {...common} maxLength={2000} />
      ) : (
        <Input
          {...common}
          type={kind === 'datetime-local' ? kind : 'text'}
          inputMode={kind === 'decimal' ? 'decimal' : undefined}
          autoComplete="off"
          maxLength={kind === undefined ? 200 : undefined}
        />
      )}
    </Field>
  );
}

/** A group of fields under a small heading. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-semibold">{title}</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </fieldset>
  );
}

/**
 * The terms of a freight rate: what a revision records (packages/domain/src/freight.ts). The
 * payload fields appear only for a rate per load, the one unit that needs them.
 */
export function FreightFields(props: FreightFieldsProps) {
  const perLoad = props.values.rateUnit === 'LOAD';
  return (
    <div className="flex flex-col gap-6">
      <Group title="Rate">
        <FreightField field="rate" props={props} />
        <FreightField field="currency" props={props} />
        <FreightField field="rateUnit" props={props} />
        {perLoad && (
          <>
            <FreightField field="payload" props={props} />
            <FreightField field="payloadUnit" props={props} />
          </>
        )}
        <FreightField field="firmness" props={props} />
        <FreightField field="inclusions" props={props} className="sm:col-span-2" />
      </Group>
      <Group title="When and where it came from">
        <FreightField field="quotedAt" props={props} />
        <FreightField field="validUntil" props={props} />
        <FreightField field="sourceType" props={props} />
        <FreightField field="sourceReference" props={props} className="sm:col-span-2" />
        <FreightField field="notes" props={props} className="sm:col-span-2 lg:col-span-3" />
      </Group>
    </div>
  );
}
