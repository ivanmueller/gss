import { describe, expect, it } from 'vitest';

import { formatPrice, formatQuantityRange, formatUtc } from './format';

describe('formatPrice', () => {
  it('shows currency, decimal amount and unit', () => {
    expect(formatPrice({ amount: '725.00', currency: 'USD', unit: 'MT' })).toBe('USD 725.00/MT');
    expect(formatPrice({ amount: '820.00', currency: 'CAD', unit: 'MT' })).toBe('CAD 820.00/MT');
  });

  it('keeps the amount exactly as given', () => {
    expect(formatPrice({ amount: '0.10', currency: 'CAD', unit: 'MT' })).toBe('CAD 0.10/MT');
  });

  it('rejects amounts that are not decimal strings', () => {
    for (const amount of ['', '7.25e2', '-1.00', '1,000.00', 'NaN', ' 1.00']) {
      expect(() => formatPrice({ amount, currency: 'USD', unit: 'MT' })).toThrow(/decimal/);
    }
  });
});

describe('formatUtc', () => {
  it('formats a UTC timestamp to the minute', () => {
    expect(formatUtc('2026-10-26T15:00:00Z')).toBe('2026-10-26 15:00 UTC');
  });

  it('converts offsets to UTC', () => {
    expect(formatUtc('2026-10-26T10:30:00-05:00')).toBe('2026-10-26 15:30 UTC');
  });

  it('rejects text that is not a timestamp', () => {
    expect(() => formatUtc('tomorrow')).toThrow(/timestamp/);
  });
});

describe('formatQuantityRange', () => {
  it('shows the range in metric tonnes', () => {
    expect(formatQuantityRange({ min: '21.000', max: '42.000' })).toBe('21.000–42.000 MT');
  });
});
