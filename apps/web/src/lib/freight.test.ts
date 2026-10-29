import { describe, expect, it } from 'vitest';

import { canEnterFreight, freightPayload, freightPlace, freightRate } from './freight';

describe('freight helpers', () => {
  it('lets traders, operations and admins enter freight, and nobody else', () => {
    expect(['trader', 'operations', 'org_admin'].every(canEnterFreight)).toBe(true);
    expect(['viewer', 'analyst', ''].some(canEnterFreight)).toBe(false);
  });

  it('shows a rate with its currency and unit as quoted, never converted', () => {
    expect(freightRate({ rate: '105.00', currency: 'CAD', rateUnit: 'MT' })).toBe('CAD 105.00/MT');
    expect(freightRate({ rate: '4200', currency: 'USD', rateUnit: 'LOAD' })).toBe('USD 4200/load');
    expect(freightRate({ rate: '0.42', currency: 'USD', rateUnit: 'BU' })).toBe('USD 0.42/bu');
    expect(freightRate({ rate: '3.10', currency: 'USD', rateUnit: 'CWT' })).toBe('USD 3.10/cwt');
    expect(freightRate({ rate: '96.00', currency: 'USD', rateUnit: 'ST' })).toBe(
      'USD 96.00/short ton',
    );
  });

  it('shows a load’s payload, and nothing for a rate that is not per load', () => {
    expect(freightPayload({ payload: '90.500', payloadUnit: 'MT' })).toBe('90.5 MT a load');
    expect(freightPayload({ payload: '48000.000', payloadUnit: 'LB' })).toBe('48000 lb a load');
    expect(freightPayload({ payload: '40', payloadUnit: 'ST' })).toBe('40 short tons a load');
    expect(freightPayload({ payload: null, payloadUnit: null })).toBeNull();
  });

  it('names a location by name, city and region, or country without a region', () => {
    expect(
      freightPlace({ name: 'Synthetic Mill', city: 'Synthetic Town', region: 'MN', country: 'US' }),
    ).toBe('Synthetic Mill, Synthetic Town, MN');
    expect(freightPlace({ name: null, city: null, region: null, country: 'CA' })).toBe('Canada');
  });
});
