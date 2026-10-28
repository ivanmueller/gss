import { describe, expect, it } from 'vitest';

import {
  createQuoteSchema,
  isLive,
  parseQuoteTerms,
  quoteStatus,
  reviseQuoteSchema,
  termsToFormValues,
  type QuoteFormValues,
  type QuoteIssue,
} from './quotes';

// Synthetic values only; no market prices.
const NOW = new Date('2026-10-28T15:00:00.000Z');

const VALID: QuoteFormValues = {
  firmness: 'firm',
  price: '725.00',
  currency: 'USD',
  priceUnit: 'MT',
  grade: ' No. 1  CW ',
  deliveryBasis: 'delivered',
  basisLocation: 'Synthetic Town, MN',
  quantityMin: '21',
  quantityMax: '84.000',
  deliveryStart: '2026-11-01',
  deliveryEnd: '2026-11-30',
  quotedAt: '2026-10-28T14:30:00.000Z',
  validUntil: '2026-10-30T22:00:00.000Z',
  sourceType: 'phone',
  sourceReference: 'Call with the merchandiser',
  notes: 'Line one\n\n\n\nLine two',
};

function issuesOf(values: QuoteFormValues): QuoteIssue[] {
  const result = parseQuoteTerms(values, NOW);
  return result.status === 'invalid' ? result.issues : [];
}

describe('parseQuoteTerms', () => {
  it('cleans the terms and keeps decimals as the strings entered', () => {
    expect(parseQuoteTerms(VALID, NOW)).toEqual({
      status: 'ok',
      value: {
        firmness: 'firm',
        price: '725.00',
        currency: 'USD',
        priceUnit: 'MT',
        grade: 'No. 1 CW',
        deliveryBasis: 'delivered',
        basisLocation: 'Synthetic Town, MN',
        quantityMinMt: '21',
        quantityMaxMt: '84.000',
        deliveryStart: '2026-11-01',
        deliveryEnd: '2026-11-30',
        quotedAt: '2026-10-28T14:30:00.000Z',
        validUntil: '2026-10-30T22:00:00.000Z',
        sourceType: 'phone',
        sourceReference: 'Call with the merchandiser',
        notes: 'Line one\n\nLine two',
      },
    });
  });

  it('takes the time quoted as now when it is left out, and the optional fields as none', () => {
    const result = parseQuoteTerms(
      {
        firmness: 'indicative',
        price: '805',
        currency: 'CAD',
        priceUnit: 'BU',
        deliveryBasis: 'fob',
        quantityMax: '100',
        validUntil: '2026-10-29T00:00Z',
        sourceType: 'email',
      },
      NOW,
    );
    expect(result).toMatchObject({
      status: 'ok',
      value: {
        quotedAt: NOW.toISOString(),
        validUntil: '2026-10-29T00:00:00.000Z',
        grade: null,
        quantityMinMt: null,
        deliveryStart: null,
        deliveryEnd: null,
        sourceReference: null,
        notes: null,
      },
    });
  });

  it('requires the choices, a price, the available quantity and a valid-until time', () => {
    expect(issuesOf({})).toEqual([
      { field: 'firmness', message: 'is required' },
      { field: 'currency', message: 'is required' },
      { field: 'priceUnit', message: 'is required' },
      { field: 'deliveryBasis', message: 'is required' },
      { field: 'sourceType', message: 'is required' },
      { field: 'price', message: 'is required' },
      { field: 'quantityMax', message: 'is required' },
      { field: 'validUntil', message: 'is required' },
    ]);
  });

  it('refuses choices from outside the lists, including imports and feeds by hand', () => {
    expect(
      issuesOf({ ...VALID, currency: 'EUR', priceUnit: 'KG', sourceType: 'licensed_feed' }),
    ).toEqual([
      { field: 'currency', message: 'is not one of the choices' },
      { field: 'priceUnit', message: 'is not one of the choices' },
      { field: 'sourceType', message: 'is not one of the choices' },
    ]);
  });

  it('refuses a zero, negative, malformed or comma-separated price', () => {
    expect(issuesOf({ ...VALID, price: '0.00' })).toEqual([
      { field: 'price', message: 'must be more than zero' },
    ]);
    for (const price of ['-5', '7e2', '725.0000000000001', 'abc', '.5']) {
      expect(issuesOf({ ...VALID, price })).toEqual([
        { field: 'price', message: 'must be a number such as 725.00' },
      ]);
    }
    expect(issuesOf({ ...VALID, price: '1,025.00' })[0]?.field).toBe('price');
  });

  it('compares quantities exactly and refuses no available quantity', () => {
    expect(issuesOf({ ...VALID, quantityMin: '84.001', quantityMax: '84' })).toEqual([
      { field: 'quantityMin', message: 'must not be more than the maximum' },
    ]);
    expect(issuesOf({ ...VALID, quantityMin: '84.000', quantityMax: '84' })).toEqual([]);
    expect(issuesOf({ ...VALID, quantityMin: '9', quantityMax: '10' })).toEqual([]);
    expect(issuesOf({ ...VALID, quantityMin: '0', quantityMax: '0.000' })).toEqual([
      { field: 'quantityMax', message: 'must be more than zero' },
    ]);
    expect(issuesOf({ ...VALID, quantityMax: '1.2345' })[0]?.field).toBe('quantityMax');
  });

  it('refuses impossible dates and a delivery window that ends before it starts', () => {
    expect(issuesOf({ ...VALID, deliveryStart: '2026-02-30' })).toEqual([
      { field: 'deliveryStart', message: 'must be a date' },
    ]);
    expect(issuesOf({ ...VALID, deliveryStart: '2026-12-01' })).toEqual([
      { field: 'deliveryEnd', message: 'must not be before the start' },
    ]);
  });

  it('refuses a quote time in the future and a quote that is no longer valid', () => {
    expect(issuesOf({ ...VALID, quotedAt: '2026-10-28T15:06:00Z' })).toEqual([
      { field: 'quotedAt', message: 'must not be in the future' },
    ]);
    // A few minutes ahead of the server's clock is allowed.
    expect(issuesOf({ ...VALID, quotedAt: '2026-10-28T15:04:00Z' })).toEqual([]);
    expect(issuesOf({ ...VALID, validUntil: '2026-10-28T15:00:00Z' })).toEqual([
      { field: 'validUntil', message: 'must be later than now' },
    ]);
    expect(
      issuesOf({ ...VALID, quotedAt: '2026-10-28T15:04:00Z', validUntil: '2026-10-28T15:02:00Z' }),
    ).toEqual([{ field: 'validUntil', message: 'must be after the time quoted' }]);
    expect(issuesOf({ ...VALID, validUntil: '2026-10-30 22:00' })).toEqual([
      { field: 'validUntil', message: 'must be a date and time' },
    ]);
  });

  it('refuses long or unprintable labels and long notes', () => {
    expect(issuesOf({ ...VALID, grade: 'x'.repeat(201) })).toEqual([
      { field: 'grade', message: 'is longer than 200 characters' },
    ]);
    expect(issuesOf({ ...VALID, sourceReference: 'a\u0007b' })).toEqual([
      { field: 'sourceReference', message: 'has characters that cannot be shown' },
    ]);
    expect(issuesOf({ ...VALID, notes: 'x'.repeat(2001) })).toEqual([
      { field: 'notes', message: 'is longer than 2000 characters' },
    ]);
  });

  it('round-trips through the form values used to start new terms', () => {
    const parsed = parseQuoteTerms(VALID, NOW);
    if (parsed.status !== 'ok') throw new Error('expected valid terms');
    const again = parseQuoteTerms(
      { ...termsToFormValues(parsed.value), quotedAt: '2026-10-28T14:30:00.000Z' },
      NOW,
    );
    expect(again).toEqual(parsed);
  });
});

describe('quoteStatus', () => {
  const live = {
    withdrawnAt: null,
    validUntil: '2026-10-28T15:00:00.001Z',
    firmness: 'firm',
  } as const;

  it('is the firmness while the quote is valid', () => {
    expect(quoteStatus(live, NOW)).toBe('firm');
    expect(quoteStatus({ ...live, firmness: 'indicative' }, NOW)).toBe('indicative');
  });

  it('is expired from the valid-until time on, and withdrawn whatever the time', () => {
    expect(quoteStatus({ ...live, validUntil: NOW.toISOString() }, NOW)).toBe('expired');
    expect(quoteStatus({ ...live, withdrawnAt: '2026-10-28T10:00:00Z' }, NOW)).toBe('withdrawn');
    expect(
      quoteStatus(
        {
          withdrawnAt: '2026-10-28T10:00:00Z',
          validUntil: '2026-10-01T00:00:00Z',
          firmness: 'firm',
        },
        NOW,
      ),
    ).toBe('withdrawn');
  });

  it('counts only firm and indicative quotes as live', () => {
    expect(
      ['firm', 'indicative', 'expired', 'withdrawn', 'superseded'].map((s) => isLive(s as never)),
    ).toEqual([true, true, false, false, false]);
  });
});

describe('request schemas', () => {
  const base = {
    organizationId: '00000000-0000-4000-8000-0000000000aa',
    counterpartyId: '00000000-0000-4000-8000-00000000c1aa',
    side: 'bid',
    commodity: 'flaxseed',
    values: VALID,
  };

  it('take a new quote with or without a location', () => {
    expect(createQuoteSchema.safeParse(base).success).toBe(true);
    expect(createQuoteSchema.safeParse({ ...base, facilityId: null }).success).toBe(true);
    expect(createQuoteSchema.safeParse({ ...base, side: 'ask' }).success).toBe(false);
    expect(createQuoteSchema.safeParse({ ...base, commodity: 'Flax seed' }).success).toBe(false);
    expect(createQuoteSchema.safeParse({ ...base, values: { price: 725 } }).success).toBe(false);
    expect(createQuoteSchema.safeParse({ ...base, values: { colour: 'red' } }).success).toBe(false);
  });

  it('take new terms only with the revision they were based on', () => {
    expect(reviseQuoteSchema.safeParse({ basedOnRevision: 2, values: VALID }).success).toBe(true);
    expect(reviseQuoteSchema.safeParse({ values: VALID }).success).toBe(false);
    expect(reviseQuoteSchema.safeParse({ basedOnRevision: 0, values: VALID }).success).toBe(false);
    expect(reviseQuoteSchema.safeParse({ basedOnRevision: 1.5, values: VALID }).success).toBe(
      false,
    );
  });
});
