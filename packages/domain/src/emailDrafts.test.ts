import { describe, expect, it } from 'vitest';

import { checkEmailDraft, plainNumber, replySubject } from './emailDrafts';

describe('plainNumber', () => {
  it('compares numbers as written in different ways', () => {
    expect(plainNumber('2,000')).toBe('2000');
    expect(plainNumber('300.50')).toBe('300.5');
    expect(plainNumber('300.00')).toBe('300');
    expect(plainNumber('1500.000')).toBe('1500');
    expect(plainNumber('007')).toBe('7');
  });
});

describe('checkEmailDraft', () => {
  const source = [
    'Live bids and offers:',
    '[Q1] bid (they buy) Feed barley at CAD 300.00/MT, up to 1500.000 MT',
    'Contacts: Pat (contact), phone 403-555-0100',
    'Call on 6 Nov 2026: "two loads next week"',
  ].join('\n');

  it('accepts numbers found in the records, however written', () => {
    const result = checkEmailDraft(
      {
        subject: 'Your barley bid',
        message:
          'Thanks for your bid of $300 a tonne for up to 1,500 MT. Call me at (403) 555-0100.',
      },
      source,
    );
    expect(result).toEqual({ checkThis: [], placeholders: [] });
  });

  it('lists numbers that are not in the records, each once, in order', () => {
    const result = checkEmailDraft(
      {
        subject: 'Barley at $310',
        message: 'We can do $310.50 for 2,000 MT, $310 firm. Call +1 (587) 555-0199.',
      },
      source,
    );
    expect(result.checkThis).toEqual(['310', '310.50', '2,000', '+1 (587) 555-0199']);
  });

  it('lists number words that are not in the records', () => {
    const result = checkEmailDraft(
      { subject: 'Loads', message: 'Two loads now, twelve more in spring.' },
      source,
    );
    expect(result.checkThis).toEqual(['twelve']);
  });

  it('finds the placeholders, each once', () => {
    const result = checkEmailDraft(
      { subject: 'Offer', message: 'We offer [price] delivered by [date]. Price: [price].' },
      source,
    );
    expect(result.placeholders).toEqual(['[price]', '[date]']);
  });

  it('flags a price that was only in the quoted part never sent to Claude', () => {
    const result = checkEmailDraft(
      { subject: 'Re: barley', message: 'As agreed, $295 a tonne.' },
      source,
    );
    expect(result.checkThis).toEqual(['295']);
  });

  it('keeps at most 20 items, each at most 40 characters', () => {
    const many = Array.from({ length: 30 }, (_, k) => String(9000 + k)).join(' ');
    const long = '9'.repeat(60);
    const result = checkEmailDraft({ subject: long, message: many }, source);
    expect(result.checkThis).toHaveLength(20);
    expect(result.checkThis[0]).toHaveLength(40);
  });

  it('runs in linear time on a long hostile text', () => {
    const hostile = `${'1,'.repeat(50_000)}x ${'(403) '.repeat(10_000)}`;
    const started = performance.now();
    checkEmailDraft({ subject: 'x', message: hostile }, hostile);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('replySubject', () => {
  it('adds one Re:', () => {
    expect(replySubject('Barley')).toBe('Re: Barley');
    expect(replySubject('Re: Barley')).toBe('Re: Barley');
    expect(replySubject('RE:Barley')).toBe('Re: Barley');
    expect(replySubject('Fwd: Barley')).toBe('Re: Barley');
    expect(replySubject('  ')).toBe('Re:');
  });
});
