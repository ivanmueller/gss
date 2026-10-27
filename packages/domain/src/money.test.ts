import { describe, expect, it } from 'vitest';

import { compareDecimal, grossSpread, roundMoney, toCad } from './money';

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

describe('toCad', () => {
  it('converts the golden fixture bid: USD 725.00 at 1.360000 CAD per USD is CAD 986.00', () => {
    // docs/TRADING_RULES.md §5.4: revenue in CAD = 725 × 1.36 = CAD 986.00/MT.
    const result = toCad(usd('725.00'), '1.360000');
    expect(result).toEqual({
      status: 'ok',
      amount: '986.00000000',
      currency: 'CAD',
      unit: 'MT',
      cadPerUsd: '1.360000',
    });
    expect(result.status === 'ok' && roundMoney(result.amount)).toBe('986.00');
  });

  it('keeps a CAD price as quoted, with no rate', () => {
    expect(toCad(cad('820.00'), '1.360000')).toEqual({
      status: 'ok',
      amount: '820.00',
      currency: 'CAD',
      unit: 'MT',
      cadPerUsd: null,
    });
    expect(toCad(cad('820.00'), null)).toMatchObject({ status: 'ok', amount: '820.00' });
  });

  it('blocks a USD price without a rate, never zero', () => {
    expect(toCad(usd('725.00'), null)).toEqual({ status: 'blocked', reason: 'FX_MISSING' });
  });

  it('blocks a currency it cannot convert', () => {
    expect(toCad({ amount: '725.00', currency: 'EUR', unit: 'MT' }, '1.360000')).toEqual({
      status: 'blocked',
      reason: 'CURRENCY_UNSUPPORTED',
    });
  });

  it.each([
    ['330.00', '1.360000', '448.80000000'],
    ['0.1', '3', '0.3'],
    ['725.13', '1.3612', '987.046956'],
    ['123456789012345678.99', '1.360000000001', '167901233056913580.21541234567899'],
    ['-12.50', '1.36', '-17.0000'],
    ['0.00', '1.36', '0.0000'],
  ])('USD %s at %s is CAD %s, exactly', (amount, rate, expected) => {
    expect(toCad(usd(amount), rate)).toMatchObject({ status: 'ok', amount: expected });
  });

  it.each(['0', '0.000000', '-1.36', '1e3', 'abc', ''])('refuses %j as a rate', (rate) => {
    expect(() => toCad(usd('725.00'), rate)).toThrow(/Not an FX rate|Not a decimal amount/);
  });

  it('refuses an amount that is not a decimal', () => {
    expect(() => toCad(usd('7.25e2'), '1.36')).toThrow(/Not a decimal amount/);
    expect(() => toCad(cad('7.25e2'), null)).toThrow(/Not a decimal amount/);
  });
});

describe('roundMoney', () => {
  it.each([
    ['986.00000000', '986.00'],
    ['986.005', '986.01'],
    ['986.004999', '986.00'],
    ['987.046956', '987.05'],
    ['-0.004', '0.00'],
    ['-17.005', '-17.01'],
    ['181', '181.00'],
    ['0.125', '0.13'],
  ])('rounds %s to %s', (amount, expected) => {
    expect(roundMoney(amount)).toBe(expected);
  });

  it('rounds to other places', () => {
    expect(roundMoney('1.3649999', 4)).toBe('1.3650');
    expect(roundMoney('42.5', 0)).toBe('43');
  });
});
