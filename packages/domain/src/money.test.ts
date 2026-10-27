import { describe, expect, it } from 'vitest';

import { compareDecimal, grossSpread } from './money';

const cad = (amount: string) => ({ amount, currency: 'CAD', unit: 'MT' });
const usd = (amount: string) => ({ amount, currency: 'USD', unit: 'MT' });

describe('grossSpread', () => {
  it('blocks the golden fixture: a USD bid and a CAD offer need an FX rate, never zero', () => {
    // docs/TRADING_RULES.md §5.4: buyer bid USD 725.00/MT, seller offer CAD 820.00/MT.
    expect(grossSpread(usd('725.00'), cad('820.00'))).toEqual({
      status: 'blocked',
      reason: 'CURRENCY_MISMATCH',
    });
  });

  it('blocks quotes in different units', () => {
    expect(grossSpread(cad('790.00'), { amount: '21.50', currency: 'CAD', unit: 'BU' })).toEqual({
      status: 'blocked',
      reason: 'UNIT_MISMATCH',
    });
  });

  it.each([
    ['790.00', '805.00', '-15.00', 'negative, shown plainly'],
    ['830.50', '805.25', '25.25', 'positive'],
    ['805.00', '805.00', '0.00', 'zero, without a minus sign'],
    ['800', '805.125', '-5.125', 'the longer of the two scales'],
    ['0.3', '0.1', '0.2', 'exact where floating point gives 0.19999999999999998'],
    ['123456789012345678.01', '0.02', '123456789012345677.99', 'large amounts, exactly'],
    ['-12.50', '-20.00', '7.50', 'negative prices (basis quotes)'],
  ])('bid %s minus offer %s is %s (%s)', (bid, offer, amount) => {
    expect(grossSpread(cad(bid), cad(offer))).toEqual({
      status: 'ok',
      amount,
      currency: 'CAD',
      unit: 'MT',
    });
  });

  it.each(['1e3', 'abc', '', '1,000.00', ' 805.00', '805.', '.5', '+805.00', 'NaN', 'Infinity'])(
    'refuses %j as an amount',
    (amount) => {
      expect(() => grossSpread(cad(amount), cad('805.00'))).toThrow(/Not a decimal amount/);
      expect(() => grossSpread(cad('805.00'), cad(amount))).toThrow(/Not a decimal amount/);
    },
  );
});

describe('compareDecimal', () => {
  it.each([
    ['820.00', '805.5', 1],
    ['9.99', '10', -1],
    ['1.0', '1.00', 0],
    ['-0.01', '0', -1],
    ['0.300000000001', '0.3', 1],
  ])('compares %s with %s', (a, b, sign) => {
    expect(Math.sign(compareDecimal(a, b))).toBe(sign);
  });
});
