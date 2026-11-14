import { describe, expect, it } from 'vitest';

import {
  createFreightSchema,
  freightOutdatedSince,
  freightStatus,
  freightTermsToFormValues,
  isFreightRegion,
  areaPlaceName,
  isUsableFreight,
  parseFreightAreaText,
  parseFreightTerms,
  regionFromAreaText,
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

  it('needs a rate still valid after now and after the time quoted, when a date is given', () => {
    // Optional since F-235 (the owner, 2026-11-13): without one the rate holds until withdrawn.
    expect(parseFreightTerms({ ...VALID, validUntil: '' }, NOW)).toMatchObject({
      status: 'ok',
      value: { validUntil: null },
    });
    expect(freightTermsToFormValues({ ...okTerms(), validUntil: null }).validUntil).toBe('');
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
    origin: { facilityId: '00000000-0000-4000-8000-000000000f2a' },
    destination: { facilityId: '00000000-0000-4000-8000-000000000f1a' },
  };

  it('takes an end as a saved location or an area, never both or coordinates', () => {
    const match = {
      latitude: '49.354000',
      longitude: '-97.365000',
      precision: 'approximate',
      expiresAt: '2026-10-29T16:00:00.000Z',
      signature: 'a'.repeat(64),
    };
    const area = { area: { text: 'Town A, MB', region: 'CA-MB', match } };
    expect(
      createFreightSchema.safeParse({ ...ids, origin: area, mode: 'truck', values: VALID }).success,
    ).toBe(true);
    for (const end of [
      { facilityId: ids.origin.facilityId, area: area.area },
      { area: { ...area.area, latitude: '49.3' } },
      {},
    ]) {
      expect(
        createFreightSchema.safeParse({ ...ids, origin: end, mode: 'truck', values: VALID })
          .success,
      ).toBe(false);
    }
  });

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

describe('freight areas and freshness (F-235)', () => {
  it('cleans an area and refuses empty, long or unshowable text', () => {
    expect(parseFreightAreaText('  Town A,   MB ')).toEqual({ status: 'ok', text: 'Town A, MB' });
    expect(parseFreightAreaText('   ')).toMatchObject({ status: 'invalid' });
    expect(parseFreightAreaText('x'.repeat(201))).toMatchObject({ status: 'invalid' });
    expect(parseFreightAreaText('Town\u0007A')).toMatchObject({ status: 'invalid' });
  });

  it('knows the provinces and states an area may have', () => {
    expect(isFreightRegion('CA-MB')).toBe(true);
    expect(isFreightRegion('US-IN')).toBe(true);
    expect(isFreightRegion('MB')).toBe(false);
    expect(isFreightRegion('US-ZZ')).toBe(false);
  });

  it('tags a rate without an end date outdated 30 days after it was quoted', () => {
    const quotedAt = '2026-10-01T15:00:00.000Z';
    const at = (iso: string) => freightOutdatedSince({ quotedAt, validUntil: null }, new Date(iso));
    expect(at('2026-10-31T14:59:59.999Z')).toBeNull();
    expect(at('2026-10-31T15:00:00.000Z')).toBe('2026-10-31T15:00:00.000Z');
    // A rate with an end date expires instead; it is never outdated.
    expect(
      freightOutdatedSince({ quotedAt, validUntil: '2027-01-01T00:00:00.000Z' }, NOW),
    ).toBeNull();
  });

  it('keeps firmness in the status, and a rate without an end date never expires', () => {
    const base = { withdrawnAt: null, validUntil: null, firmness: 'indicative' as const };
    expect(freightStatus(base, NOW)).toBe('indicative');
    expect(freightStatus({ ...base, firmness: 'firm' }, NOW)).toBe('firm');
    expect(freightStatus({ ...base, validUntil: '2026-10-29T14:00:00.000Z' }, NOW)).toBe('expired');
    expect(freightStatus({ ...base, withdrawnAt: '2026-10-29T14:00:00.000Z' }, NOW)).toBe(
      'withdrawn',
    );
  });

  it('counts only a firm rate that is not outdated as usable', () => {
    expect(isUsableFreight('firm', null)).toBe(true);
    // A fresh indicative rate is listed, never usable (design review D1-02).
    expect(isUsableFreight('indicative', null)).toBe(false);
    expect(isUsableFreight('firm', '2026-10-31T15:00:00.000Z')).toBe(false);
    expect(isUsableFreight('expired', null)).toBe(false);
  });
});

function okTerms() {
  const result = parseFreightTerms(VALID, NOW);
  if (result.status !== 'ok') throw new Error('fixture');
  return result.value;
}

describe('reading the province or state of an area (F-235)', () => {
  it('reads it from the end of the text, by code or name, any case', () => {
    expect(regionFromAreaText('Synthetic Town, MB')).toBe('CA-MB');
    expect(regionFromAreaText('Synthetic Town, Wi')).toBe('US-WI');
    expect(regionFromAreaText('Synthetic Town Indiana')).toBe('US-IN');
    expect(regionFromAreaText('Synthetic Town North Dakota')).toBe('US-ND');
    expect(regionFromAreaText('Synthetic Town')).toBeNull();
    // The text is no town when it is only a province.
    expect(regionFromAreaText('Manitoba')).toBeNull();
  });

  it('looks up the town without the province it repeats', () => {
    expect(areaPlaceName('Synthetic Town A, MB', 'CA-MB')).toBe('Synthetic Town A');
    expect(areaPlaceName('Synthetic Town North Dakota', 'US-ND')).toBe('Synthetic Town');
    // Another province than the one chosen stays part of the text.
    expect(areaPlaceName('Synthetic Town, SK', 'CA-MB')).toBe('Synthetic Town, SK');
    expect(areaPlaceName('Manitoba', 'CA-MB')).toBe('Manitoba');
  });
});
