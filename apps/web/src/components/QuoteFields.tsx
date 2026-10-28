import {
  DELIVERY_BASES,
  DELIVERY_BASIS_LABELS,
  ENTRY_SOURCES,
  PRICE_UNIT_LABELS,
  PRICE_UNITS,
  QUOTE_CURRENCIES,
  QUOTE_FIRMNESS,
  QUOTE_SOURCE_LABELS,
  QUOTE_STATUS_LABELS,
  type QuoteFieldId,
  type QuoteFormValues,
  type QuoteIssue,
  type QuoteSide,
} from '@grain/domain';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { controlProps, Field, issueText } from './DirectoryFields';
import { Badge } from './ui/badge';
import { Input, Select, Textarea } from './ui/input';

/** "Bid" or "Offer" in words with an icon, in the buyer's green or the seller's coral. */
export function QuoteSideBadge({ side }: { side: QuoteSide }) {
  return side === 'bid' ? (
    <Badge variant="bid">
      <ArrowDownLeft aria-hidden="true" />
      Bid
    </Badge>
  ) : (
    <Badge variant="offer">
      <ArrowUpRight aria-hidden="true" />
      Offer
    </Badge>
  );
}

export interface QuoteFieldsProps {
  values: QuoteFormValues;
  issues: readonly QuoteIssue[];
  onChange: (changes: QuoteFormValues) => void;
  disabled?: boolean;
}

const LABELS: Record<QuoteFieldId, string> = {
  firmness: 'Firm or indicative',
  price: 'Price',
  currency: 'Currency',
  priceUnit: 'Unit',
  grade: 'Grade or quality',
  deliveryBasis: 'Delivery basis',
  basisLocation: 'Basis location',
  quantityMin: 'Minimum quantity (MT)',
  quantityMax: 'Available quantity (MT)',
  deliveryStart: 'Delivery from',
  deliveryEnd: 'Delivery to',
  quotedAt: 'Quoted at',
  validUntil: 'Valid until',
  sourceType: 'Source',
  sourceReference: 'Source details',
  notes: 'Notes',
};

const OPTIONS: Partial<Record<QuoteFieldId, readonly (readonly [string, string])[]>> = {
  firmness: QUOTE_FIRMNESS.map((value) => [value, QUOTE_STATUS_LABELS[value]] as const),
  currency: QUOTE_CURRENCIES.map((value) => [value, value] as const),
  priceUnit: PRICE_UNITS.map((value) => [value, PRICE_UNIT_LABELS[value]] as const),
  deliveryBasis: DELIVERY_BASES.map((value) => [value, DELIVERY_BASIS_LABELS[value]] as const),
  sourceType: ENTRY_SOURCES.map((value) => [value, QUOTE_SOURCE_LABELS[value]] as const),
};

const REQUIRED = new Set<QuoteFieldId>([
  'firmness',
  'price',
  'currency',
  'priceUnit',
  'deliveryBasis',
  'quantityMax',
  'validUntil',
  'sourceType',
]);

const HINTS: Partial<Record<QuoteFieldId, ReactNode>> = {
  firmness: 'Firm only when the counterparty committed to it.',
  price: 'As quoted, e.g. 725.00.',
  grade: 'E.g. No. 1 CW, or the specification quoted.',
  basisLocation: 'Where the basis applies, e.g. the delivery point.',
  quantityMin: 'Leave empty for no minimum.',
  quotedAt: 'Your local time. Leave empty for now.',
  validUntil: 'Your local time. Times are shown elsewhere in UTC.',
  sourceReference: 'E.g. who you spoke to, or a reference number.',
};

const KIND: Partial<Record<QuoteFieldId, 'datetime-local' | 'date' | 'decimal' | 'notes'>> = {
  price: 'decimal',
  quantityMin: 'decimal',
  quantityMax: 'decimal',
  deliveryStart: 'date',
  deliveryEnd: 'date',
  quotedAt: 'datetime-local',
  validUntil: 'datetime-local',
  notes: 'notes',
};

function QuoteField({
  field,
  props,
  className,
}: {
  field: QuoteFieldId;
  props: QuoteFieldsProps;
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
        <Select {...common}>
          <option value="">Choose…</option>
          {options.map(([option, text]) => (
            <option key={option} value={option}>
              {text}
            </option>
          ))}
        </Select>
      ) : kind === 'notes' ? (
        <Textarea {...common} maxLength={2000} />
      ) : (
        <Input
          {...common}
          type={kind === 'datetime-local' || kind === 'date' ? kind : 'text'}
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

/** The terms of a bid or offer: what a revision records (packages/domain/src/quotes.ts). */
export function QuoteFields(props: QuoteFieldsProps) {
  return (
    <div className="flex flex-col gap-6">
      <Group title="Price and quality">
        <QuoteField field="price" props={props} />
        <QuoteField field="currency" props={props} />
        <QuoteField field="priceUnit" props={props} />
        <QuoteField field="firmness" props={props} />
        <QuoteField field="grade" props={props} className="sm:col-span-2" />
      </Group>
      <Group title="Quantity and delivery">
        <QuoteField field="quantityMax" props={props} />
        <QuoteField field="quantityMin" props={props} />
        <QuoteField field="deliveryBasis" props={props} />
        <QuoteField field="basisLocation" props={props} />
        <QuoteField field="deliveryStart" props={props} />
        <QuoteField field="deliveryEnd" props={props} />
      </Group>
      <Group title="When and where it came from">
        <QuoteField field="quotedAt" props={props} />
        <QuoteField field="validUntil" props={props} />
        <QuoteField field="sourceType" props={props} />
        <QuoteField field="sourceReference" props={props} className="sm:col-span-2" />
        <QuoteField field="notes" props={props} className="sm:col-span-2 lg:col-span-3" />
      </Group>
    </div>
  );
}
