import { describe, expect, it } from 'vitest';
import {
  codePointLength,
  findForward,
  forwardNote,
  forwardedSender,
  forwardedText,
  sliceCodePoints,
} from './emailForward';
import { emailLines } from './emailReading';

const gmail = [
  'See below, from the carrier.',
  '',
  '---------- Forwarded message ---------',
  'From: Pat Carrier <pat@carrier.example>',
  'Date: Thu, Nov 12, 2026 at 3:14 PM',
  'Subject: Re: lane rate',
  'To: Me <me@personal.example>',
  '',
  '',
  'We can do 2 loads at 4,200 per load.',
  '',
  'On Wed, Nov 11, 2026 at 9:00 AM Me <me@personal.example> wrote:',
  '> Can you quote 3 loads at 3,900?',
].join('\n');

const outlook = [
  'FYI',
  '',
  '________________________________',
  'From: Pat Carrier <pat@carrier.example>',
  'Sent: Thursday, November 12, 2026 3:14 PM',
  'To: Me <me@personal.example>',
  'Subject: Rate',
  '',
  'Rate is 4,200.',
].join('\r\n');

const apple = [
  'Forwarding.',
  '',
  'Begin forwarded message:',
  '',
  'From: Pat Carrier <pat@carrier.example>',
  'Subject: Rate',
  'Date: November 12, 2026 at 3:14:00 PM MST',
  'To: Me <me@personal.example>',
  '',
  'Rate is 4,200.',
].join('\n');

describe('findForward', () => {
  it('finds a Gmail forward and its parts', () => {
    const found = findForward(gmail);
    expect(found).toMatchObject({
      depth: 0,
      fromAddress: 'pat@carrier.example',
      fromName: 'Pat Carrier',
      subject: 'Re: lane rate',
      dateText: 'Thu, Nov 12, 2026 at 3:14 PM',
    });
    if (found === null) throw new Error('not found');
    expect(sliceCodePoints(gmail, found.start)).toMatch(/^---------- Forwarded message/);
    expect(forwardNote(gmail, found.start)).toBe('See below, from the carrier.');
    const text = forwardedText(gmail, found.textStart, found.depth);
    expect(emailLines(found.subject, text).lines).toEqual([
      'Subject: Re: lane rate',
      'We can do 2 loads at 4,200 per load.',
    ]);
  });

  it('finds an Outlook forward (underscores, Sent, CRLF)', () => {
    const found = findForward(outlook);
    expect(found).toMatchObject({
      fromAddress: 'pat@carrier.example',
      subject: 'Rate',
      dateText: 'Thursday, November 12, 2026 3:14 PM',
    });
    if (found === null) throw new Error('not found');
    expect(forwardedText(outlook, found.textStart, found.depth).trim()).toBe('Rate is 4,200.');
  });

  it('finds an Outlook forward with no marker, and Outlook’s [mailto:] form', () => {
    const body = 'Note\n\nFrom: Pat [mailto:Pat@Carrier.example]\nSent: Monday\nSubject: X\n\nHi';
    expect(findForward(body)).toMatchObject({
      fromAddress: 'pat@carrier.example',
      fromName: 'Pat',
    });
  });

  it('finds an Apple Mail forward', () => {
    const found = findForward(apple);
    expect(found).toMatchObject({ fromAddress: 'pat@carrier.example', subject: 'Rate', depth: 0 });
  });

  it('finds a forward whose header block is quoted (an HTML blockquote) and removes that depth only', () => {
    const body = [
      'Begin forwarded message:',
      '> From: Pat <pat@carrier.example>',
      '> Subject: Rate',
      '> Date: November 12, 2026',
      '',
      '> Offer 100 tonnes.',
      '> > Our earlier price 300',
      'After the block',
    ].join('\n');
    const found = findForward(body);
    expect(found).toMatchObject({ depth: 1, fromAddress: 'pat@carrier.example' });
    if (found === null) throw new Error('not found');
    const text = forwardedText(body, found.textStart, found.depth);
    expect(text).not.toContain('After the block');
    expect(emailLines(found.subject, text).lines).toEqual(['Subject: Rate', 'Offer 100 tonnes.']);
  });

  it('is not a forward without a sender address or a date', () => {
    expect(
      findForward('---------- Forwarded message ---------\nFrom: Pat\nDate: today\n\nHi'),
    ).toBeNull();
    expect(
      findForward('---------- Forwarded message ---------\nFrom: p@c.example\nSubject: x\n\nHi'),
    ).toBeNull();
  });

  it('is not a forward when a reply’s quotation comes first', () => {
    const body = [
      'Thanks',
      'On Wed, Nov 11, 2026 Pat <pat@carrier.example> wrote:',
      '> ---------- Forwarded message ---------',
      '> From: X <x@y.example>',
      '> Date: today',
    ].join('\n');
    expect(findForward(body)).toBeNull();
    expect(findForward('Hi\n> quoted line\n> more')).toBeNull();
    expect(findForward('Just a plain email.')).toBeNull();
  });

  it('passes over a note line that only looks like a header', () => {
    const body = `To: the desk\n${gmail}`;
    expect(findForward(body)?.fromAddress).toBe('pat@carrier.example');
  });

  it('takes the outer forward of a forward', () => {
    const inner = gmail.replace('pat@carrier.example', 'inner@other.example');
    const body = [
      '---------- Forwarded message ---------',
      'From: Outer <outer@carrier.example>',
      'Date: today',
      'Subject: Fwd',
      '',
      inner,
    ].join('\n');
    expect(findForward(body)?.fromAddress).toBe('outer@carrier.example');
  });

  it('counts offsets in code points, not UTF-16 units (D1-01)', () => {
    const note = '🌾'.repeat(10);
    const body = `${note}\n---------- Forwarded message ---------\nFrom: p@c.example\nDate: d\n\nHi`;
    const found = findForward(body);
    if (found === null) throw new Error('not found');
    expect(found.start).toBe(11); // 10 emoji and the line break
    expect(found.textStart).toBeLessThanOrEqual(codePointLength(body));
    // PostgreSQL's length: 10 emoji, one each, then the rest in ASCII.
    expect(codePointLength(body)).toBe(body.length - 10);
    expect(forwardedText(body, found.textStart, 0).trim()).toBe('Hi');
    expect(forwardNote(body, found.start)).toBe(note);
  });

  it('stays linear on hostile input', () => {
    const many = 'From: x\n'.repeat(50_000) + '> '.repeat(20_000);
    const started = Date.now();
    expect(findForward(many)).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('forwardedSender', () => {
  it('reads the usual forms', () => {
    expect(forwardedSender('"Pat C" <Pat@Carrier.example>')).toEqual({
      address: 'pat@carrier.example',
      name: 'Pat C',
    });
    expect(forwardedSender('pat@carrier.example')).toEqual({
      address: 'pat@carrier.example',
      name: null,
    });
    expect(forwardedSender('Pat <mailto:pat@carrier.example>')?.address).toBe(
      'pat@carrier.example',
    );
    expect(forwardedSender('Pat Carrier')).toBeNull();
    expect(forwardedSender('<not an address>')).toBeNull();
  });
});

describe('sliceCodePoints', () => {
  it('slices by code points', () => {
    expect(sliceCodePoints('a🌾b🌾c', 1, 4)).toBe('🌾b🌾');
    expect(sliceCodePoints('a🌾b', 2)).toBe('b');
    expect(sliceCodePoints('ab', 5)).toBe('');
  });
});
