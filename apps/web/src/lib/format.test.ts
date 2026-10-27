import { describe, expect, it } from 'vitest';

import {
  formatPrice,
  formatQuantityRange,
  formatQuantityShort,
  formatSignedPrice,
  formatUtc,
} from './format';

describe('formatPrice', () => {
  it('shows currency, decimal amount and unit', () => {
    expect(formatPrice({ amount: '725.00', currency: 'USD', unit: 'MT' })).toBe('USD 725.00/MT');
    expect(formatPrice({ amount: '820.00', currency: 'CAD', unit: 'MT' })).toBe('CAD 820.00/MT');
  });

  it('keeps the amount exactly as given', () => {
    expect(formatPrice({ amount: '0.10', currency: 'CAD', unit: 'MT' })).toBe('CAD 0.10/MT');
  });

  it('shows a negative amount (a basis quote) with a true minus sign, and zero unsigned', () => {
    expect(formatPrice({ amount: '-17.00', currency: 'CAD', unit: 'MT' })).toBe(
      'CAD \u221217.00/MT',
    );
    expect(formatPrice({ amount: '-12.50', currency: 'USD', unit: 'MT' })).toBe(
      'USD \u221212.50/MT',
    );
    expect(formatPrice({ amount: '-0.00', currency: 'CAD', unit: 'MT' })).toBe('CAD 0.00/MT');
  });

  it('rejects amounts that are not decimal strings', () => {
    for (const amount of ['', '7.25e2', '+1.00', '--1.00', '-', '1,000.00', 'NaN', ' 1.00']) {
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

describe('formatQuantityShort', () => {
  it.each([
    [{ min: '21.000', max: '84.000' }, '21–84 MT'],
    [{ min: '42.500', max: '100.050' }, '42.5–100.05 MT'],
    [{ min: '100', max: '300' }, '100–300 MT'],
    [{ min: '0.000', max: '10.0' }, '0–10 MT'],
  ])('shortens %j to %s, from the text only', (range, text) => {
    expect(formatQuantityShort(range)).toBe(text);
  });

  it('refuses a quantity that is not a decimal string', () => {
    expect(() => formatQuantityShort({ min: '2e1', max: '84' })).toThrow(/Not a decimal/);
  });
});

describe('formatSignedPrice', () => {
  it.each([
    ['22.00', 'CAD +22.00/MT'],
    ['-15.00', 'CAD \u221215.00/MT'],
    ['0.00', 'CAD 0.00/MT'],
    ['-0.00', 'CAD 0.00/MT'],
  ])('shows %s as %s', (amount, text) => {
    expect(formatSignedPrice({ amount, currency: 'CAD', unit: 'MT' })).toBe(text);
  });

  it('refuses anything but a decimal string', () => {
    expect(() => formatSignedPrice({ amount: '1e3', currency: 'CAD', unit: 'MT' })).toThrow();
  });
});
