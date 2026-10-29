import { describe, expect, it } from 'vitest';

import {
  createFreightSchema,
  freightTermsToFormValues,
  parseFreightTerms,
  reviseFreightSchema,
  type FreightFormValues,
  type FreightIssue,
} from './freight';

// Synthetic values only; no real freight rates.
const NOW = new Date('2026-10-29T15:00:00.000Z');

const VALID: FreightFormValues = {
  firmness: 'firm',
  rate: '105.00',
  currency: 'CAD',
  rateUnit: 'MT',
  inclusions: ' Fuel  surcharge included ',
  quotedAt: '2026-10-29T14:30:00.000Z',
  validUntil: '2026-11-05T22:00:00.000Z',
  sourceType: 'email',
  sourceReference: 'Synthetic dispatch email',
  notes: 'Line one\n\n\n\nLine two',
};

function issuesOf(values: FreightFormValues): FreightIssue[] {
  const result = parseFreightTerms(values, NOW);
  return result.status === 'invalid' ? result.issues : [];
}

describe('parseFreightTerms', () => {
  it('cleans the terms and keeps the rate as the string entered', () => {
    expect(parseFreightTerms(VALID, NOW)).toEqual({
      status: 'ok',
      value: {
        firmness: 'firm',
        rate: '105.00',
        currency: 'CAD',
        rateUnit: 'MT',
        payload: null,
        payloadUnit: null,
        inclusions: 'Fuel surcharge included',
        quotedAt: '2026-10-29T14:30:00.000Z',
        validUntil: '2026-11-05T22:00:00.000Z',
        sourceType: 'email',
        sourceReference: 'Synthetic dispatch email',
        notes: 'Line one\n\nLine two',
      },
    });
  });

  it('takes the time quoted as now when it is left out, and the optional fields as none', () => {
    expect(
      parseFreightTerms(
        {
          firmness: 'indicative',
          rate: '0.42',
          currency: 'USD',
          rateUnit: 'BU',
          validUntil: '2026-10-30T00:00Z',
          sourceType: 'phone',
        },
        NOW,
      ),
    ).toMatchObject({
      status: 'ok',
      value: {
        rate: '0.42',
        rateUnit: 'BU',
        inclusions: null,
        quotedAt: NOW.toISOString(),
        validUntil: '2026-10-30T00:00:00.000Z',
        sourceReference: null,
        notes: null,
      },
    });
  });

  it('keeps a rate per load with its payload as quoted', () => {
    expect(
      parseFreightTerms(
        {
          ...VALID,
          rate: '4200',
          currency: 'USD',
          rateUnit: 'LOAD',
          payload: '48000',
          payloadUnit: 'LB',
        },
        NOW,
      ),
    ).toMatchObject({
      status: 'ok',
      value: { rate: '4200', rateUnit: 'LOAD', payload: '48000', payloadUnit: 'LB' },
    });
  });

  it('requires the payload of a rate per load, never inferring one', () => {
    expect(issuesOf({ ...VALID, rateUnit: 'LOAD' })).toEqual([
      { field: 'payload', message: 'is required for a rate per load' },
      { field: 'payloadUnit', message: 'is required' },
    ]);
    expect(issuesOf({ ...VALID, rateUnit: 'LOAD', payload: '0', payloadUnit: 'MT' })).toEqual([
      { field: 'payload', message: 'must be more than zero' },
    ]);
    expect(issuesOf({ ...VALID, rateUnit: 'LOAD', payload: '48,000', payloadUnit: 'LB' })).toEqual([
      { field: 'payload', message: 'needs no commas: type 1000, not 1,000' },
    ]);
    expect(issuesOf({ ...VALID, rateUnit: 'LOAD', payload: '40.1234', payloadUnit: 'MT' })).toEqual(
      [{ field: 'payload', message: 'must be the payload as a number with at most 3 decimals' }],
    );
    expect(issuesOf({ ...VALID, rateUnit: 'LOAD', payload: '40', payloadUnit: 'KG' })).toEqual([
      { field: 'payloadUnit', message: 'is not one of the choices' },
    ]);
  });

  it('leaves out a payload for a rate that is not per load', () => {
    expect(
      parseFreightTerms({ ...VALID, rateUnit: 'ST', payload: '40', payloadUnit: 'MT' }, NOW),
    ).toMatchObject({ status: 'ok', value: { rateUnit: 'ST', payload: null, payloadUnit: null } });
  });

  it('refuses a missing, zero, negative or malformed rate', () => {
    expect(issuesOf({ ...VALID, rate: '' })).toEqual([{ field: 'rate', message: 'is required' }]);
    expect(issuesOf({ ...VALID, rate: '0.00' })).toEqual([
      { field: 'rate', message: 'must be more than zero' },
    ]);
    expect(issuesOf({ ...VALID, rate: '-5' })).toEqual([
      { field: 'rate', message: 'must be a number such as 105.00' },
    ]);
    expect(issuesOf({ ...VALID, rate: '1,050.00' })).toEqual([
      { field: 'rate', message: 'needs no commas: type 1025.00, not 1,025.00' },
    ]);
    expect(issuesOf({ ...VALID, rate: '1e3' })).toEqual([
      { field: 'rate', message: 'must be a number such as 105.00' },
    ]);
  });

  it('refuses choices that are not on the lists', () => {
    expect(
      issuesOf({ ...VALID, firmness: 'maybe', currency: 'EUR', rateUnit: 'KM', sourceType: 'x' }),
    ).toEqual([
      { field: 'firmness', message: 'is not one of the choices' },
      { field: 'currency', message: 'is not one of the choices' },
      { field: 'rateUnit', message: 'is not one of the choices' },
      { field: 'sourceType', message: 'is not one of the choices' },
    ]);
    expect(issuesOf({ ...VALID, sourceType: 'file_import' })).toEqual([
      { field: 'sourceType', message: 'is not one of the choices' },
    ]);
  });

  it('needs a rate still valid after now and after the time quoted', () => {
    expect(issuesOf({ ...VALID, validUntil: '' })).toEqual([
      { field: 'validUntil', message: 'is required' },
    ]);
    expect(issuesOf({ ...VALID, validUntil: '2026-10-29T14:00:00Z' })).toEqual([
      { field: 'validUntil', message: 'must be later than now' },
    ]);
    expect(issuesOf({ ...VALID, quotedAt: '2026-10-29T18:00:00Z' })).toEqual([
      { field: 'quotedAt', message: 'must not be in the future' },
    ]);
    expect(issuesOf({ ...VALID, quotedAt: 'yesterday' })).toEqual([
      { field: 'quotedAt', message: 'must be a date and time' },
    ]);
  });

  it('limits the text fields', () => {
    expect(issuesOf({ ...VALID, inclusions: 'x'.repeat(201), notes: 'y'.repeat(2001) })).toEqual([
      { field: 'inclusions', message: 'is longer than 200 characters' },
      { field: 'notes', message: 'is longer than 2000 characters' },
    ]);
    expect(issuesOf({ ...VALID, sourceReference: 'bell\u0007' })).toEqual([
      { field: 'sourceReference', message: 'has characters that cannot be shown' },
    ]);
  });
});

describe('freightTermsToFormValues', () => {
  it('fills the form again with the terms', () => {
    const parsed = parseFreightTerms(
      { ...VALID, rateUnit: 'LOAD', payload: '90.5', payloadUnit: 'MT' },
      NOW,
    );
    if (parsed.status !== 'ok') throw new Error('expected valid terms');
    const values = freightTermsToFormValues(parsed.value);
    expect(values).toMatchObject({ rate: '105.00', payload: '90.5', payloadUnit: 'MT' });
    expect(values.quotedAt).toBeUndefined();
    expect(parseFreightTerms(values, NOW)).toMatchObject({ status: 'ok' });
  });
});

describe('freight request schemas', () => {
  const ids = {
    organizationId: '00000000-0000-4000-8000-0000000000aa',
    carrierId: '00000000-0000-4000-8000-00000000d1aa',
    originFacilityId: '00000000-0000-4000-8000-000000000f2a',
    destinationFacilityId: '00000000-0000-4000-8000-000000000f1a',
  };

  it('takes a carrier, a route, a mode and the terms', () => {
    expect(createFreightSchema.safeParse({ ...ids, mode: 'rail', values: VALID }).success).toBe(
      true,
    );
    expect(createFreightSchema.safeParse({ ...ids, mode: 'barge', values: VALID }).success).toBe(
      false,
    );
    expect(
      createFreightSchema.safeParse({ ...ids, carrierId: 'k1a', mode: 'truck', values: VALID })
        .success,
    ).toBe(false);
    expect(
      createFreightSchema.safeParse({ ...ids, mode: 'truck', values: { price: '1' } }).success,
    ).toBe(false);
  });

  it('revises only the revision the person was looking at', () => {
    expect(reviseFreightSchema.safeParse({ basedOnRevision: 2, values: VALID }).success).toBe(true);
    expect(reviseFreightSchema.safeParse({ basedOnRevision: 0, values: VALID }).success).toBe(
      false,
    );
  });
});
