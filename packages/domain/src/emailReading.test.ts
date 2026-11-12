import { describe, expect, it } from 'vitest';
import {
  EMAIL_CUT_NOTE,
  EMAIL_READ_CHARS_MAX,
  EMAIL_READ_LINE_MAX,
  EMAIL_READ_LINES_MAX,
  emailLines,
  numberedEmail,
} from './emailReading';

describe('emailLines', () => {
  it('keeps the subject first and the own lines, blank lines left out', () => {
    const result = emailLines('  Re:  barley ', 'Hello,\r\n\r\nWe can take 2 loads.\n  Thanks  ');
    expect(result).toEqual({
      lines: ['Subject: Re: barley', 'Hello,', 'We can take 2 loads.', 'Thanks'],
      cut: false,
      empty: false,
    });
  });

  it('leaves out lines quoted with >, keeping inline answers', () => {
    const result = emailLines('Re', '> Can you do 5.00?\nYes, 5.00 works.\n  >> older\nDone');
    expect(result.lines).toEqual(['Subject: Re', 'Yes, 5.00 works.', 'Done']);
  });

  it('stops at an "On … wrote:" header, also split over two lines', () => {
    expect(
      emailLines('Re', 'Ok\nOn Tue, Nov 11, 2026 at 9:00 AM GSS <a@b.c> wrote:\nOur price 4.10')
        .lines,
    ).toEqual(['Subject: Re', 'Ok']);
    expect(
      emailLines('Re', 'Ok\nOn Tue, Nov 11, 2026 at 9:00 AM GSS\n<a@b.c> wrote:\nOur price 4.10')
        .lines,
    ).toEqual(['Subject: Re', 'Ok']);
  });

  it('stops at Outlook headers', () => {
    expect(emailLines('Re', 'Ok\n-----Original Message-----\nprice').lines).toEqual([
      'Subject: Re',
      'Ok',
    ]);
    expect(
      emailLines('Re', 'Ok\n________________________________\nFrom: GSS\nSent: today\nprice').lines,
    ).toEqual(['Subject: Re', 'Ok']);
    expect(emailLines('Re', 'Ok\nFrom: GSS <a@b.c>\nTo: x\nDate: today\nprice').lines).toEqual([
      'Subject: Re',
      'Ok',
    ]);
  });

  it('keeps a From: line that is no header, and a sentence starting with On', () => {
    const body = 'From: our yard in Lethbridge\nwe ship weekly\nOn Monday we load.';
    expect(emailLines('Re', body).lines).toEqual([
      'Subject: Re',
      'From: our yard in Lethbridge',
      'we ship weekly',
      'On Monday we load.',
    ]);
  });

  it('says when only quoted mail is left', () => {
    expect(emailLines('Re', '> all quoted\n\n').empty).toBe(true);
    expect(emailLines(null, null)).toEqual({ lines: ['Subject: '], cut: false, empty: true });
  });

  it('splits long lines and cuts at the line limit', () => {
    const long = emailLines('S', 'x'.repeat(EMAIL_READ_LINE_MAX * 2 + 5));
    expect(long.lines.slice(1).map((l) => l.length)).toEqual([
      EMAIL_READ_LINE_MAX,
      EMAIL_READ_LINE_MAX,
      5,
    ]);
    const many = emailLines(
      'S',
      Array.from({ length: EMAIL_READ_LINES_MAX + 10 }, (_, n) => `line ${String(n)}`).join('\n'),
    );
    expect(many.cut).toBe(true);
    expect(many.lines).toHaveLength(EMAIL_READ_LINES_MAX + 2);
    expect(many.lines.at(-1)).toBe(EMAIL_CUT_NOTE);
  });

  it('cuts at the character limit without splitting a pair, in linear time', () => {
    const body = '😀'.repeat(300_000);
    const started = Date.now();
    const result = emailLines('S', body);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.cut).toBe(true);
    const text = result.lines.slice(1, -1).join('');
    expect(text.length).toBeLessThanOrEqual(EMAIL_READ_CHARS_MAX);
    expect(text).toBe('😀'.repeat(text.length / 2));
  });

  it('does not stall on one unit left before a pair', () => {
    const body = 'a'.repeat(EMAIL_READ_CHARS_MAX - 1) + '😀😀';
    const result = emailLines('S', body.match(/.{1,999}/gsu)?.join('\n') ?? '');
    expect(result.cut).toBe(true);
  });
});

describe('numberedEmail', () => {
  it('numbers each line from 0', () => {
    expect(numberedEmail(['Subject: x', 'hi'])).toBe('[0] Subject: x\n[1] hi');
  });
});
