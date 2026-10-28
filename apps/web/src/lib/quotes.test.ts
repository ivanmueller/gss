import { describe, expect, it } from 'vitest';

import {
  canEnterQuotes,
  formToRequest,
  fromLocalInput,
  quoteBasis,
  quoteDelivery,
  quotePlace,
  quotePrice,
  quoteQuantity,
  toLocalInput,
} from './quotes';

describe('quote helpers', () => {
  it('lets traders and admins enter quotes, nobody else', () => {
    expect(
      ['viewer', 'analyst', 'trader', 'operations', 'org_admin'].filter(canEnterQuotes),
    ).toEqual(['trader', 'org_admin']);
  });

  it('turns a datetime-local value into a UTC instant and back, in the browser’s zone', () => {
    const local = '2026-10-30T16:00';
    const instant = fromLocalInput(local);
    expect(instant).toBe(new Date(local).toISOString());
    expect(toLocalInput(instant)).toBe(local);
    expect(fromLocalInput('')).toBe('');
    expect(toLocalInput(undefined)).toBe('');
    expect(toLocalInput('not a time')).toBe('');
    expect(formToRequest({ price: '1', quotedAt: '', validUntil: local })).toEqual({
      price: '1',
      quotedAt: '',
      validUntil: instant,
    });
  });

  it('shows prices with currency and unit, as entered', () => {
    expect(quotePrice({ price: '725.00', currency: 'USD', priceUnit: 'MT' })).toBe('USD 725.00/MT');
    expect(quotePrice({ price: '15.2500', currency: 'CAD', priceUnit: 'BU' })).toBe(
      'CAD 15.2500/bu',
    );
    expect(quotePrice({ price: '9', currency: 'USD', priceUnit: 'ST' })).toBe('USD 9/short ton');
    expect(quotePrice({ price: '18.10', currency: 'USD', priceUnit: 'CWT' })).toBe('USD 18.10/cwt');
  });

  it('shows quantity, basis, delivery and place in words', () => {
    expect(quoteQuantity({ quantityMinMt: '21.000', quantityMaxMt: '84.500' })).toBe('21–84.5 MT');
    expect(quoteQuantity({ quantityMinMt: null, quantityMaxMt: '100.000' })).toBe('Up to 100 MT');
    expect(quoteQuantity({ quantityMinMt: '0.000', quantityMaxMt: '100.000' })).toBe(
      'Up to 100 MT',
    );
    expect(quoteBasis({ deliveryBasis: 'fob', basisLocation: null })).toBe('FOB');
    expect(quoteBasis({ deliveryBasis: 'ex_farm', basisLocation: 'Synthetic, SK' })).toBe(
      'Ex-farm · Synthetic, SK',
    );
    expect(quoteDelivery({ deliveryStart: null, deliveryEnd: null })).toBe('Not stated');
    expect(quoteDelivery({ deliveryStart: '2026-11-01', deliveryEnd: null })).toBe(
      'From 2026-11-01',
    );
    expect(quoteDelivery({ deliveryStart: null, deliveryEnd: '2026-11-30' })).toBe('By 2026-11-30');
    expect(quotePlace({ facility: null })).toBeNull();
    expect(
      quotePlace({
        facility: { id: 'f', name: null, city: 'Synthetic', region: null, country: 'US' },
      }),
    ).toBe('Synthetic, United States');
  });
});
