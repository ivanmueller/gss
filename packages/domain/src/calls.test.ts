import { describe, expect, it } from 'vitest';

import {
  callLogNotes,
  dialablePhone,
  displayPhone,
  formatCallLength,
  placeCallSchema,
} from './calls';

describe('dialablePhone', () => {
  it('dials a saved North American number as +1 and its 10 digits', () => {
    expect(dialablePhone('(403) 555-0100')).toBe('+14035550100');
    expect(dialablePhone('403-555-0100')).toBe('+14035550100');
    expect(dialablePhone('403.555.0100')).toBe('+14035550100');
    expect(dialablePhone('1 403 555 0100')).toBe('+14035550100');
    expect(dialablePhone('+1 (306) 555-0101')).toBe('+13065550101');
  });

  it('keeps the digits of a number written with another country code', () => {
    expect(dialablePhone('+44 20 7946 0958')).toBe('+442079460958');
    expect(dialablePhone('+52 55 5555 0100')).toBe('+525555550100');
  });

  it('refuses numbers it cannot dial', () => {
    expect(dialablePhone('(403) 555-0100 x7')).toBeNull();
    expect(dialablePhone('403-555-0100 ext. 12')).toBeNull();
    expect(dialablePhone('555-0100')).toBeNull();
    expect(dialablePhone('(103) 555-0100')).toBeNull();
    expect(dialablePhone('(403) 155-0100')).toBeNull();
    expect(dialablePhone('+1 403 555 010')).toBeNull();
    expect(dialablePhone('+0 123 456 789')).toBeNull();
    expect(dialablePhone('403 555 0100 +1')).toBeNull();
    expect(dialablePhone('call the office')).toBeNull();
    expect(dialablePhone('')).toBeNull();
    expect(dialablePhone('+1234567890123456')).toBeNull();
  });
});

describe('displayPhone', () => {
  it('shows a North American number as people write it', () => {
    expect(displayPhone('+14035550100')).toBe('(403) 555-0100');
    expect(displayPhone('+442079460958')).toBe('+442079460958');
  });
});

describe('formatCallLength', () => {
  it('reads like a person would say it', () => {
    expect(formatCallLength(45)).toBe('45 s');
    expect(formatCallLength(372)).toBe('6 min 12 s');
    expect(formatCallLength(3720)).toBe('1 h 2 min');
    expect(formatCallLength(-3)).toBe('0 s');
    expect(formatCallLength(59.6)).toBe('1 min 0 s');
  });

  it('writes the contact log notes of a call', () => {
    expect(callLogNotes(372)).toBe('Phone call placed from the platform; talked 6 min 12 s.');
  });
});

describe('placeCallSchema', () => {
  it('takes a counterparty and a contact or null', () => {
    const counterpartyId = '00000000-0000-4000-8000-00000000c1aa';
    expect(placeCallSchema.safeParse({ counterpartyId, contactId: null }).success).toBe(true);
    expect(placeCallSchema.safeParse({ counterpartyId }).success).toBe(false);
    expect(
      placeCallSchema.safeParse({ counterpartyId, contactId: null, phone: '+14035550100' }).success,
    ).toBe(false);
  });
});
