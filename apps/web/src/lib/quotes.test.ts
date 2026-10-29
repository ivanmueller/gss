import { describe, expect, it } from 'vitest';

import {
  canEnterQuotes,
  formToRequest,
  quoteBasis,
  quoteDelivery,
  quotePlace,
  quotePrice,
  quoteQuantity,
} from './quotes';

describe('quote helpers', () => {
  it('lets traders and admins enter quotes, nobody else', () => {
    expect(
      ['viewer', 'analyst', 'trader', 'operations', 'org_admin'].filter(canEnterQuotes),
    ).toEqual(['trader', 'org_admin']);
  });

  it('sends the form’s times, typed in Alberta time, as UTC instants', () => {
    expect(formToRequest({ price: '1', quotedAt: '', validUntil: '2026-12-15T16:00' })).toEqual({
      price: '1',
      quotedAt: '',
      validUntil: '2026-12-15T22:00:00.000Z',
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
        facility: {
          id: 'f',
          name: null,
          city: 'Synthetic',
          region: null,
          country: 'US',
          latitude: null,
          longitude: null,
          locationPrecision: null,
        },
      }),
    ).toBe('Synthetic, United States');
  });
});
