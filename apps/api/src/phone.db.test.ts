import { formatPhone } from '@grain/domain';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

// The database's app.format_phone, which tidied the phones saved before
// (20261031020000_phone_format.sql), and the app's formatPhone must agree on every value the
// database accepts as a phone. A few thousand numbers, built from prefixes, groupings and
// extensions, go through both. Nothing is written.
const ADMIN_URL = process.env.API_TEST_ADMIN_DATABASE_URL;
if (!ADMIN_URL) throw new Error('Set API_TEST_ADMIN_DATABASE_URL (table owner).');

const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });

const PREFIXES = ['', '1', '1 ', '1-', '+1 ', '+1', '+44 ', '+33 1 ', '+', ' ', '(1) '];
const NUMBERS = [
  '4035550100',
  '403 555 0100',
  '403-555-0100',
  '403.555.0100',
  '(403) 555-0100',
  '(403)555-0100',
  '403/555-0100',
  '403 5550 100',
  '555-0100',
  '40355501000',
  '20 7946 0958',
  '0100',
];
const EXTENSIONS = [
  '',
  ' x7',
  'x12',
  ' x 345',
  ' x',
  'x0',
  '  ',
  // Long enough that formatting would pass 40 characters (Codex's review of #95).
  `x${'1'.repeat(25)}`,
  `x${'1'.repeat(29)}`,
];

afterAll(async () => {
  await admin.end();
});

describe('formatting phones', () => {
  it('formats every phone the database accepts the same way as the app', async () => {
    const phones = PREFIXES.flatMap((prefix) =>
      NUMBERS.flatMap((number) => EXTENSIONS.map((extension) => `${prefix}${number}${extension}`)),
    ).filter((phone) => phone.length >= 3 && phone.length <= 40 && /^[0-9+(). /x-]+$/.test(phone));
    expect(phones.length).toBeGreaterThan(700);
    const rows = await admin<{ phone: string; formatted: string }[]>`
      select phone, app.format_phone(phone) as formatted from unnest(${phones}::text[]) as phone`;
    const disagree = rows.filter((row) => row.formatted !== formatPhone(row.phone));
    expect(disagree).toEqual([]);
    // And what it saves is still a phone to the database.
    expect(rows.every((row) => /^[0-9+(). /x-]{3,40}$/.test(row.formatted))).toBe(true);
  });
});
