import { describe, expect, it } from 'vitest';

import {
  composeEmailBody,
  fillSignature,
  normalizeEmailAddress,
  saveMemberEmailSchema,
  sendEmailSchema,
} from './emails';

const KEY = '7d1b1c1e-1111-4111-8111-111111111111';
const COMPANY = '2d1b1c1e-2222-4222-8222-222222222222';

function send(overrides: Record<string, unknown> = {}) {
  return sendEmailSchema.safeParse({
    counterpartyId: COMPANY,
    contactId: null,
    from: 'own',
    to: ['buyer@example.com'],
    cc: [],
    subject: 'Feed oats',
    message: 'Hello',
    sendKey: KEY,
    ...overrides,
  });
}

describe('normalizeEmailAddress', () => {
  it('trims and lowercases an address', () => {
    expect(normalizeEmailAddress('  Buyer@Example.COM ')).toBe('buyer@example.com');
  });

  it.each([
    '',
    'no-at-sign',
    'two@@example.com',
    'a@b@example.com',
    'space in@example.com',
    'name@nodot',
    'Someone <a@example.com>',
    'a@example.com, b@example.com',
    'a@example.com;b@example.com',
    'a\r\nBcc: x@example.com@example.com',
    'tab\t@example.com',
    'a@-example.com',
    `${'a'.repeat(250)}@example.com`,
  ])('refuses %j', (value) => {
    expect(normalizeEmailAddress(value)).toBeNull();
  });
});

describe('sendEmailSchema', () => {
  it('accepts a plain email and removes repeated addresses, Cc after To', () => {
    const result = send({
      to: ['A@example.com', 'a@example.com'],
      cc: ['a@example.com', 'c@example.com'],
    });
    expect(result.success).toBe(true);
    expect(result.data?.to).toEqual(['a@example.com']);
    expect(result.data?.cc).toEqual(['c@example.com']);
  });

  it('needs one recipient in To', () => {
    expect(send({ to: [] }).success).toBe(false);
  });

  it('refuses more than 50 recipients in To and Cc together', () => {
    const many = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => `${prefix}${String(i)}@example.com`);
    expect(send({ to: many('t', 30), cc: many('c', 20) }).success).toBe(true);
    expect(send({ to: many('t', 30), cc: many('c', 21) }).success).toBe(false);
  });

  it('refuses a subject over two lines, an empty subject or message', () => {
    expect(send({ subject: 'One\r\nBcc: x@example.com' }).success).toBe(false);
    expect(send({ subject: 'One\nTwo' }).success).toBe(false);
    expect(send({ subject: '   ' }).success).toBe(false);
    expect(send({ message: ' \n ' }).success).toBe(false);
  });

  it('refuses a bad address, an unknown field and a missing send key', () => {
    expect(send({ to: ['Someone <a@example.com>'] }).success).toBe(false);
    expect(send({ bcc: ['a@example.com'] }).success).toBe(false);
    expect(send({ sendKey: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('saveMemberEmailSchema', () => {
  it('turns blanks into none and lowercases the address', () => {
    expect(saveMemberEmailSchema.parse({ localPart: ' Jane.Doe ', title: ' ', phone: '' })).toEqual(
      {
        localPart: 'jane.doe',
        title: null,
        phone: null,
      },
    );
  });

  it('refuses a bad address, a two-line title and a phone with letters', () => {
    expect(
      saveMemberEmailSchema.safeParse({ localPart: '.jane', title: null, phone: null }).success,
    ).toBe(false);
    expect(
      saveMemberEmailSchema.safeParse({ localPart: null, title: 'A\nB', phone: null }).success,
    ).toBe(false);
    expect(
      saveMemberEmailSchema.safeParse({ localPart: null, title: null, phone: 'call me' }).success,
    ).toBe(false);
    expect(
      saveMemberEmailSchema.safeParse({
        localPart: null,
        title: null,
        phone: '+1 (403) 555-0100 x2',
      }).success,
    ).toBe(true);
  });
});

describe('fillSignature', () => {
  const template = '{name}\n{title}\nPhone: {phone}\n{email}\nGSS';

  it('fills every placeholder', () => {
    expect(
      fillSignature(template, {
        name: 'Jane Doe',
        title: 'Trader',
        phone: '403-555-0100',
        email: 'jane@example.com',
      }),
    ).toBe('Jane Doe\nTrader\nPhone: 403-555-0100\njane@example.com\nGSS');
  });

  it('leaves out a line whose placeholders are all empty, with its label', () => {
    expect(
      fillSignature(template, {
        name: 'Jane Doe',
        title: null,
        phone: null,
        email: 'info@example.com',
      }),
    ).toBe('Jane Doe\ninfo@example.com\nGSS');
  });

  it('keeps a line with one of two placeholders filled', () => {
    expect(
      fillSignature('{title} | {phone}', {
        name: 'J',
        title: 'Trader',
        phone: null,
        email: 'j@example.com',
      }),
    ).toBe('Trader |');
  });

  it('is none without a template', () => {
    expect(
      fillSignature(null, { name: 'J', title: null, phone: null, email: 'j@example.com' }),
    ).toBeNull();
    expect(
      fillSignature('  \n ', { name: 'J', title: null, phone: null, email: 'j@example.com' }),
    ).toBeNull();
  });
});

describe('composeEmailBody', () => {
  it('puts the signature after the standard separator', () => {
    expect(composeEmailBody('Hello\r\n\r\nThanks  \n', 'Jane')).toBe(
      'Hello\n\nThanks\n\n-- \nJane',
    );
  });

  it('is the message alone without a signature', () => {
    expect(composeEmailBody('Hello', null)).toBe('Hello');
  });
});
