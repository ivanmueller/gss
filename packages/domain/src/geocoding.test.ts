import { describe, expect, it } from 'vitest';

import {
  GEOCODE_LIMIT,
  geocodeRequestSchema,
  isConfidentMatch,
  saveCoordinatesRequestSchema,
  signedMatchOf,
} from './geocoding';

const MATCH = {
  latitude: '52.133214',
  longitude: '-106.670046',
  precision: 'exact' as const,
  accuracyType: 'rooftop',
  confidence: '0.97',
  formattedAddress: '1 Synthetic Rd, Synthetic Town, SK S4P',
  regionMatches: true,
  facilityVersion: '2026-10-27T18:00:00.000000Z',
  expiresAt: '2026-10-27T19:00:00.000Z',
  signature: 'a'.repeat(64),
};
const FACILITY = '00000000-0000-4000-8000-00000000fac1';
const request = (matches: unknown[]) => ({
  organizationId: '00000000-0000-4000-8000-0000000000aa',
  matches,
});

describe('signedMatchOf', () => {
  it('keeps only what the API signed', () => {
    expect(signedMatchOf(FACILITY, MATCH)).toEqual({
      facilityId: FACILITY,
      latitude: '52.133214',
      longitude: '-106.670046',
      precision: 'exact',
      accuracyType: 'rooftop',
      confidence: '0.97',
      facilityVersion: '2026-10-27T18:00:00.000000Z',
      expiresAt: '2026-10-27T19:00:00.000Z',
      signature: 'a'.repeat(64),
    });
  });
});

describe('saveCoordinatesRequestSchema', () => {
  const valid = signedMatchOf(FACILITY, MATCH);

  it('accepts signed matches', () => {
    expect(saveCoordinatesRequestSchema.safeParse(request([valid])).success).toBe(true);
    expect(
      saveCoordinatesRequestSchema.safeParse(
        request([{ ...valid, latitude: '-5.000000', longitude: '7.100000', confidence: '1.00' }]),
      ).success,
    ).toBe(true);
  });

  it.each([
    ['five decimals', { latitude: '52.13321' }],
    ['a number', { latitude: 52.133214 }],
    ['an exponent', { longitude: '-1.06e2' }],
    ['a confidence above 1', { confidence: '1.10' }],
    ['an unknown precision', { precision: 'rough' }],
    ['a short signature', { signature: 'abc' }],
    ['an odd accuracy type', { accuracyType: 'Rooftop!' }],
    ['a bad expiry', { expiresAt: 'tomorrow' }],
    ['no facility version', { facilityVersion: undefined }],
    ['a facility version without microseconds', { facilityVersion: '2026-10-27T18:00:00.000Z' }],
    ['a bad facility id', { facilityId: 'f1' }],
  ])('refuses %s', (_what, change) => {
    expect(saveCoordinatesRequestSchema.safeParse(request([{ ...valid, ...change }])).success).toBe(
      false,
    );
  });

  it('needs at least one match and at most the limit', () => {
    expect(saveCoordinatesRequestSchema.safeParse(request([])).success).toBe(false);
    expect(
      saveCoordinatesRequestSchema.safeParse(request(Array(GEOCODE_LIMIT + 1).fill(valid))).success,
    ).toBe(false);
  });
});

describe('isConfidentMatch', () => {
  it('is a match in the location’s province or state with a confidence of 0.8 or more', () => {
    expect(isConfidentMatch(MATCH)).toBe(true);
    expect(isConfidentMatch({ ...MATCH, confidence: '0.80' })).toBe(true);
    expect(isConfidentMatch({ ...MATCH, confidence: '0.79' })).toBe(false);
    expect(isConfidentMatch({ ...MATCH, regionMatches: false })).toBe(false);
  });
});

describe('geocodeRequestSchema', () => {
  const organizationId = '00000000-0000-4000-8000-0000000000aa';
  const id = '00000000-0000-4000-8000-00000000c0de';
  it('looks up one counterparty, one import, or the whole organization', () => {
    expect(geocodeRequestSchema.safeParse({ organizationId }).success).toBe(true);
    expect(geocodeRequestSchema.safeParse({ organizationId, counterpartyId: id }).success).toBe(
      true,
    );
    expect(geocodeRequestSchema.safeParse({ organizationId, importBatchId: id }).success).toBe(
      true,
    );
  });

  it('refuses both at once, and ids that are not UUIDs', () => {
    expect(
      geocodeRequestSchema.safeParse({ organizationId, counterpartyId: id, importBatchId: id })
        .success,
    ).toBe(false);
    expect(geocodeRequestSchema.safeParse({ organizationId, counterpartyId: 'x' }).success).toBe(
      false,
    );
  });
});
