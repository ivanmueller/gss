import { describe, expect, it } from 'vitest';

import {
  fitTranscript,
  TRANSCRIPT_MAX_CHARS,
  transcriptLines,
  transcriptText,
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

describe('transcriptLines', () => {
  it('maps the first channel to the caller and the second to the counterparty, oldest first', () => {
    expect(
      transcriptLines([
        { start: 3, text: 'Two loads.', channel: 1 },
        { start: 0.5, text: ' Morning   Pat. ', channel: 0 },
        { start: 4, text: 'At the posted price.', channel: 1 },
        { start: 6, text: 'Deal.', channel: 0 },
        { start: 7, text: '   ', channel: 1 },
        { start: 8, text: 'Hmm.', channel: 2 },
        { start: -1, text: 'Earlier.', channel: null },
      ]),
    ).toEqual([
      { side: null, start: 0, text: 'Earlier.' },
      { side: 'caller', start: 0.5, text: 'Morning Pat.' },
      { side: 'counterparty', start: 3, text: 'Two loads. At the posted price.' },
      { side: 'caller', start: 6, text: 'Deal.' },
      { side: null, start: 8, text: 'Hmm.' },
    ]);
  });

  it('gives no lines for silence', () => {
    expect(transcriptLines([])).toEqual([]);
    expect(transcriptLines([{ start: 1, text: ' ', channel: 0 }])).toEqual([]);
  });
});

describe('transcriptText', () => {
  it('writes one line per turn with its side', () => {
    expect(
      transcriptText([
        { side: 'caller', start: 0, text: 'Morning Pat.' },
        { side: 'counterparty', start: 2, text: 'Two loads.' },
        { side: null, start: 4, text: 'Bye.' },
      ]),
    ).toBe('Caller: Morning Pat.\nCounterparty: Two loads.\nUnknown: Bye.');
    expect(transcriptText([])).toBe('');
  });
});

describe('fitTranscript', () => {
  it('keeps a transcript that fits as it is', () => {
    const lines = [
      { side: 'caller' as const, start: 0, text: 'Morning Pat.' },
      { side: 'counterparty' as const, start: 2, text: 'Two loads.' },
    ];
    expect(fitTranscript(lines)).toEqual(lines);
  });

  it("cuts the plain transcript to the database's 200,000 characters, the last line cut short", () => {
    const lines = [
      { side: 'caller' as const, start: 0, text: 'x'.repeat(199_995) },
      { side: 'counterparty' as const, start: 9, text: 'Two loads.' },
    ];
    const fitted = fitTranscript(lines);
    expect(transcriptText(fitted)).toHaveLength(TRANSCRIPT_MAX_CHARS);
    expect(fitted).toEqual([{ side: 'caller', start: 0, text: 'x'.repeat(199_992) }]);
    // "Caller: abc" (11) + newline + "Counterparty: " (14) leaves 4 characters of the second.
    expect(
      fitTranscript(
        [
          { side: 'caller', start: 0, text: 'abc' },
          { side: 'counterparty', start: 1, text: 'Two loads.' },
        ],
        30,
      ),
    ).toEqual([
      { side: 'caller', start: 0, text: 'abc' },
      { side: 'counterparty', start: 1, text: 'Two ' },
    ]);
  });

  it('never splits a character in two, and keeps at most the number of lines given', () => {
    // "Caller: " (8) + "a" leaves room for half of the emoji.
    expect(fitTranscript([{ side: 'caller', start: 0, text: 'a\u{1F33E}b' }], 10)).toEqual([
      { side: 'caller', start: 0, text: 'a' },
    ]);
    const many = Array.from({ length: 5 }, (_, i) => ({
      side: i % 2 === 0 ? ('caller' as const) : ('counterparty' as const),
      start: i,
      text: 'Yes.',
    }));
    expect(fitTranscript(many, 1000, 3)).toHaveLength(3);
  });
});
